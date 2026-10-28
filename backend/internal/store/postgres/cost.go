package postgres

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// UseCostLimits binds deployment admission limits before workers start. Amounts
// are micro-USD. An unset limit deliberately leaves model I/O unavailable.
func (s *Store) UseCostLimits(maxReservedCost, monthlyCostLimit int64) {
	s.maxReservedCost = maxReservedCost
	s.monthlyCostLimit = monthlyCostLimit
}

// outputTokens is this request's output cap, not an expected length. The hold
// is the priced estimate of those caps, and it does not exceed the per-call
// ceiling. A timeout keeps that estimate. Settlement uses reported usage.
func (s *Store) reserveModelCost(ctx context.Context, tx pgx.Tx, owner, jobID int64, attempt, provider, model string, inputTokens, outputTokens int, ceiling int64) error {
	_, err := tx.Exec(ctx, `SELECT vc.go_hold_model_cost($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		owner, jobID, attempt, provider, model, inputTokens, outputTokens,
		min(s.maxReservedCost, ceiling), s.monthlyCostLimit)
	return err
}

// outputTokens is this request's output cap, not an expected length. The hold
// follows the same priced estimate as reserveModelCost.
func (s *Store) reserveModelCostPurpose(ctx context.Context, tx pgx.Tx, owner, jobID int64, attempt, provider, model, purpose string, inputTokens, outputTokens int, ceiling int64) error {
	_, err := tx.Exec(ctx, `SELECT vc.go_hold_model_cost($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		owner, jobID, attempt, provider, model, inputTokens, outputTokens,
		min(s.maxReservedCost, ceiling), s.monthlyCostLimit, purpose)
	return err
}

func memoryExtractCostKey(attemptID int64) string {
	return "memory-extract:" + strconv.FormatInt(attemptID, 10)
}
