package postgres

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var approvedReportReasons = map[string]struct{}{
	"UNSAFE_CONTENT":  {},
	"AI_IDENTITY":     {},
	"MINOR_SAFEGUARD": {},
	"PRIVACY_OR_DATA": {},
	"OTHER":           {},
}

const maxReportNoteRunes = 2000

// Report is one Owner intake row.
type Report struct {
	ID             int64
	MessageID      *int64
	Reason         string
	Note           string
	Status         string
	ResolutionNote string
	CreatedAt      time.Time
	ResolvedAt     *time.Time
}

func (s *Store) CreateReport(ctx context.Context, owner int64, messageID *int64, reason, note string) (Report, error) {
	if _, ok := approvedReportReasons[reason]; !ok {
		return Report{}, ErrInvalid
	}
	note = strings.TrimSpace(note)
	if note == "" || utf8.RuneCountInString(note) > maxReportNoteRunes {
		return Report{}, ErrInvalid
	}
	if messageID != nil && *messageID <= 0 {
		return Report{}, ErrInvalid
	}
	var out Report
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.create_report($1,$2,$3,$4)`,
			owner, messageID, reason, note).Scan(&id); err != nil {
			return err
		}
		if id <= 0 {
			return ErrNotFound
		}
		rep, ok, err := scanReport(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return errStore
		}
		out = rep
		return nil
	})
	if err != nil {
		return Report{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ListReports(ctx context.Context, owner int64, after *int64, limit *int) ([]Report, error) {
	var out []Report
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_message_id, out_reason, out_note, out_status,
			        out_resolution_note, out_created_at, out_resolved_at
			   FROM vc.list_reports($1,$2,$3)`, owner, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			rep, err := scanReportRow(rows)
			if err != nil {
				return err
			}
			out = append(out, rep)
		}
		if out == nil {
			out = []Report{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func scanReport(ctx context.Context, tx pgx.Tx, owner, id int64) (Report, bool, error) {
	rows, err := tx.Query(ctx,
		`SELECT out_id, out_message_id, out_reason, out_note, out_status,
		        out_resolution_note, out_created_at, out_resolved_at
		   FROM vc.get_report($1,$2)`, owner, id)
	if err != nil {
		return Report{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Report{}, false, rows.Err()
	}
	rep, err := scanReportRow(rows)
	if err != nil {
		return Report{}, false, err
	}
	return rep, true, rows.Err()
}

func scanReportRow(row interface{ Scan(dest ...any) error }) (Report, error) {
	var r Report
	var msg pgtype.Int8
	var resolution pgtype.Text
	var resolved pgtype.Timestamptz
	if err := row.Scan(&r.ID, &msg, &r.Reason, &r.Note, &r.Status, &resolution, &r.CreatedAt, &resolved); err != nil {
		return Report{}, err
	}
	r.MessageID = int8Ptr(msg)
	if resolution.Valid {
		r.ResolutionNote = resolution.String
	}
	r.ResolvedAt = tzPtr(resolved)
	return r, nil
}
