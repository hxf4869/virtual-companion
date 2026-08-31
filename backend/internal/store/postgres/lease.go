package postgres

import (
	"context"
	"fmt"
	"sync"

	"github.com/jackc/pgx/v5"
)

const runtimeSingletonKey = "vc.runtime.singleton"

// PlaneLease is the generation-plane exclusive lock. api-migration must never
// acquire it.
type PlaneLease struct {
	dsn  string
	mu   sync.Mutex
	conn *pgx.Conn
}

func NewPlaneLease(dsn string) *PlaneLease {
	return &PlaneLease{dsn: dsn}
}

func (l *PlaneLease) Acquire(ctx context.Context) error {
	if l == nil {
		return fmt.Errorf("generation plane lease is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn != nil {
		return nil
	}
	conn, err := pgx.Connect(ctx, l.dsn)
	if err != nil {
		return fmt.Errorf("generation plane lease: connect failed")
	}
	var held bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtext($1))`, runtimeSingletonKey).Scan(&held); err != nil {
		_ = conn.Close(ctx)
		return fmt.Errorf("generation plane lease: acquire failed")
	}
	if !held {
		_ = conn.Close(ctx)
		return fmt.Errorf("generation plane lease refused")
	}
	l.conn = conn
	return nil
}

func (l *PlaneLease) Release(ctx context.Context) error {
	if l == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conn == nil {
		return nil
	}
	_, _ = l.conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtext($1))`, runtimeSingletonKey)
	err := l.conn.Close(ctx)
	l.conn = nil
	return err
}
