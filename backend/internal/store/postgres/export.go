package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Export is the status view. The one-time token is never persisted here.
type Export struct {
	ID           int64
	Status       string
	RequestedAt  time.Time
	CompletedAt  *time.Time
	ExpiresAt    *time.Time
	ErrorMessage *string
}

// ExportDownload is the one-time consume result.
type ExportDownload struct {
	Payload     string
	ObjectKey   string
	ObjectBytes *int64
	ExpiresAt   time.Time
}

// ExportObject is a pointer the delete/expiry sweep must address.
type ExportObject struct {
	OwnerUserID int64
	ExportID    int64
	ObjectKey   string
}

func (s *Store) CreateExport(ctx context.Context, owner int64, token string) (Export, error) {
	if token == "" {
		return Export{}, ErrInvalid
	}
	var out Export
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT vc.count_inflight_exports($1)`, owner).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return ErrConflict
		}
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.create_export_request($1,$2)`, owner, token).Scan(&id); err != nil {
			return err
		}
		rec, ok, err := scanExport(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return errStore
		}
		out = rec
		return nil
	})
	if err != nil {
		return Export{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) GetExport(ctx context.Context, owner, exportID int64) (Export, error) {
	var out Export
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rec, ok, err := scanExport(ctx, tx, owner, exportID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = rec
		return nil
	})
	if err != nil {
		return Export{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ConsumeExport(ctx context.Context, owner, exportID int64, token string) (ExportDownload, error) {
	if token == "" {
		return ExportDownload{}, ErrInvalid
	}
	var out ExportDownload
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_payload, out_object_key, out_object_bytes, out_expires_at
			   FROM vc.consume_export($1,$2,$3)`, owner, exportID, token)
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			if err := rows.Err(); err != nil {
				return err
			}
			return ErrNotFound
		}
		var payload, key pgtype.Text
		var bytes pgtype.Int8
		var exp time.Time
		if err := rows.Scan(&payload, &key, &bytes, &exp); err != nil {
			return err
		}
		if payload.Valid && payload.String != "" {
			plain, err := s.decryptStored(payload.String)
			if err != nil {
				return errStore
			}
			out.Payload = plain
		}
		if key.Valid {
			out.ObjectKey = key.String
		}
		out.ObjectBytes = int8Ptr(bytes)
		out.ExpiresAt = exp.UTC()
		return rows.Err()
	})
	if err != nil {
		return ExportDownload{}, mapStoreErr(err)
	}
	return out, nil
}

// RecoverExport re-arms the owner's most recent unclaimed export (PENDING or
// unexpired READY) with a fresh one-time token and returns its status view;
// the previously issued token stops working when this commits. Zero rows from
// vc.recover_export_request — consumed, expired, failed, absent or refused
// under account deletion — surface as ErrNotFound (existence undisclosed).
func (s *Store) RecoverExport(ctx context.Context, owner int64, token string) (Export, error) {
	if token == "" {
		return Export{}, ErrInvalid
	}
	var out Export
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_status, out_requested_at, out_completed_at, out_expires_at, out_error_message
			   FROM vc.recover_export_request($1,$2)`, owner, token)
		if err != nil {
			return err
		}
		defer rows.Close()
		if !rows.Next() {
			if err := rows.Err(); err != nil {
				return err
			}
			return ErrNotFound
		}
		rec, err := scanExportRow(rows)
		if err != nil {
			return err
		}
		out = rec
		return rows.Err()
	})
	if err != nil {
		return Export{}, mapStoreErr(err)
	}
	return out, nil
}

