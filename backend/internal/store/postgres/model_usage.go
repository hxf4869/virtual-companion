package postgres

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	PurposeToolTurn   = "TOOL_TURN"
	PurposeLegacyChat = "LEGACY_CHAT"

	ModelUsageNoPrice       = "NO_PRICE"
	ModelUsageNoBudget      = "NO_BUDGET"
	ModelUsageOverLimit     = "OVER_LIMIT"
	ModelUsageAttemptReused = "ATTEMPT_REUSED"
)

// ModelUsageError is a priced-send refusal. Reason is NO_PRICE, NO_BUDGET,
// OVER_LIMIT, or ATTEMPT_REUSED. The provider is not called.
type ModelUsageError struct {
	Reason string
}

func (e *ModelUsageError) Error() string {
	if e == nil {
		return "model usage"
	}
	return "model usage " + e.Reason
}

type ModelUsageReserve struct {
	Owner       int64
	Purpose     string
	AttemptID   string
	ProviderID  string
	ModelID     string
	InputTokens int
	// OutputTokens is this request's max output, not an expected length.
	OutputTokens int
}

type ModelUsageHold struct {
	ReservationID int64
	Purpose       string
	Status        string
	AttemptID     string
	ReservedUSD   string
}

type ModelUsageSettlement struct {
	ReservationID int64
	Purpose       string
	Status        string
	ActualUSD     string
	InputTokens   int64
	OutputTokens  int64
	Idempotent    bool
}

type ModelUsageCancellation struct {
	ReservationID int64
	Purpose       string
	Status        string
	ReservedUSD   string
	ActualUSD     *string
	Idempotent    bool
}

type ModelUsagePurposeRow struct {
	Purpose      string
	Calls        int64
	ActualUSD    *string
	EstimatedUSD *string
	UnsettledUSD *string
	InputTokens  int64
	OutputTokens int64
}

func (s *Store) ReserveModelUsage(ctx context.Context, in ModelUsageReserve) (ModelUsageHold, error) {
	if s == nil || s.maxReservedCost <= 0 || s.monthlyCostLimit <= 0 {
		return ModelUsageHold{}, &ModelUsageError{Reason: ModelUsageNoBudget}
	}
	in.Purpose = strings.TrimSpace(in.Purpose)
	in.AttemptID = strings.TrimSpace(in.AttemptID)
	in.ProviderID = strings.TrimSpace(in.ProviderID)
	in.ModelID = strings.TrimSpace(in.ModelID)
	if in.Owner <= 0 || in.AttemptID == "" || in.ProviderID == "" || in.ModelID == "" ||
		in.InputTokens < 0 || in.OutputTokens < 0 ||
		(in.Purpose != PurposeForegroundChat && in.Purpose != PurposeToolTurn) {
		return ModelUsageHold{}, ErrInvalid
	}
	var out ModelUsageHold
	err := s.WithOwner(ctx, in.Owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT out_reservation_id, out_purpose, out_status, out_reserved_usd, out_attempt
			  FROM vc.reserve_model_usage($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			in.Owner, in.Purpose, in.AttemptID, in.ProviderID, in.ModelID,
			in.InputTokens, in.OutputTokens, s.maxReservedCost, s.monthlyCostLimit).
			Scan(&out.ReservationID, &out.Purpose, &out.Status, &out.ReservedUSD, &out.AttemptID)
	})
	if err != nil {
		return ModelUsageHold{}, mapStoreErr(err)
	}
	out.ReservedUSD = strings.TrimSpace(out.ReservedUSD)
	return out, nil
}

