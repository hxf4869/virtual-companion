package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenConfig is the pgx pool input. DSN is a libpq/pgx URL; it must use a
// least-privilege runtime role (NOBYPASSRLS). Secrets are never logged.
type OpenConfig struct {
	DSN                string
	MaxConns           int32
	TxTimeout          time.Duration
	OwnerBindingSecret string
}

// Store is the owner-bound short-transaction PostgreSQL access. Each
// operation opens its own transaction, sets vc.set_owner_context on that
// connection, runs the work, and commits or rolls back before return.
// Authentication must not wrap an HTTP request in this transaction.
type Store struct {
	pool      *pgxpool.Pool
	secret    []byte
	txTimeout time.Duration
	cipher    *FieldCipher

	txCount atomic.Uint64
	txNanos atomic.Uint64
}

// Stats is a low-cardinality pool snapshot for metrics. No owner or SQL text.
type Stats struct {
	Acquired     int32
	Idle         int32
	Max          int32
	EmptyAcquire int64
	TxCount      uint64
	TxSeconds    float64
}

// Open pings PostgreSQL and returns a pool. The caller must Close it.
func Open(ctx context.Context, cfg OpenConfig) (*Store, error) {
	if cfg.DSN == "" {
		return nil, fmt.Errorf("database DSN is required")
	}
	secret, err := requireBindingSecret(cfg.OwnerBindingSecret)
	if err != nil {
		return nil, err
	}
	pc, err := pgxpool.ParseConfig(cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("database DSN: parse failed")
	}
	if cfg.MaxConns > 0 {
		pc.MaxConns = cfg.MaxConns
	}
	pc.ConnConfig.RuntimeParams["application_name"] = "companiond"
	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, fmt.Errorf("database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database ping failed")
	}
	timeout := cfg.TxTimeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Store{pool: pool, secret: secret, txTimeout: timeout}, nil
}

func (s *Store) Close() {
	if s == nil || s.pool == nil {
		return
	}
	s.pool.Close()
}

// UseCipher installs the at-rest field cipher for message bodies. Nil
// leaves stored plaintext readable and refuses to surface enc1/enc2 blobs.
func (s *Store) UseCipher(c *FieldCipher) {
	if s == nil {
		return
	}
	s.cipher = c
}

func (s *Store) Ping(ctx context.Context) error {
	if s == nil || s.pool == nil {
		return fmt.Errorf("database pool is not open")
	}
	return s.pool.Ping(ctx)
}

func (s *Store) Stats() Stats {
	if s == nil || s.pool == nil {
		return Stats{}
	}
	st := s.pool.Stat()
	return Stats{
		Acquired:     st.AcquiredConns(),
		Idle:         st.IdleConns(),
		Max:          st.MaxConns(),
		EmptyAcquire: st.EmptyAcquireCount(),
		TxCount:      s.txCount.Load(),
		TxSeconds:    time.Duration(s.txNanos.Load()).Seconds(),
	}
}

// TxWork runs inside one already owner-bound short transaction.
type TxWork func(ctx context.Context, tx pgx.Tx) error

// withoutOwner opens a short transaction for SECURITY DEFINER worker
// functions that are not owner-scoped (claim, list expired jobs).
func (s *Store) withoutOwner(ctx context.Context, work TxWork) (err error) {
	if s == nil || s.pool == nil {
		return fmt.Errorf("database pool is not open")
	}
	if work == nil {
		return fmt.Errorf("work is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	start := time.Now()
	defer func() {
		s.txCount.Add(1)
		s.txNanos.Add(uint64(time.Since(start).Nanoseconds()))
	}()
	ctx, cancel := context.WithTimeout(ctx, s.txTimeout)
	defer cancel()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin worker transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(context.Background())
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(context.Background())
		}
	}()
	if workErr := work(ctx, tx); workErr != nil {
		err = workErr
		return err
	}
	if commitErr := tx.Commit(ctx); commitErr != nil {
		err = fmt.Errorf("commit worker transaction: %w", commitErr)
		return err
	}
	return nil
}

// WithOwner opens a short transaction, binds the existing V27 owner
// context on that same connection, runs work, then commits or rolls back.
// ownerUserID is the server-verified account id (user_id == owner_user_id).
func (s *Store) WithOwner(ctx context.Context, ownerUserID int64, work TxWork) (err error) {
	if s == nil || s.pool == nil {
		return fmt.Errorf("database pool is not open")
	}
	if ownerUserID <= 0 {
		return fmt.Errorf("ownerUserId must be positive")
	}
	if work == nil {
		return fmt.Errorf("work is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	start := time.Now()
	defer func() {
		s.txCount.Add(1)
		s.txNanos.Add(uint64(time.Since(start).Nanoseconds()))
	}()

	ctx, cancel := context.WithTimeout(ctx, s.txTimeout)
	defer cancel()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin owner transaction: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(context.Background())
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(context.Background())
		}
	}()

	if bindErr := s.bindOwner(ctx, tx, ownerUserID); bindErr != nil {
		err = bindErr
		return err
	}
	if workErr := work(ctx, tx); workErr != nil {
		err = workErr
		return err
	}
	if commitErr := tx.Commit(ctx); commitErr != nil {
		err = fmt.Errorf("commit owner transaction: %w", commitErr)
		return err
	}
	return nil
}

func (s *Store) bindOwner(ctx context.Context, tx pgx.Tx, ownerUserID int64) error {
	var pid int32
	var xact string
	if err := tx.QueryRow(ctx, "SELECT pg_backend_pid(), pg_current_xact_id()::text").Scan(&pid, &xact); err != nil {
		return fmt.Errorf("owner binding identifiers: %w", err)
	}
	nonce, err := newNonce()
	if err != nil {
		return err
	}
	proof := ProofFor(s.secret, ownerUserID, strconv.Itoa(int(pid)), xact, nonce)
	// SELECT (not a DML tag) because set_owner_context RETURNS void; drain it.
	if _, err := tx.Exec(ctx, "SELECT vc.set_owner_context($1, $2, $3)", ownerUserID, nonce, proof); err != nil {
		return ErrOwnerContextRejected
	}
	return nil
}

// ErrOwnerContextRejected is the fail-closed surface when HMAC proof is
// missing, forged, replayed, or the secret disagrees with the database.
var ErrOwnerContextRejected = errors.New("owner context rejected")
