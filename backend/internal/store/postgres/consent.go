package postgres

import (
	"context"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var requiredConsents = []string{
	"SERVICE_TERMS",
	"PRIVACY_POLICY",
	"AI_CONTENT_NOTICE",
	"THIRD_PARTY_MODEL_PROCESSING",
	"SENSITIVE_DATA_PROCESSING",
}

var approvedConsents = map[string]struct{}{
	"SERVICE_TERMS":                {},
	"PRIVACY_POLICY":               {},
	"AI_CONTENT_NOTICE":            {},
	"THIRD_PARTY_MODEL_PROCESSING": {},
	"SENSITIVE_DATA_PROCESSING":    {},
	"EMERGENCY_CONTACT":            {},
	"MODEL_TRAINING":               {},
	"PUSH_NOTIFICATION":            {},
}

// Consent is the effective latest row for one type.
type Consent struct {
	ID        int64
	Type      string
	Version   string
	Granted   bool
	GrantedAt time.Time
	RevokedAt *time.Time
}

// OutboundDecision is the current-consent checkpoint used before any
// provider call. G8 only exercises it in isolation; G10 consumes it.
type OutboundDecision struct {
	Allow      bool
	Code       string
	Categories []string
}

func (s *Store) ListConsents(ctx context.Context, owner int64) ([]Consent, error) {
	var out []Consent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_consent_type, out_version, out_granted, out_granted_at, out_revoked_at
			   FROM vc.list_consents($1)`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c Consent
			var revoked pgtype.Timestamptz
			if err := rows.Scan(&c.ID, &c.Type, &c.Version, &c.Granted, &c.GrantedAt, &revoked); err != nil {
				return err
			}
			c.RevokedAt = tzPtr(revoked)
			out = append(out, c)
		}
		if out == nil {
			out = []Consent{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) RecordConsent(ctx context.Context, owner int64, consentType, version string, granted bool) (Consent, error) {
	if _, ok := approvedConsents[consentType]; !ok {
		return Consent{}, ErrInvalid
	}
	version = trimVersion(version)
	if version == "" || utf8.RuneCountInString(version) > 64 {
		return Consent{}, ErrInvalid
	}
	var out Consent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.record_consent($1,$2,$3,$4)`,
			owner, consentType, version, granted).Scan(&id); err != nil {
			return err
		}
		if !granted {
			var n int
			if err := tx.QueryRow(ctx, `SELECT vc.withdraw_authorization_snapshots($1)`, owner).Scan(&n); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_consent_type, out_version, out_granted, out_granted_at, out_revoked_at
			   FROM vc.list_consents($1)`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c Consent
			var revoked pgtype.Timestamptz
			if err := rows.Scan(&c.ID, &c.Type, &c.Version, &c.Granted, &c.GrantedAt, &revoked); err != nil {
				return err
			}
			c.RevokedAt = tzPtr(revoked)
			if c.Type == consentType {
				out = c
			}
		}
		if out.ID == 0 {
			return errStore
		}
		return rows.Err()
	})
	if err != nil {
		return Consent{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) GetIncognitoPref(ctx context.Context, owner int64) (bool, error) {
	var v bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.get_incognito_pref($1)`, owner).Scan(&v)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return v, nil
}

func (s *Store) UpdateIncognitoPref(ctx context.Context, owner int64, defaultIncognito bool) (bool, error) {
	var v bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.update_incognito_pref($1,$2)`, owner, defaultIncognito).Scan(&v)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return v, nil
}

// OutboundCheck reads current consent and deletion intent. It does not call
// a provider and does not hold a connection across I/O.
func (s *Store) OutboundCheck(ctx context.Context, owner int64) (OutboundDecision, error) {
	var consents []Consent
	var deleting bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT vc.account_deletion_intent_active_current()`).Scan(&deleting); err != nil {
			return err
		}
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_consent_type, out_version, out_granted, out_granted_at, out_revoked_at
			   FROM vc.list_consents($1)`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c Consent
			var revoked pgtype.Timestamptz
			if err := rows.Scan(&c.ID, &c.Type, &c.Version, &c.Granted, &c.GrantedAt, &revoked); err != nil {
				return err
			}
			consents = append(consents, c)
		}
		return rows.Err()
	})
	if err != nil {
		return OutboundDecision{}, mapStoreErr(err)
	}
	return DecideOutbound(consents, deleting), nil
}

// DecideOutbound is the current-state checkpoint. Required consents must
// all be granted; withdrawn THIRD_PARTY_MODEL_PROCESSING (or any required
// type) yields zero outbound categories.
func DecideOutbound(consents []Consent, deletionActive bool) OutboundDecision {
	if deletionActive {
		return OutboundDecision{Allow: false, Code: "DELETION_IN_PROGRESS", Categories: []string{}}
	}
	granted := map[string]bool{}
	for _, c := range consents {
		granted[c.Type] = c.Granted
	}
	for _, t := range requiredConsents {
		if !granted[t] {
			return OutboundDecision{Allow: false, Code: "CONSENT_WITHDRAWN", Categories: []string{}}
		}
	}
	return OutboundDecision{
		Allow:      true,
		Code:       "OK",
		Categories: []string{"MESSAGE_TEXT", "ACCOUNT_METADATA", "MEMORY_SNIPPET"},
	}
}

func trimVersion(s string) string {
	b := make([]rune, 0, len(s))
	started := false
	for _, r := range s {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if started {
				b = append(b, ' ')
			}
			continue
		}
		started = true
		b = append(b, r)
	}
	for len(b) > 0 && b[len(b)-1] == ' ' {
		b = b[:len(b)-1]
	}
	return string(b)
}
