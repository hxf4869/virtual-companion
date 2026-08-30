package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Identity is the credential row used for high-risk current-password checks.
// The hash never enters logs.
type Identity struct {
	AccountID    int64
	Role         string
	Status       string
	PasswordHash string
}

func (s *Store) LookupIdentity(ctx context.Context, username string) (Identity, bool, error) {
	username = strings.ToLower(strings.TrimSpace(username))
	if username == "" {
		return Identity{}, false, nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	row := s.pool.QueryRow(ctx,
		`SELECT out_account_id, out_role, out_status, out_password_hash
		   FROM vc.identity_authenticate($1)`, username)
	var id Identity
	if err := row.Scan(&id.AccountID, &id.Role, &id.Status, &id.PasswordHash); err != nil {
		if err == pgx.ErrNoRows {
			return Identity{}, false, nil
		}
		return Identity{}, false, mapStoreErr(err)
	}
	return id, true, nil
}

func (s *Store) RequestAccountDeletion(ctx context.Context, owner int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT vc.request_account_deletion_current()`).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		var recorded bool
		if err := tx.QueryRow(ctx, `SELECT vc.record_account_deletion_cancel_signals_current($1)`, 0).Scan(&recorded); err != nil {
			return err
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) DeletionIntentActive(ctx context.Context, owner int64) (bool, error) {
	var active bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.account_deletion_intent_active_current()`).Scan(&active)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return active, nil
}

func (s *Store) DeleteAccount(ctx context.Context, owner int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT vc.identity_account_delete_current()`).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}
