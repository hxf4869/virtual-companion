package postgres

import (
	"context"
	"encoding/json"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/jackc/pgx/v5"
)

// MemoryTime keeps the immutable source clock separate from the extraction
// clock and from local event dates. The full object is stored as plaintext JSON.
type MemoryTime struct {
	SourceTimestamp *time.Time `json:"sourceTimestamp"`
	SourceTimezone  *string    `json:"sourceTimezone"`
	RecordedAt      time.Time  `json:"recordedAt"`
	memorytime.Result
}

func memoryEvidenceRefs(ctx context.Context, tx pgx.Tx, owner, id int64) ([]string, error) {
	rows, err := tx.Query(ctx, `SELECT out_source_ref FROM vc.list_memory_evidence($1,$2)`, owner, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := []string{}
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, rows.Err()
}

func (s *Store) readMemoryTime(ctx context.Context, tx pgx.Tx, owner, id int64) (*MemoryTime, error) {
	var stored *string
	if err := tx.QueryRow(ctx, `SELECT vc.get_memory_temporal($1,$2)`, owner, id).Scan(&stored); err != nil {
		return nil, err
	}
	if stored == nil {
		return nil, nil
	}
	return s.decodeMemoryTime(*stored)
}
func (s *Store) decodeMemoryTime(stored string) (*MemoryTime, error) {
	if stored == "" {
		return nil, nil
	}
	var out MemoryTime
	if json.Unmarshal([]byte(stored), &out) != nil {
		return nil, errStore
	}
	return &out, nil
}
func (s *Store) writeMemoryTime(ctx context.Context, tx pgx.Tx, owner, id int64, summary string, refs []string, replace bool) error {
	if !replace {
		existing, err := s.readMemoryTime(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if existing != nil {
			return nil
		}
	}
	out := MemoryTime{RecordedAt: time.Now().UTC()}
	// One extraction item has one source. Several references with different
	// clocks do not justify silently choosing an anchor for relative language.
	if len(refs) == 1 {
		err := tx.QueryRow(ctx, `SELECT source_timestamp,source_timezone FROM vc.st_message_source WHERE owner_user_id=$1 AND source_ref=$2`, owner, refs[0]).Scan(&out.SourceTimestamp, &out.SourceTimezone)
		if err != nil && err != pgx.ErrNoRows {
			return err
		}
	}
	var at time.Time
	var zone string
	if out.SourceTimestamp != nil {
		at = *out.SourceTimestamp
	}
	if out.SourceTimezone != nil {
		zone = *out.SourceTimezone
	}
	out.Result = memorytime.Normalize(summary, at, zone)
	// Non-temporal manual memories need no new metadata. ST sources still
	// expose their provenance even when there is no event date.
	if out.SourceTimestamp == nil && out.NormalizationStatus == memorytime.StatusNone {
		if replace {
			_, err := tx.Exec(ctx, `SELECT vc.set_memory_temporal($1,$2,NULL)`, owner, id)
			return err
		}
		return nil
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return errStore
	}
	_, err = tx.Exec(ctx, `SELECT vc.set_memory_temporal($1,$2,$3)`, owner, id, string(raw))
	return err
}

// writeVerifiedSourceTime normalizes an engine publication from the verified
// source text and that source row's frozen clock. A rewritten summary and
// evidence collected from superseded records do not choose the anchor.
func (s *Store) writeVerifiedSourceTime(ctx context.Context, tx pgx.Tx, owner, id int64, basis string, sourceID int64) error {
	existing, err := s.readMemoryTime(ctx, tx, owner, id)
	if err != nil {
		return err
	}
	if existing != nil {
		return nil
	}
	out := MemoryTime{RecordedAt: time.Now().UTC()}
	err = tx.QueryRow(ctx, `SELECT source_timestamp,source_timezone FROM vc.st_message_source WHERE owner_user_id=$1 AND id=$2`, owner, sourceID).Scan(&out.SourceTimestamp, &out.SourceTimezone)
	if err != nil {
		return err
	}
	var at time.Time
	var zone string
	if out.SourceTimestamp != nil {
		at = *out.SourceTimestamp
	}
	if out.SourceTimezone != nil {
		zone = *out.SourceTimezone
	}
	out.Result = memorytime.Normalize(basis, at, zone)
	if out.SourceTimestamp == nil && out.NormalizationStatus == memorytime.StatusNone {
		return nil
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return errStore
	}
	_, err = tx.Exec(ctx, `SELECT vc.set_memory_temporal($1,$2,$3)`, owner, id, string(raw))
	return err
}
