package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type MemoryCoreCall struct {
	Owner, Job, Source                         int64
	ClaimToken, ClaimFence, OperationID, Stage string
	CallSequence                               int
	ProviderID, SupplierName, ModelID          string
	InputTokens, OutputTokens                  int
}

// PrepareMemoryCoreCall reuses the ST source/consent/claim admission and the
// existing attempt + cost ledger, while giving each model invocation a durable
// replay key. No transaction is held across network I/O.
func (s *Store) PrepareMemoryCoreCall(ctx context.Context, in MemoryCoreCall) (MemoryExtractPreparation, error) {
	if in.Owner <= 0 || in.Job <= 0 || in.Source <= 0 || in.OperationID == "" || len(in.OperationID) > 128 || in.CallSequence < 1 || in.CallSequence > 32 || in.InputTokens < 0 || in.OutputTokens < 1 || in.OutputTokens > 4096 {
		return MemoryExtractPreparation{}, ErrInvalid
	}
	var out MemoryExtractPreparation
	err := s.WithOwner(ctx, in.Owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT out_attempt_id,out_attempt_no,out_decision FROM vc.go_prepare_memorycore_call($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, in.Owner, in.Job, in.Source, in.ClaimToken, in.ClaimFence, in.OperationID, in.Stage, in.CallSequence, in.ProviderID, in.SupplierName, in.ModelID).Scan(&out.AttemptID, &out.AttemptNo, &out.Decision)
		if err != nil {
			return err
		}
		if out.Decision == "REPLAY" {
			return ErrConflict
		}
		if out.AttemptID > 0 && out.Decision == "EXTRACTABLE" {
			return s.reserveModelCostPurpose(ctx, tx, in.Owner, in.Job, memoryExtractCostKey(out.AttemptID), in.ProviderID, in.ModelID, PurposeMemoryExtraction, in.InputTokens, in.OutputTokens, s.maxReservedCost)
		}
		return nil
	})
	if err != nil {
		return MemoryExtractPreparation{}, mapStoreErr(err)
	}
	return out, nil
}
