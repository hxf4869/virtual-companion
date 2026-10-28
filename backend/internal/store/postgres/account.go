package postgres

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

// Identity is the credential row used for login and current-password checks.
// The hash never enters logs.
type Identity struct {
	AccountID          int64
	Role               string
	Status             string
	PasswordHash       string
	Username           string
	PasswordMustChange bool
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
		`SELECT out_account_id, out_role, out_status, out_password_hash, out_password_must_change
		   FROM vc.identity_authenticate($1)`, username)
	var id Identity
	if err := row.Scan(&id.AccountID, &id.Role, &id.Status, &id.PasswordHash, &id.PasswordMustChange); err != nil {
		if err == pgx.ErrNoRows {
			return Identity{}, false, nil
		}
		return Identity{}, false, mapStoreErr(err)
	}
	id.Username = username
	return id, true, nil
}

func (s *Store) RequestAccountDeletion(ctx context.Context, owner int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.go_lock_outbound_owner($1)`, owner); err != nil {
			return err
		}
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT vc.request_account_deletion_current()`).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		needsST := s.stData != nil
		if !needsST {
			if err := tx.QueryRow(ctx, `SELECT vc.requires_st_account_cleanup_current()`).Scan(&needsST); err != nil {
				return err
			}
		}
		if needsST {
			if _, err := tx.Exec(ctx, `SELECT vc.require_st_account_deletion_current()`); err != nil {
				return err
			}
		}
		needsEngine := s.memoryEngine != nil
		if !needsEngine {
			if err := tx.QueryRow(ctx, `SELECT vc.requires_memorycore_account_cleanup_current()`).Scan(&needsEngine); err != nil {
				return err
			}
		}
		if needsEngine {
			_, err := tx.Exec(ctx, `SELECT vc.require_memorycore_account_deletion_current()`)
			return err
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) RecordAccountDeletionCancelSignals(ctx context.Context, owner int64, count int) error {
	if count < 0 {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var recorded bool
		if err := tx.QueryRow(ctx, `SELECT vc.record_account_deletion_cancel_signals_current($1)`, count).Scan(&recorded); err != nil {
			return err
		}
		if !recorded {
			return ErrNotFound
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
			// A concurrent HTTP/recovery continuation may have completed first.
			var status string
			if err := tx.QueryRow(ctx, `SELECT out_status FROM vc.get_st_account_deletion_current()`).Scan(&status); err == nil && status == "COMPLETED" {
				return nil
			}
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}
