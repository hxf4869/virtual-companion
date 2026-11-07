package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const chatTransferTimeout = 120 * time.Second

// withChatTransfer is reserved for whole-chat transfer operations. Its total
// budget includes pool acquisition, owner binding, locks, work and commit.
// Callers resolving an uncertain commit must reuse the original request id and
// payload to consult the durable receipt; this boundary never retries work.
func (s *Store) withChatTransfer(ctx context.Context, owner int64, opts pgx.TxOptions, work TxWork) (err error) {
	if s == nil || s.pool == nil {
		return errStore
	}
	if owner <= 0 || work == nil {
		return ErrInvalid
	}
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, chatTransferTimeout)
	defer cancel()
	start := time.Now()
	defer func() {
		s.txCount.Add(1)
		s.txNanos.Add(uint64(time.Since(start).Nanoseconds()))
		err = mapChatTransferErr(ctx, err)
	}()
	tx, err := s.pool.BeginTx(ctx, opts)
	if err != nil {
		return err
	}
	defer func() {
		// Always release a transaction, including panic and failed/cancelled commit.
		_ = tx.Rollback(context.Background())
	}()
	if _, err = tx.Exec(ctx, `SET LOCAL statement_timeout = 120000; SET LOCAL lock_timeout = 5000`); err != nil {
		return err
	}
	if err = s.bindOwner(ctx, tx, owner); err != nil {
		return err
	}
	if err = work(ctx, tx); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func mapChatTransferErr(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.Is(err, context.DeadlineExceeded) || (ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded)) ||
		(errors.As(err, &pgErr) && (pgErr.Code == "57014" || pgErr.Code == "55P03")) {
		return chatError("CHAT_TRANSFER_TIMEOUT")
	}
	if errors.As(err, &pgErr) && pgErr.Code == "40001" {
		return chatError("REVISION_CONFLICT")
	}
	if errors.Is(err, context.Canceled) || (ctx != nil && errors.Is(ctx.Err(), context.Canceled)) {
		return context.Canceled
	}
	return mapChatErr(err)
}
