package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	AgeUnknown                   = "AGE_UNKNOWN"
	AgeAdultSelfDeclared         = "ADULT_SELF_DECLARED"
	AgeAdultVerificationRequired = "ADULT_VERIFICATION_REQUIRED"
	AgeAdultVerified             = "ADULT_VERIFIED"
	AgeMinorSuspected            = "MINOR_SUSPECTED"
	AgeMinorVerified             = "MINOR_VERIFIED"
	AgeAppealPending             = "AGE_APPEAL_PENDING"
	AgeReverifyRequired          = "AGE_REVERIFY_REQUIRED"
	AgeAccessSuspended           = "AGE_ACCESS_SUSPENDED"

	simulatedAgeProvider = "alpha-simulated"
)

// AgeState is the latest owner-scoped verification result. A caller with no
// history receives AGE_UNKNOWN with no provider reference or timestamp.
type AgeState struct {
	State       string
	ProviderRef *string
	VerifiedAt  *time.Time
}

// GetAgeState returns the caller's effective state through the existing V45
// trusted-owner function. It never queries the table outside owner context.
func (s *Store) GetAgeState(ctx context.Context, owner int64) (AgeState, error) {
	out := unknownAgeState()
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		state, err := getAgeState(ctx, tx, owner)
		if err != nil {
			return err
		}
		out = state
		return nil
	})
	if err != nil {
		return AgeState{}, mapStoreErr(err)
	}
	return out, nil
}

// VerifyAge runs the Technical Alpha deterministic verifier. The catalog path
// is appended in one owner-bound transaction; no identity document is accepted
// or stored. An already verified state is idempotent, while minor, appeal and
// suspended states fail closed.
func (s *Store) VerifyAge(ctx context.Context, owner int64) (AgeState, error) {
	var out AgeState
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		current, err := getAgeState(ctx, tx, owner)
		if err != nil {
			return err
		}
		path, ok := simulatedVerificationPath(current.State)
		if !ok {
			return ErrInvalid
		}
		if len(path) == 0 {
			out = current
			return nil
		}
		for _, state := range path {
			var id int64
			if err := tx.QueryRow(ctx,
				`SELECT vc.record_age_verification($1,$2,$3)`,
				owner, state, simulatedAgeProvider,
			).Scan(&id); err != nil {
				return err
			}
		}
		out, err = getAgeState(ctx, tx, owner)
		return err
	})
	if err != nil {
		return AgeState{}, mapStoreErr(err)
	}
	return out, nil
}

func getAgeState(ctx context.Context, tx pgx.Tx, owner int64) (AgeState, error) {
	var state string
	var provider pgtype.Text
	var verified pgtype.Timestamptz
	err := tx.QueryRow(ctx,
		`SELECT out_age_state, out_provider_ref, out_verified_at
		   FROM vc.get_age_state($1)`, owner,
	).Scan(&state, &provider, &verified)
	if errors.Is(err, pgx.ErrNoRows) {
		return unknownAgeState(), nil
	}
	if err != nil {
		return AgeState{}, err
	}
	out := AgeState{State: state}
	if provider.Valid {
		v := provider.String
		out.ProviderRef = &v
	}
	if verified.Valid {
		v := verified.Time
		out.VerifiedAt = &v
	}
	return out, nil
}

func unknownAgeState() AgeState {
	return AgeState{State: AgeUnknown}
}

func simulatedVerificationPath(state string) ([]string, bool) {
	switch state {
	case AgeUnknown:
		return []string{AgeAdultSelfDeclared, AgeAdultVerificationRequired, AgeAdultVerified}, true
	case AgeAdultSelfDeclared:
		return []string{AgeAdultVerificationRequired, AgeAdultVerified}, true
	case AgeAdultVerificationRequired, AgeReverifyRequired:
		return []string{AgeAdultVerified}, true
	case AgeAdultVerified:
		return []string{}, true
	default:
		return nil, false
	}
}
