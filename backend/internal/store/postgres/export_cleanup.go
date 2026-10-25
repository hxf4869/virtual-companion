package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// ExportUploadCleanup holds a fenced upload intent, not a live export pointer.
type ExportUploadCleanup struct {
	OwnerID   int64
	IntentID  int64
	ObjectKey string
}

// ClaimExportUploadCleanup reuses V114's lease recheck and durable tombstone.
// Failed deletes stay discoverable; successful deletes retain their tombstone
// until the existing late-writer grace has passed.
func (s *Store) ClaimExportUploadCleanup(ctx context.Context) ([]ExportUploadCleanup, error) {
	var out []ExportUploadCleanup
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
WITH claimed AS MATERIALIZED (
    SELECT i.out_owner_user_id AS owner_id, i.out_id AS intent_id,
           vc.claim_export_upload_intent(i.out_owner_user_id, i.out_id, 900) AS object_key
      FROM vc.stale_export_upload_intents(100, 900) i
)
SELECT owner_id, intent_id, object_key FROM claimed WHERE object_key IS NOT NULL
UNION
SELECT out_owner_user_id, out_id, out_object_key
  FROM vc.claimed_export_upload_intents(100, 0)`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item ExportUploadCleanup
			if err := rows.Scan(&item.OwnerID, &item.IntentID, &item.ObjectKey); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, mapStoreErr(err)
}

func (s *Store) CompleteExportUploadCleanup(ctx context.Context, owner, intentID int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.mark_export_upload_intent_swept($1,$2)`, owner, intentID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `SELECT vc.retire_export_upload_tombstone($1,$2,900)`, owner, intentID)
		return err
	})
	return mapStoreErr(err)
}
