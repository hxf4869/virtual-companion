package postgres

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// ReadSTMemoryExtractInput reads the claimed job's immutable source ref, then
// reconciles its chat and reloads the plaintext text. A superseded claim never
// borrows the new candidate/revision under the same numeric source row.
func (s *Store) ReadSTMemoryExtractInput(ctx context.Context, owner, jobID, sourceID int64) (MemoryExtractInput, error) {
	var out MemoryExtractInput
	read := func() error {
		return s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			var stored string
			err := tx.QueryRow(ctx, `SELECT out_relationship_id,out_conversation_id,out_source_ref,out_content,out_eligible
                FROM vc.go_read_st_memory_extract_input($1,$2,$3)`, owner, jobID, sourceID).Scan(
				&out.RelationshipID, &out.ConversationID, &out.SourceRef, &stored, &out.ModelEligible)
			if err != nil {
				if err == pgx.ErrNoRows {
					return ErrNotFound
				}
				return err
			}
			out.UserContent = stored
			out.Status = "INELIGIBLE"
			if out.ModelEligible {
				out.Status = "COMPLETED"
			}
			return nil
		})
	}
	if err := read(); err != nil {
		return out, mapStoreErr(err)
	}
	ref, ok := stsource.ParseRef(out.SourceRef)
	if !ok {
		return out, ErrInvalid
	}
	states, err := s.ReconcileSTSources(ctx, owner, []string{ref.Chat})
	if err != nil {
		return out, err
	}
	if states[0].State == "UNAVAILABLE" {
		return out, stsource.ErrUnavailable
	}
	if err := read(); err != nil {
		return out, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) PrepareSTMemoryExtractAttempt(ctx context.Context, owner, jobID, sourceID int64, token, fence, providerID, supplierName, modelID string, inputTokens int) (MemoryExtractPreparation, error) {
	return s.prepareMemoryExtractAttempt(ctx, owner, jobID, sourceID, token, fence, providerID, supplierName, modelID, inputTokens, true)
}
