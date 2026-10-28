package postgres

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

var ErrMemoryVersionConflict = errors.New("memory version conflict")

type MemoryFilters struct {
	Query, Status, EventDateFrom, EventDateTo, Cursor string
	Limit                                             int
}

func normalizeMemoryFilters(f MemoryFilters) (MemoryFilters, error) {
	if f.Limit == 0 {
		f.Limit = 30
	}
	if f.Limit < 1 || f.Limit > 100 || utf8.RuneCountInString(f.Query) > 2000 {
		return f, ErrInvalid
	}
	switch f.Status {
	case "", "ACTIVE", "SUPERSEDED", "FORGETTING", "FORGOTTEN", "PENDING_VERIFICATION", "INVALID":
	default:
		return f, ErrInvalid
	}
	if f.Cursor != "" {
		n, e := strconv.ParseInt(f.Cursor, 10, 64)
		if e != nil || n < 1 {
			return f, ErrInvalid
		}
	}
	for _, d := range []string{f.EventDateFrom, f.EventDateTo} {
		if d != "" {
			v, e := time.Parse("2006-01-02", d)
			if e != nil || v.Format("2006-01-02") != d {
				return f, ErrInvalid
			}
		}
	}
	if f.EventDateFrom != "" && f.EventDateTo != "" && f.EventDateFrom > f.EventDateTo {
		return f, ErrInvalid
	}
	return f, nil
}
func (s *Store) ListManagedMemories(ctx context.Context, owner, rel int64, f MemoryFilters) ([]json.RawMessage, string, error) {
	f, err := normalizeMemoryFilters(f)
	if err != nil {
		return nil, "", err
	}
	cursor, _ := strconv.ParseInt(f.Cursor, 10, 64)
	out := []json.RawMessage{}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT * FROM vc.memory_management_list($1,$2,$3,$4,$5,$6,$7,$8)`, owner, rel, f.Query, f.Status, f.EventDateFrom, f.EventDateTo, cursor, f.Limit+1)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var v json.RawMessage
			if e := rows.Scan(&v); e != nil {
				return e
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, "", mapStoreErr(err)
	}
	next := ""
	if len(out) > f.Limit {
		out = out[:f.Limit]
		var last struct {
			ID string `json:"memoryId"`
		}
		if json.Unmarshal(out[len(out)-1], &last) != nil {
			return nil, "", errStore
		}
		next = last.ID
	}
	return out, next, nil
}
func (s *Store) GetManagedMemory(ctx context.Context, owner, id int64) (json.RawMessage, error) {
	var out json.RawMessage
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_management_detail($1,$2)`, owner, id).Scan(&out)
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if len(out) == 0 || string(out) == "null" {
		return nil, ErrNotFound
	}
	return out, nil
}
func (s *Store) ManagedMemoryEvidence(ctx context.Context, owner, id int64) ([]json.RawMessage, error) {
	if _, err := s.GetManagedMemory(ctx, owner, id); err != nil {
		return nil, err
	}
	out := []json.RawMessage{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT * FROM vc.memory_management_evidence($1,$2)`, owner, id)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var v json.RawMessage
			if e := rows.Scan(&v); e != nil {
				return e
			}
			out = append(out, v)
		}
		return rows.Err()
	})
	return out, mapStoreErr(err)
}
func (s *Store) CorrectManagedMemory(ctx context.Context, owner, id, expected int64, summary string) (result json.RawMessage, resultErr error) {
	var operationID string
	var relationshipID int64
	defer func() {
		// The recovery loop can finish the very same reserved operation while
		// this HTTP request is still awaiting embedding or validating sources.
		// A committed projection is its idempotent result, not a stale edit.
		if resultErr != nil && operationID != "" {
			lookupCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			projections, lookupErr := s.engineProjections(lookupCtx, owner, relationshipID)
			if lookupErr == nil {
				for _, p := range projections {
					if p.OperationID == operationID {
						if row, readErr := s.GetManagedMemory(lookupCtx, owner, p.MemoryID); readErr == nil {
							result = row
							resultErr = nil
						}
						break
					}
				}
			}
			cancel()
		}
		if errors.Is(resultErr, memoryengine.ErrConflict) {
			resultErr = ErrMemoryVersionConflict
		}
	}()
	summary = strings.TrimSpace(summary)
	if expected < 1 || summary == "" || utf8.RuneCountInString(summary) > 2000 {
		return nil, ErrInvalid
	}
	old, err := s.GetMemory(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	refs, err := s.ListMemoryEvidence(ctx, owner, id)
	if err != nil {
		return nil, err
	}
	sources := []string{}
	for _, r := range refs {
		sources = append(sources, r.SourceRef)
	}
	if err = s.reconcileSTEvidence(ctx, owner, sources); err != nil {
		return nil, err
	}
	relationshipID = old.RelationshipID
	scope := EngineScope(owner, old.RelationshipID)
	var reserved struct {
		Conflict            bool   `json:"conflict"`
		OperationID         string `json:"operationId"`
		PreviousOperationID string `json:"previousOperationId"`
		RecordID            string `json:"recordId"`
		EngineVersion       int64  `json:"engineVersion"`
		Revision            int64  `json:"revision"`
	}
	var raw json.RawMessage
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_correction_reserve($1,$2,$3,$4,$5)`, owner, id, expected, summary, "correct-"+rand.Text()).Scan(&raw)
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if len(raw) == 0 {
		return nil, ErrNotFound
	}
	if json.Unmarshal(raw, &reserved) != nil {
		return nil, errStore
	}
	if reserved.Conflict {
		return nil, ErrMemoryVersionConflict
	}
	operationID = reserved.OperationID
	scope, currentRevision, err := s.SyncMemoryEngineScope(ctx, owner, old.RelationshipID)
	if err != nil {
		return nil, err
	}
	if currentRevision != reserved.Revision {
		next := "correct-" + rand.Text()
		var revision int64
		if err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT vc.memory_correction_rebase($1,$2,$3,$4,$5)`, owner, id, expected, reserved.OperationID, next).Scan(&revision)
		}); err != nil {
			return nil, mapStoreErr(err)
		}
		if revision < 0 {
			return nil, ErrMemoryVersionConflict
		}
		reserved.PreviousOperationID = reserved.OperationID
		reserved.OperationID = next
		operationID = next
		reserved.Revision = revision
		if _, _, err = s.SyncMemoryEngineScope(ctx, owner, old.RelationshipID); err != nil {
			return nil, err
		}
	}
	embedding, err := s.ResolveEmbeddingConfig(ctx, owner)
	if err != nil {
		return nil, err
	}
	input := map[string]any{"scope": scope, "revision": reserved.Revision, "operationId": reserved.OperationID}
	var status struct {
		Status   string          `json:"status"`
		Proposal json.RawMessage `json:"proposal"`
		Receipt  struct {
			RecordIDs []string `json:"recordIds"`
		} `json:"receipt"`
	}
	// Always inspect the durable engine receipt before attempting work again.
	if err = s.memoryEngine.Call(ctx, "operation-status", input, &status); err != nil {
		return nil, err
	}
	var proposal EngineProposal
	if len(status.Proposal) > 0 {
		if json.Unmarshal(status.Proposal, &proposal) != nil {
			return nil, errStore
		}
	}
	if status.Status == "unknown" || status.Status == "proposed" || status.Status == "failed" || status.Status == "preparing" {
		proposalInput := map[string]any{"scope": scope, "revision": reserved.Revision, "operationId": reserved.OperationID, "recordId": reserved.RecordID, "expectedVersion": reserved.EngineVersion, "summary": summary, "embedding": embedding}
		if reserved.PreviousOperationID != "" {
			proposalInput["previousOperationId"] = reserved.PreviousOperationID
		}
		if err = s.memoryEngine.Call(ctx, "correct-propose", proposalInput, &proposal); err != nil {
			return nil, err
		}
	} else if status.Status != "publishing" && status.Status != "published" {
		return nil, memoryengine.ErrUnavailable
	}
	// The engine proposal never authorizes its own commit. Re-read provenance
	// and the reserved target after potentially slow embedding work.
	if err = s.reconcileSTEvidence(ctx, owner, sources); err != nil {
		return nil, err
	}
	var verified bool
	if err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_correction_verify($1,$2,$3,$4)`, owner, id, expected, reserved.OperationID).Scan(&verified)
	}); err != nil {
		return nil, mapStoreErr(err)
	}
	if !verified {
		return nil, ErrMemoryVersionConflict
	}
	var receipt struct {
		Status    string   `json:"status"`
		RecordIDs []string `json:"recordIds"`
	}
	if status.Status == "published" {
		receipt.RecordIDs = status.Receipt.RecordIDs
		receipt.Status = "published"
	} else if err = s.memoryEngine.Call(ctx, "commit", input, &receipt); err != nil {
		// A lost response is not evidence that the write failed. Check the
		// same durable operation before returning or ever retrying work.
		checkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		checkErr := s.memoryEngine.Call(checkCtx, "operation-status", input, &status)
		cancel()
		if checkErr != nil || status.Status != "published" {
			return nil, err
		}
		receipt.RecordIDs = status.Receipt.RecordIDs
		receipt.Status = "published"
	}
	if receipt.Status != "published" || len(receipt.RecordIDs) != 1 {
		return nil, errStore
	}
	var replacementVersion int64
	for _, record := range proposal.Records {
		if record.ID == receipt.RecordIDs[0] {
			replacementVersion = record.Version
		}
	}
	if replacementVersion < 1 {
		return nil, errStore
	}

	if err = s.reconcileSTEvidence(ctx, owner, sources); err != nil {
		return nil, err
	}
	var newID int64
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if e := tx.QueryRow(ctx, `SELECT vc.memory_correction_publish($1,$2,$3,$4,$5)`, owner, id, reserved.OperationID, receipt.RecordIDs[0], replacementVersion).Scan(&newID); e != nil {
			return e
		}
		if newID == 0 {
			return ErrMemoryVersionConflict
		}
		return s.writeMemoryTime(ctx, tx, owner, newID, summary, sources, true)
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return s.GetManagedMemory(ctx, owner, newID)
}
func (s *Store) ForgetManagedMemory(ctx context.Context, owner, id int64) error {
	var found bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_forget_begin($1,$2)`, owner, id).Scan(&found)
	})
	if err != nil {
		return mapStoreErr(err)
	}
	if !found {
		return ErrNotFound
	}
	return nil
}
func (s *Store) RecoverMemoryCleanup(ctx context.Context) error {
	type pending struct{ owner, id int64 }
	items := []pending{}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT owner_id,memory_id FROM vc.memory_cleanup_pending()`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var p pending
			if e := rows.Scan(&p.owner, &p.id); e != nil {
				return e
			}
			items = append(items, p)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	var first error
	for _, p := range items {
		if e := s.continueMemoryCleanup(ctx, p.owner, p.id); e != nil && first == nil {
			first = e
		}
	}
	if e := s.recoverMemoryCorrections(ctx); e != nil && first == nil {
		first = e
	}
	return first
}
func (s *Store) continueMemoryCleanup(ctx context.Context, owner, id int64) error {
	var raw json.RawMessage
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_cleanup_input($1,$2)`, owner, id).Scan(&raw)
	})
	if err != nil {
		return err
	}
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var in struct {
		RelationshipID int64    `json:"relationshipId"`
		RecordID       *string  `json:"recordId"`
		SourceIDs      []string `json:"sourceIds"`
		Revision       int64    `json:"revision"`
	}
	if json.Unmarshal(raw, &in) != nil {
		return errStore
	}
	state := "DONE"
	if in.RecordID != nil {
		var result struct {
			Status string `json:"status"`
		}
		err = s.memoryEngine.Call(ctx, "forget", map[string]any{"scope": EngineScope(owner, in.RelationshipID), "revision": in.Revision, "recordIds": []string{*in.RecordID}, "sourceIds": in.SourceIDs}, &result)
		if err != nil {
			return err
		}
		if result.Status != "cleared" {
			state = "PARTIAL"
		}
	}
	return s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.memory_cleanup_finish($1,$2,$3)`, owner, id, state)
		return e
	})
}

func (s *Store) recoverMemoryCorrections(ctx context.Context) error {
	type correction struct {
		owner, id, version int64
		summary            string
	}
	items := []correction{}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT * FROM vc.memory_correction_pending()`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var c correction
			if e := rows.Scan(&c.owner, &c.id, &c.version, &c.summary); e != nil {
				return e
			}
			items = append(items, c)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	var first error
	for _, c := range items {
		if _, e := s.CorrectManagedMemory(ctx, c.owner, c.id, c.version, c.summary); e != nil && first == nil {
			first = e
		}
	}
	return first
}
