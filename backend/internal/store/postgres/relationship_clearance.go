package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// RelationshipClearancePreview is the relationship-domain scope that reset
// and delete clear. Account-level records are deliberately excluded.
type RelationshipClearancePreview struct {
	RelationshipID    int64
	ConversationCount int64
	MemoryCount       int64
	ReminderCount     int64
}

// PreviewRelationshipClearance returns owner-scoped relationship-domain
// counts without disclosing whether a foreign relationship exists.
func (s *Store) PreviewRelationshipClearance(ctx context.Context, owner, id int64) (RelationshipClearancePreview, error) {
	var out RelationshipClearancePreview
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`SELECT out_conversation_count, out_memory_count, out_reminder_count
			   FROM vc.preview_relationship_clearance($1, $2)`, owner, id).Scan(
			&out.ConversationCount, &out.MemoryCount, &out.ReminderCount)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return RelationshipClearancePreview{}, mapStoreErr(err)
	}
	out.RelationshipID = id
	return out, nil
}

// ResetRelationship clears the relationship domain while retaining the
// Companion row and its structured preferences.
func (s *Store) ResetRelationship(ctx context.Context, owner, id int64, retainImportable bool) (Relationship, error) {
	var out Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var reset bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.reset_relationship($1, $2, $3)`, owner, id, retainImportable).Scan(&reset); err != nil {
			return err
		}
		if !reset {
			return ErrNotFound
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = rel
		return nil
	})
	if err != nil {
		return Relationship{}, mapStoreErr(err)
	}
	return out, nil
}
