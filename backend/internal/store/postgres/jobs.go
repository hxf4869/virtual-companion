package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// JobClaim is one atomically claimed work_item. Token/fence are process-local
// secrets used as write capability; they are never logged.
type JobClaim struct {
	OwnerID      int64
	JobID        int64
	Kind         string
	RefID        int64
	Token        string
	Fence        string
	LeaseSeconds int
}

func (s *Store) ClaimJobs(ctx context.Context, generationLease, exportLease, defaultLease time.Duration, limit int) ([]JobClaim, error) {
	if generationLease < 5*time.Second || exportLease < 5*time.Second || defaultLease < 5*time.Second {
		return nil, ErrInvalid
	}
	if limit < 1 {
		limit = 8
	}
	var out []JobClaim
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_owner_user_id, out_job_id, out_kind, out_ref_id,
			        out_claim_token, out_claim_fence, out_lease_seconds
			   FROM vc.go_claim_jobs($1,$2,$3,$4)`,
			int(generationLease.Seconds()), int(exportLease.Seconds()),
			int(defaultLease.Seconds()), limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c JobClaim
			if err := rows.Scan(&c.OwnerID, &c.JobID, &c.Kind, &c.RefID, &c.Token, &c.Fence, &c.LeaseSeconds); err != nil {
				return err
			}
			out = append(out, c)
		}
		if out == nil {
			out = []JobClaim{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) PromoteClaimedGeneration(ctx context.Context, owner, generationID, jobID int64, token, fence string) (string, error) {
	var status string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT vc.go_promote_claimed_generation($1,$2,$3,$4,$5)`,
			owner, generationID, jobID, token, fence,
		).Scan(&status)
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	return status, nil
}

func (s *Store) CompleteJob(ctx context.Context, owner, jobID int64, token, fence, status, reason string) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx,
			`SELECT vc.go_complete_job($1,$2,$3,$4,$5,$6)`,
			owner, jobID, token, fence, status, nullIfBlank(reason),
		).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return ErrConflict
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) ListExpiredGenerationJobs(ctx context.Context, limit int) ([]JobClaim, error) {
	var out []JobClaim
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT out_owner_user_id, out_job_id FROM vc.go_list_expired_generation_jobs($1)`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c JobClaim
			if err := rows.Scan(&c.OwnerID, &c.JobID); err != nil {
				return err
			}
			c.Kind = "GENERATION"
			out = append(out, c)
		}
		if out == nil {
			out = []JobClaim{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) RecoverExpiredGeneration(ctx context.Context, owner, jobID int64) (string, error) {
	var action string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.go_recover_expired_generation($1,$2)`, owner, jobID).Scan(&action)
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	return action, nil
}

func (s *Store) ExpireQueuedGenerations(ctx context.Context, timeout time.Duration) (int, error) {
	var n int
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.go_expire_queued_generations($1)`, int(timeout.Seconds())).Scan(&n)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return n, nil
}

func (s *Store) PurgeExpiredOpaqueSessions(ctx context.Context) (int, error) {
	var n int
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.go_purge_expired_opaque_sessions()`).Scan(&n)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return n, nil
}

func (s *Store) ExpireStaleExports(ctx context.Context) (int, error) {
	var n int
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.expire_stale_exports()`).Scan(&n)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return n, nil
}

func (s *Store) ListExpiredExportObjects(ctx context.Context) ([]ExportObject, error) {
	var out []ExportObject
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_owner_user_id, out_id, out_object_key FROM vc.list_expired_export_objects()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var o ExportObject
			if err := rows.Scan(&o.OwnerUserID, &o.ExportID, &o.ObjectKey); err != nil {
				return err
			}
			out = append(out, o)
		}
		if out == nil {
			out = []ExportObject{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) RunRetentionCategory(ctx context.Context, category string, dryRun bool) error {
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.run_retention_category($1,$2)`, category, dryRun)
		return err
	})
	return mapStoreErr(err)
}

func (s *Store) GetGeneration(ctx context.Context, owner, generationID int64) (GenerationView, error) {
	var out GenerationView
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var relID int64
		var src, assistant, job pgtype.Int8
		var content pgtype.Text
		var cancel, incognito, noMem bool
		var logical, jobStatus pgtype.Text
		var created time.Time
		var gid int64
		err := tx.QueryRow(ctx,
			`SELECT out_generation_id, out_conversation_id, out_relationship_id,
			        out_logical_generation_id, out_status, out_mode, out_created_at,
			        out_source_message_id, out_assistant_message_id, out_cancel_requested,
			        out_incognito, out_user_content, out_user_no_memory, out_job_id, out_job_status
			   FROM vc.go_get_generation($1,$2)`, owner, generationID,
		).Scan(&gid, &out.ConversationID, &relID, &logical, &out.Status, &out.Mode, &created,
			&src, &assistant, &cancel, &incognito, &content, &noMem, &job, &jobStatus)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out.ID = gid
		out.CreatedAt = created.UTC()
		if logical.Valid {
			out.LogicalGenerationID = logical.String
		}
		if job.Valid {
			out.JobID = job.Int64
		}
		return nil
	})
	if err != nil {
		return GenerationView{}, mapStoreErr(err)
	}
	return out, nil
}