// CompleteExport seals a PENDING export as READY (inline payload). Isolation
// tests and G10 worker use this; there is no HTTP complete route.
func (s *Store) CompleteExport(ctx context.Context, owner, exportID int64, payload string, expiresAt time.Time) error {
	if payload == "" || expiresAt.IsZero() {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		stored, err := s.encryptStored(payload)
		if err != nil {
			return errStore
		}
		var n int
		if err := tx.QueryRow(ctx, `SELECT vc.complete_export($1,$2,$3,$4)`,
			owner, exportID, stored, expiresAt).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

// CompleteExportObject seals READY in object mode.
func (s *Store) CompleteExportObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, expiresAt time.Time) error {
	if objectKey == "" || objectBytes < 0 || expiresAt.IsZero() {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT vc.complete_export($1,$2,NULL::text,$3,$4,$5)`,
			owner, exportID, expiresAt, objectKey, objectBytes).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

// FailExportJob closes a failed export attempt atomically under the caller's
// live job claim: vc.go_complete_job first asserts and terminalizes the claim
// (a missing, expired or overtaken claim rolls the whole transaction back),
// then vc.fail_export moves a still-PENDING export to FAILED. fail_export
// affecting 0 rows (export already terminal or absent) is not an error — the
// work item still closes and terminal exports are never regressed.
func (s *Store) FailExportJob(ctx context.Context, owner, jobID, exportID int64, token, fence, errorCode string) error {
	if token == "" || fence == "" || errorCode == "" {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var closed int
		if err := tx.QueryRow(ctx, `SELECT vc.go_complete_job($1,$2,$3,$4,'FAILED',$5)`,
			owner, jobID, token, fence, errorCode).Scan(&closed); err != nil {
			return err
		}
		if closed != 1 {
			return ErrConflict
		}
		var failed int
		if err := tx.QueryRow(ctx, `SELECT vc.fail_export($1,$2,$3)`,
			owner, exportID, errorCode).Scan(&failed); err != nil {
			return err
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) FailExportWithObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, errMsg string) error {
	if objectKey == "" {
		return ErrInvalid
	}
	if errMsg == "" {
		errMsg = "export failed"
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT vc.fail_export_with_object($1,$2,$3,$4,$5)`,
			owner, exportID, objectKey, objectBytes, errMsg).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) RecordExportUploadIntent(ctx context.Context, owner, exportID int64, objectKey string, leaseSeconds int) (int64, error) {
	if objectKey == "" || leaseSeconds < 0 || leaseSeconds > 86400 {
		return 0, ErrInvalid
	}
	var id int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.record_export_upload_intent($1,$2,$3,$4)`,
			owner, exportID, objectKey, leaseSeconds).Scan(&id)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return id, nil
}

func (s *Store) ListOwnerExportObjects(ctx context.Context, owner int64) ([]ExportObject, error) {
	var out []ExportObject
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_owner_user_id, out_id, out_object_key FROM vc.list_owner_export_objects($1)`, owner)
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

func (s *Store) ClearExportObject(ctx context.Context, owner, exportID int64, objectKey string) error {
	if objectKey == "" {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx, `SELECT vc.clear_export_object($1,$2,$3)`,
			owner, exportID, objectKey).Scan(&n); err != nil {
			return err
		}
		if n < 1 {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func scanExport(ctx context.Context, tx pgx.Tx, owner, id int64) (Export, bool, error) {
	rows, err := tx.Query(ctx,
		`SELECT out_id, out_status, out_requested_at, out_completed_at, out_expires_at, out_error_message
		   FROM vc.get_export_request($1,$2)`, owner, id)
	if err != nil {
		return Export{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Export{}, false, rows.Err()
	}
	e, err := scanExportRow(rows)
	if err != nil {
		return Export{}, false, err
	}
	return e, true, rows.Err()
}

// scanExportRow reads the six status columns shared by every export status
// function (out_id … out_error_message) from the current row.
func scanExportRow(rows pgx.Rows) (Export, error) {
	var e Export
	var completed, expires pgtype.Timestamptz
	var errMsg pgtype.Text
	if err := rows.Scan(&e.ID, &e.Status, &e.RequestedAt, &completed, &expires, &errMsg); err != nil {
		return Export{}, err
	}
	e.CompletedAt = tzPtr(completed)
	e.ExpiresAt = tzPtr(expires)
	if errMsg.Valid {
		s := errMsg.String
		e.ErrorMessage = &s
	}
	return e, nil
}