func (s *Store) SettleModelUsage(ctx context.Context, owner, reservationID, inputTokens, outputTokens int64) (ModelUsageSettlement, error) {
	if owner <= 0 || reservationID <= 0 || inputTokens < 0 || outputTokens < 0 {
		return ModelUsageSettlement{}, ErrInvalid
	}
	var out ModelUsageSettlement
	var actual pgtype.Text
	var inTok, outTok pgtype.Int8
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT out_reservation_id, out_purpose, out_status, out_actual_usd,
			       out_input_tokens, out_output_tokens, out_idempotent
			  FROM vc.settle_model_usage_reservation($1,$2,$3,$4)`,
			owner, reservationID, inputTokens, outputTokens).
			Scan(&out.ReservationID, &out.Purpose, &out.Status, &actual,
				&inTok, &outTok, &out.Idempotent)
	})
	if err != nil {
		return ModelUsageSettlement{}, mapStoreErr(err)
	}
	if actual.Valid {
		out.ActualUSD = strings.TrimSpace(actual.String)
	}
	if inTok.Valid {
		out.InputTokens = inTok.Int64
	}
	if outTok.Valid {
		out.OutputTokens = outTok.Int64
	}
	return out, nil
}

// SweepExpiredModelCostHolds marks HELD reservations older than olderThan as
// UNKNOWN. The SQL moves the priced hold from reserved to unsettled and does
// not write an actual of zero. younger holds are left HELD.
func (s *Store) SweepExpiredModelCostHolds(ctx context.Context, olderThan time.Duration) (int, error) {
	seconds := int(olderThan.Seconds())
	if seconds < 1 {
		return 0, ErrInvalid
	}
	var n int
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.sweep_expired_model_cost_holds($1)`, seconds).Scan(&n)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return n, nil
}

func (s *Store) CancelModelUsage(ctx context.Context, owner, reservationID int64, disposition string) (ModelUsageCancellation, error) {
	disposition = strings.TrimSpace(disposition)
	if owner <= 0 || reservationID <= 0 || (disposition != "NOT_SENT" && disposition != "UNKNOWN") {
		return ModelUsageCancellation{}, ErrInvalid
	}
	var out ModelUsageCancellation
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT out_reservation_id, out_purpose, out_status, out_reserved_usd, out_actual_usd, out_idempotent
			  FROM vc.cancel_model_usage_reservation($1,$2,$3)`,
			owner, reservationID, disposition).
			Scan(&out.ReservationID, &out.Purpose, &out.Status, &out.ReservedUSD, &out.ActualUSD, &out.Idempotent)
	})
	if err != nil {
		return ModelUsageCancellation{}, mapStoreErr(err)
	}
	out.ReservedUSD = strings.TrimSpace(out.ReservedUSD)
	return out, nil
}

func (s *Store) RecordLocalEmbeddingCall(ctx context.Context, owner int64) error {
	if owner <= 0 {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.record_local_embedding_call($1)`, owner)
		return err
	})
	return mapStoreErr(err)
}

func (s *Store) AdminModelUsageSummary(ctx context.Context, actingAccountID int64, since time.Time) ([]ModelUsagePurposeRow, error) {
	if actingAccountID <= 0 {
		return nil, ErrInvalid
	}
	var sinceArg any
	if !since.IsZero() {
		sinceArg = since.UTC()
	}
	var out []ModelUsagePurposeRow
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_purpose, out_calls, out_actual_usd, out_estimated_usd, out_unsettled_usd,
			       out_input_tokens, out_output_tokens
			  FROM vc.admin_model_usage_summary($1,$2)`, actingAccountID, sinceArg)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var row ModelUsagePurposeRow
			if err := rows.Scan(&row.Purpose, &row.Calls, &row.ActualUSD, &row.EstimatedUSD, &row.UnsettledUSD,
				&row.InputTokens, &row.OutputTokens); err != nil {
				return err
			}
			if row.ActualUSD != nil {
				v := strings.TrimSpace(*row.ActualUSD)
				row.ActualUSD = &v
			}
			if row.EstimatedUSD != nil {
				v := strings.TrimSpace(*row.EstimatedUSD)
				row.EstimatedUSD = &v
			}
			if row.UnsettledUSD != nil {
				v := strings.TrimSpace(*row.UnsettledUSD)
				row.UnsettledUSD = &v
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}
