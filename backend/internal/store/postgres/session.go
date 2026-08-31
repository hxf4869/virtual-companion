package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// OpaqueSession is one live opaque session row. Token hash is never included.
type OpaqueSession struct {
	ID        int64
	CreatedAt time.Time
	ExpiresAt time.Time
	ReauthAt  time.Time
}

func (s *Store) Lookup(ctx context.Context, token string) (*auth.Principal, error) {
	if token == "" {
		return nil, nil
	}
	return s.LookupOpaqueSession(ctx, auth.TokenHash(token))
}

func (s *Store) LookupOpaqueSession(ctx context.Context, tokenHash string) (*auth.Principal, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	row := s.pool.QueryRow(ctx,
		`SELECT out_session_id, out_account_id, out_role, out_username, out_status,
		        out_password_must_change, out_created_at, out_expires_at, out_reauth_at
		   FROM vc.identity_opaque_session_lookup($1)`, tokenHash)
	var (
		p       auth.Principal
		status  string
		created time.Time
		expires time.Time
		reauth  *time.Time
	)
	err := row.Scan(&p.SessionID, &p.AccountID, &p.Role, &p.Username, &status,
		&p.PasswordMustChange, &created, &expires, &reauth)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, mapStoreErr(err)
	}
	if p.AccountID <= 0 || p.SessionID <= 0 || status != "ACTIVE" {
		return nil, nil
	}
	if reauth != nil {
		p.ReauthAt = reauth.UTC()
	}
	return &p, nil
}

func (s *Store) IssueOpaqueSession(ctx context.Context, accountID int64, tokenHash string, expires time.Time) (int64, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	var id int64
	err := s.pool.QueryRow(ctx,
		`SELECT vc.identity_opaque_session_issue($1, $2, $3)`,
		accountID, tokenHash, expires.UTC()).Scan(&id)
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return id, nil
}

func (s *Store) ListOpaqueSessions(ctx context.Context, accountID int64) ([]OpaqueSession, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	rows, err := s.pool.Query(ctx,
		`SELECT out_session_id, out_created_at, out_expires_at, out_reauth_at
		   FROM vc.identity_opaque_session_list($1)`, accountID)
	if err != nil {
		return nil, mapStoreErr(err)
	}
	defer rows.Close()
	var out []OpaqueSession
	for rows.Next() {
		var row OpaqueSession
		var reauth *time.Time
		if err := rows.Scan(&row.ID, &row.CreatedAt, &row.ExpiresAt, &reauth); err != nil {
			return nil, mapStoreErr(err)
		}
		if reauth != nil {
			row.ReauthAt = reauth.UTC()
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, mapStoreErr(err)
	}
	if out == nil {
		out = []OpaqueSession{}
	}
	return out, nil
}

func (s *Store) RevokeOpaqueSession(ctx context.Context, accountID, sessionID int64) error {
	ok, err := s.boolQuery(ctx, `SELECT vc.identity_opaque_session_revoke($1, $2)`, accountID, sessionID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Store) RevokeOpaqueSessionHash(ctx context.Context, tokenHash string) error {
	_, err := s.boolQuery(ctx, `SELECT vc.identity_opaque_session_revoke_hash($1)`, tokenHash)
	return err
}

func (s *Store) RevokeAllOpaqueSessions(ctx context.Context, accountID int64) (int, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	var n int
	err := s.pool.QueryRow(ctx, `SELECT vc.identity_opaque_session_revoke_all($1)`, accountID).Scan(&n)
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return n, nil
}

func (s *Store) RecordOpaqueReauth(ctx context.Context, accountID, sessionID int64) error {
	ok, err := s.boolQuery(ctx, `SELECT vc.identity_opaque_session_record_reauth($1, $2)`, accountID, sessionID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func (s *Store) ChangePasswordHash(ctx context.Context, accountID int64, passwordHash string) error {
	return s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT vc.identity_change_current_password($1)`, passwordHash).Scan(&ok); err != nil {
			return mapStoreErr(err)
		}
		if !ok {
			return ErrNotFound
		}
		return nil
	})
}

func (s *Store) boolQuery(ctx context.Context, sql string, args ...any) (bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	var ok bool
	err := s.pool.QueryRow(ctx, sql, args...).Scan(&ok)
	if err != nil {
		return false, mapStoreErr(err)
	}
	return ok, nil
}
