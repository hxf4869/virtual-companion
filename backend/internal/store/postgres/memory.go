package postgres

import (
	"context"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	memoryPending   = "PENDING_CONFIRMATION"
	memoryAccepted  = "ACCEPTED"
	memoryRejected  = "REJECTED"
	maxSummaryRunes = 2000
	sourceDirect    = "USER_DIRECT"
	// memoryExtractMaxAttempts bounds extraction job retries via the V29
	// requeue path: 1 initial run + 2 retries, then DEAD_LETTERED.
	memoryExtractMaxAttempts = 3
)

// Memory is one candidate or canonical row after decrypt.
type Memory struct {
	ID                   int64
	RelationshipID       int64
	Scope                string
	Summary              string
	Status               string
	ConversationID       *int64
	DeletedAt            *time.Time
	CreatedAt            time.Time
	AutoSaved            bool
	SupersededAt         *time.Time
	SupersededByMemoryID *int64
	EventAt              *time.Time
	EventStatus          *string
	EventExpiresAt       *time.Time
}

// MemoryEvidence is one attributable source row.
type MemoryEvidence struct {
	ID        int64
	SourceRef string
	CreatedAt time.Time
}

// MemoryCreate is an Owner-explicit candidate. No auto-save path.
type MemoryCreate struct {
	RelationshipID int64
	Scope          string
	Summary        string
	ConversationID *int64
	Evidence       []string
	EventAt        *time.Time
	EventStatus    *string
	EventExpiresAt *time.Time
	IdempotencyKey string
}

func (s *Store) CreateMemoryCandidate(ctx context.Context, owner int64, in MemoryCreate) (Memory, error) {
	if err := validateMemoryCreate(in); err != nil {
		return Memory{}, err
	}
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, ok, err := scanRelationship(ctx, tx, owner, in.RelationshipID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		if err := s.guardMemorySources(ctx, tx, owner, in); err != nil {
			return err
		}
		stored, err := s.encryptStored(in.Summary)
		if err != nil {
			return errStore
		}
		evidence := in.Evidence
		if len(evidence) == 0 {
			evidence = []string{sourceDirect}
		}
		var id int64
		if err := tx.QueryRow(ctx,
			`SELECT vc.create_memory_candidate_keyed($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			owner, in.RelationshipID, in.Scope, stored, in.ConversationID, evidence,
			in.EventAt, in.EventStatus, in.EventExpiresAt, nullIfBlank(in.IdempotencyKey),
		).Scan(&id); err != nil {
			return err
		}
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return errStore
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ListMemories(ctx context.Context, owner, relationshipID int64, includeDeleted bool) ([]Memory, error) {
	var out []Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_scope, out_summary, out_status, out_conversation_id,
			        out_deleted_at, out_created_at, out_auto_saved,
			        out_superseded_at, out_superseded_by_memory_id,
			        out_event_at, out_event_status, out_event_expires_at
			   FROM vc.list_memory($1, $2, $3)`,
			owner, relationshipID, includeDeleted)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			mem, err := scanMemoryListRow(rows)
			if err != nil {
				return err
			}
			plain, err := s.decryptStored(mem.Summary)
			if err != nil {
				return errStore
			}
			mem.Summary = plain
			mem.RelationshipID = relationshipID
			out = append(out, mem)
		}
		if out == nil {
			out = []Memory{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) GetMemory(ctx context.Context, owner, memoryID int64) (Memory, error) {
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) UpdateMemory(ctx context.Context, owner, memoryID int64, summary string, eventAt *time.Time, eventStatus *string, eventExpiresAt *time.Time) (Memory, error) {
	if summary == "" || utf8.RuneCountInString(summary) > maxSummaryRunes {
		return Memory{}, ErrInvalid
	}
	if err := validateEvent(eventAt, eventStatus, eventExpiresAt); err != nil {
		return Memory{}, err
	}
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		existing, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok || (existing.Status != memoryPending && existing.Status != memoryAccepted) {
			return ErrNotFound
		}
		stored, err := s.encryptStored(summary)
		if err != nil {
			return errStore
		}
		var updated bool
		if err := tx.QueryRow(ctx, `SELECT vc.update_memory($1,$2,$3,$4,$5,$6)`,
			owner, memoryID, stored, eventAt, eventStatus, eventExpiresAt).Scan(&updated); err != nil {
			return err
		}
		if !updated {
			return ErrNotFound
		}
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) DeleteMemory(ctx context.Context, owner, memoryID int64) (Memory, error) {
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		existing, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT vc.delete_memory($1,$2)`, owner, memoryID).Scan(&deleted); err != nil {
			return err
		}
		if !deleted {
			return ErrNotFound
		}
		out = existing
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ConfirmMemory(ctx context.Context, owner, memoryID int64, supersede *int64) (Memory, error) {
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		existing, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok || existing.Status != memoryPending {
			return ErrNotFound
		}
		if supersede != nil {
			if *supersede <= 0 || *supersede == memoryID {
				return ErrInvalid
			}
			target, ok, err := s.scanMemoryGet(ctx, tx, owner, *supersede)
			if err != nil {
				return err
			}
			if !ok || target.Status != memoryAccepted || target.SupersededAt != nil ||
				target.RelationshipID != existing.RelationshipID {
				return ErrInvalid
			}
		}
		var okConfirm bool
		if err := tx.QueryRow(ctx, `SELECT vc.confirm_memory_candidate($1,$2,$3)`,
			owner, memoryID, supersede).Scan(&okConfirm); err != nil {
			return err
		}
		if !okConfirm {
			return ErrNotFound
		}
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) RejectMemory(ctx context.Context, owner, memoryID int64) (Memory, error) {
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		existing, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok || existing.Status != memoryPending {
			return ErrNotFound
		}
		var okReject bool
		if err := tx.QueryRow(ctx, `SELECT vc.reject_memory_candidate($1,$2)`, owner, memoryID).Scan(&okReject); err != nil {
			return err
		}
		if !okReject {
			return ErrNotFound
		}
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, memoryID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

// MemoryAutoSavePrefStore is the per-owner auto-save kill switch surface
// (V66). The HTTP layer binds it through a local interface; the extraction
// job reads the same pref.
type AutoSavedMemoryCreate struct {
	RelationshipID int64
	ConversationID int64
	Summary        string
	// Evidence entries use the V57 "message:<id>" shape so deleting the
	// memory flips the exact source messages to no_memory.
	Evidence       []string
	IdempotencyKey string
}

// GetMemoryAutoSavePref returns the owner's auto-memory preference (V66,
// default ON).
func (s *Store) GetMemoryAutoSavePref(ctx context.Context, owner int64) (bool, error) {
	var enabled bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT vc.get_memory_auto_save_pref($1)`, owner,
		).Scan(&enabled)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return enabled, nil
}

// UpdateMemoryAutoSavePref persists the owner's auto-memory preference.
func (s *Store) UpdateMemoryAutoSavePref(ctx context.Context, owner int64, enabled bool) (bool, error) {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT vc.set_memory_auto_save_pref($1,$2)`, owner, enabled,
		).Scan(&enabled)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return enabled, nil
}

// CreateAutoSavedMemory stores one auto-extracted memory as ACCEPTED with
// auto_saved=true, encrypting the summary with the same stored-field cipher
// as the manual candidate path. The Go side re-checks the same source guards
// the tombstone flip relies on (conversation incognito, per-message no_memory)
// before the keyed insert, so a deleted memory's sources can never re-extract.
// The insert transaction also re-reads the owner's auto-save pref and the
// outbound authorization gate: the extraction handler checks both before the
// provider call, and the owner may flip either while that call is in flight,
// so the write phase is the binding check. V128 makes that binding check
// race-free: the transaction takes the per-owner memory_write_barrier before
// the guard reads (the same lock the pref and consent writers take), and the
// per-message guard read pins the source rows FOR SHARE against the V57
// tombstone flip. Every refusal is ErrInvalid, which
// the extraction job maps to the no-retry MEMORY_SOURCE_GUARDED close.
func (s *Store) CreateAutoSavedMemory(ctx context.Context, owner int64, in AutoSavedMemoryCreate) (Memory, error) {
	if in.RelationshipID <= 0 || in.ConversationID <= 0 {
		return Memory{}, ErrInvalid
	}
	if in.Summary == "" || utf8.RuneCountInString(in.Summary) > maxSummaryRunes {
		return Memory{}, ErrInvalid
	}
	if in.IdempotencyKey != "" && !validIdempotencyKey(in.IdempotencyKey) {
		return Memory{}, ErrInvalid
	}
	var out Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		// V128: take the per-owner write barrier before any guard read. The
		// pref/consent writers (vc.set_memory_auto_save_pref and
		// vc.record_consent) take the same transactional advisory lock before
		// their updates, so a kill-switch flip or consent withdrawal either
		// commits first (the re-reads below then refuse) or waits until this
		// transaction ends: a close that has returned can never race a paused
		// write past the guards anymore.
		if _, err := tx.Exec(ctx, `SELECT vc.memory_write_barrier($1)`, owner); err != nil {
			return err
		}
		_, ok, err := scanRelationship(ctx, tx, owner, in.RelationshipID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		var incognito bool
		err = tx.QueryRow(ctx,
			`SELECT incognito FROM vc.conversation WHERE owner_user_id = $1 AND id = $2`,
			owner, in.ConversationID).Scan(&incognito)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrNotFound
			}
			return err
		}
		if incognito {
			return ErrInvalid
		}
		for _, ref := range in.Evidence {
			msgID, ok := messageRefID(ref)
			if !ok {
				return ErrInvalid
			}
			var noMemory, sourceIncognito bool
			// V128: the pinned guard read (SELECT ... FOR SHARE OF m) lives in
			// the vc.guard_auto_save_source SECURITY DEFINER helper because
			// row-lock modes need privileges the runtime roles deliberately
			// do not hold on vc.message. The SHARE lock is held until this
			// transaction ends, so the V57 tombstone flip must wait for the
			// guard window; a guard starting after the flip always reads
			// no_memory=true.
			err := tx.QueryRow(ctx, `
			SELECT out_no_memory, out_incognito
			  FROM vc.guard_auto_save_source($1, $2)`, owner, msgID).Scan(&noMemory, &sourceIncognito)
			if err != nil {
				if err == pgx.ErrNoRows {
					return ErrNotFound
				}
				return err
			}
			if noMemory || sourceIncognito {
				return ErrInvalid
			}
		}
		// Owner-level write-phase guards sit after the source guards so
		// foreign ids keep their ErrNotFound semantics; they still run in
		// the same transaction as the insert, which is the ordering that
		// matters: a pref flip or consent withdrawal during the provider
		// call always refuses the write.
		var enabled bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.get_memory_auto_save_pref($1)`, owner,
		).Scan(&enabled); err != nil {
			return err
		}
		if !enabled {
			return ErrInvalid
		}
		allowed, err := outboundAllowInTx(ctx, tx, owner)
		if err != nil {
			return err
		}
		if !allowed {
			return ErrInvalid
		}
		stored, err := s.encryptStored(in.Summary)
		if err != nil {
			return errStore
		}
		var id int64
		// RELATIONSHIP scope: the auto-extracted preference must recall into
		// later conversations of the same relationship (conversation binding
		// and the relationship FK keep it isolated everywhere else). The
		// source conversation_id is kept as provenance; the SQL function only
		// requires it for SESSION scope.
		if err := tx.QueryRow(ctx,
			`SELECT vc.create_auto_saved_memory($1,$2,'RELATIONSHIP',$3,$4,$5,$6)`,
			owner, in.RelationshipID, stored, in.ConversationID,
			in.Evidence, nullIfBlank(in.IdempotencyKey),
		).Scan(&id); err != nil {
			return err
		}
		mem, ok, err := s.scanMemoryGet(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return errStore
		}
		out = mem
		return nil
	})
	if err != nil {
		return Memory{}, mapStoreErr(err)
	}
	return out, nil
}

// outboundAllowInTx re-reads the current outbound authorization inside an
// already-open owner transaction. It uses the same SQL entry points as the
// OutboundCheck handler gate plus the shared DecideOutbound policy; the
// auto-save insert needs it because a handler-phase decision is stale by the
// time the write lands.
func outboundAllowInTx(ctx context.Context, tx pgx.Tx, owner int64) (bool, error) {
	var deleting bool
	if err := tx.QueryRow(ctx, `SELECT vc.account_deletion_intent_active_current()`).Scan(&deleting); err != nil {
		return false, err
	}
	var consents []Consent
	rows, err := tx.Query(ctx,
		`SELECT out_id, out_consent_type, out_version, out_granted, out_granted_at, out_revoked_at
		   FROM vc.list_consents($1)`, owner)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Consent
		var revoked pgtype.Timestamptz
		if err := rows.Scan(&c.ID, &c.Type, &c.Version, &c.Granted, &c.GrantedAt, &revoked); err != nil {
			return false, err
		}
		consents = append(consents, c)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	return DecideOutbound(consents, deleting).Allow, nil
}

// MemoryExtractInput is the durable read of one finished turn for extraction.
type MemoryExtractInput struct {
	RelationshipID     int64
	ConversationID     int64
	Status             string
	SourceMessageID    *int64
	AssistantMessageID *int64
	Incognito          bool
	UserContent        string
	UserNoMemory       bool
	AssistantContent   string
	AssistantNoMemory  bool
}

func (s *Store) ReadMemoryExtractInput(ctx context.Context, owner, generationID int64) (MemoryExtractInput, error) {
	var out MemoryExtractInput
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var src, assistant pgtype.Int8
		var userContent, assistantContent pgtype.Text
		err := tx.QueryRow(ctx,
			`SELECT out_relationship_id, out_conversation_id, out_status,
			        out_source_message_id, out_assistant_message_id,
			        out_incognito, out_user_content, out_user_no_memory,
			        out_assistant_content, out_assistant_no_memory
			   FROM vc.go_read_memory_extract_input($1,$2)`, owner, generationID,
		).Scan(&out.RelationshipID, &out.ConversationID, &out.Status,
			&src, &assistant, &out.Incognito,
			&userContent, &out.UserNoMemory,
			&assistantContent, &out.AssistantNoMemory)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out.SourceMessageID = int8Ptr(src)
		out.AssistantMessageID = int8Ptr(assistant)
		plainUser, err := s.decryptStored(userContent.String)
		if err != nil {
			return errStore
		}
		plainAssistant, err := s.decryptStored(assistantContent.String)
		if err != nil {
			return errStore
		}
		out.UserContent = plainUser
		out.AssistantContent = plainAssistant
		return nil
	})
	if err != nil {
		return MemoryExtractInput{}, mapStoreErr(err)
	}
	return out, nil
}

// EnqueueMemoryExtract creates the at-most-one extraction job for a completed
// generation. A suppressed turn (pref off, incognito, no_memory) returns 0
// with no error; only transport/SQL failures return errors.
func (s *Store) EnqueueMemoryExtract(ctx context.Context, owner, generationID int64) (int64, error) {
	var jobID int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		// A suppressed turn returns SQL NULL: that is a normal outcome (job 0),
		// not a scan failure, so it is scanned nullable like the other
		// nullable bigint columns in this file.
		var job pgtype.Int8
		if err := tx.QueryRow(ctx,
			`SELECT vc.enqueue_memory_extract($1,$2)`, owner, generationID,
		).Scan(&job); err != nil {
			return err
		}
		if job.Valid {
			jobID = job.Int64
		}
		return nil
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return jobID, nil
}

// RetryMemoryExtract requeues a failed extraction claim via the V29 guarded
// bounded-retry path; it returns "RETRY_SCHEDULED" or "DEAD_LETTERED".
func (s *Store) RetryMemoryExtract(ctx context.Context, owner, jobID int64, token, fence string) (string, error) {
	var action string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT vc.requeue_retryable_failure($1,$2,$3,$4,$5)`,
			owner, jobID, token, fence, memoryExtractMaxAttempts,
		).Scan(&action)
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	return action, nil
}

// messageRefID parses the evidence refs the auto-save path stores. Unlike
// parseMessageRef (owner-supplied plain ids) it accepts only the strict
// "message:<id>" shape the V57 tombstone flip depends on.
func messageRefID(ref string) (int64, bool) {
	const prefix = "message:"
	if len(ref) <= len(prefix) || ref[:len(prefix)] != prefix {
		return 0, false
	}
	return parseMessageRef(ref[len(prefix):])
}

func (s *Store) ListMemoryEvidence(ctx context.Context, owner, memoryID int64) ([]MemoryEvidence, error) {
	var out []MemoryEvidence
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_source_ref, out_created_at FROM vc.list_memory_evidence($1,$2)`,
			owner, memoryID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var e MemoryEvidence
			if err := rows.Scan(&e.ID, &e.SourceRef, &e.CreatedAt); err != nil {
				return err
			}
			out = append(out, e)
		}
		if out == nil {
			out = []MemoryEvidence{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) guardMemorySources(ctx context.Context, tx pgx.Tx, owner int64, in MemoryCreate) error {
	if in.ConversationID != nil {
		var incognito bool
		err := tx.QueryRow(ctx,
			`SELECT incognito FROM vc.conversation WHERE owner_user_id = $1 AND id = $2`,
			owner, *in.ConversationID).Scan(&incognito)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrNotFound
			}
			return err
		}
		if incognito {
			return ErrInvalid
		}
	}
	for _, ref := range in.Evidence {
		msgID, ok := parseMessageRef(ref)
		if !ok {
			continue
		}
		var noMemory, incognito bool
		err := tx.QueryRow(ctx, `
SELECT m.no_memory, c.incognito
  FROM vc.message m
  JOIN vc.conversation c
    ON c.owner_user_id = m.owner_user_id AND c.id = m.conversation_id
 WHERE m.owner_user_id = $1 AND m.id = $2`, owner, msgID).Scan(&noMemory, &incognito)
		if err != nil {
			if err == pgx.ErrNoRows {
				return ErrNotFound
			}
			return err
		}
		if noMemory || incognito {
			return ErrInvalid
		}
	}
	return nil
}

func (s *Store) scanMemoryGet(ctx context.Context, tx pgx.Tx, owner, id int64) (Memory, bool, error) {
	rows, err := tx.Query(ctx,
		`SELECT out_id, out_relationship_id, out_scope, out_summary, out_status,
		        out_conversation_id, out_created_at, out_auto_saved,
		        out_superseded_at, out_superseded_by_memory_id,
		        out_event_at, out_event_status, out_event_expires_at
		   FROM vc.get_memory($1, $2)`, owner, id)
	if err != nil {
		return Memory{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Memory{}, false, rows.Err()
	}
	var m Memory
	var stored string
	var conv, supersededBy pgtype.Int8
	var supersededAt, eventAt, eventExpires pgtype.Timestamptz
	var eventStatus pgtype.Text
	if err := rows.Scan(
		&m.ID, &m.RelationshipID, &m.Scope, &stored, &m.Status,
		&conv, &m.CreatedAt, &m.AutoSaved,
		&supersededAt, &supersededBy,
		&eventAt, &eventStatus, &eventExpires,
	); err != nil {
		return Memory{}, false, err
	}
	plain, err := s.decryptStored(stored)
	if err != nil {
		return Memory{}, false, errStore
	}
	m.Summary = plain
	m.ConversationID = int8Ptr(conv)
	m.SupersededAt = tzPtr(supersededAt)
	m.SupersededByMemoryID = int8Ptr(supersededBy)
	m.EventAt = tzPtr(eventAt)
	m.EventStatus = textPtr(eventStatus)
	m.EventExpiresAt = tzPtr(eventExpires)
	return m, true, rows.Err()
}

func scanMemoryListRow(row interface{ Scan(dest ...any) error }) (Memory, error) {
	var m Memory
	var stored string
	var conv, supersededBy pgtype.Int8
	var deletedAt, supersededAt, eventAt, eventExpires pgtype.Timestamptz
	var eventStatus pgtype.Text
	if err := row.Scan(
		&m.ID, &m.Scope, &stored, &m.Status, &conv,
		&deletedAt, &m.CreatedAt, &m.AutoSaved,
		&supersededAt, &supersededBy,
		&eventAt, &eventStatus, &eventExpires,
	); err != nil {
		return Memory{}, err
	}
	m.Summary = stored
	m.ConversationID = int8Ptr(conv)
	m.DeletedAt = tzPtr(deletedAt)
	m.SupersededAt = tzPtr(supersededAt)
	m.SupersededByMemoryID = int8Ptr(supersededBy)
	m.EventAt = tzPtr(eventAt)
	m.EventStatus = textPtr(eventStatus)
	m.EventExpiresAt = tzPtr(eventExpires)
	return m, nil
}

func validateMemoryCreate(in MemoryCreate) error {
	if in.RelationshipID <= 0 {
		return ErrInvalid
	}
	if in.Scope != "SESSION" && in.Scope != "RELATIONSHIP" {
		return ErrInvalid
	}
	if in.Summary == "" || utf8.RuneCountInString(in.Summary) > maxSummaryRunes {
		return ErrInvalid
	}
	if in.Scope == "SESSION" && (in.ConversationID == nil || *in.ConversationID <= 0) {
		return ErrInvalid
	}
	if in.ConversationID != nil && *in.ConversationID <= 0 {
		return ErrInvalid
	}
	if in.IdempotencyKey != "" && !validIdempotencyKey(in.IdempotencyKey) {
		return ErrInvalid
	}
	return validateEvent(in.EventAt, in.EventStatus, in.EventExpiresAt)
}

func validateEvent(eventAt *time.Time, eventStatus *string, eventExpiresAt *time.Time) error {
	if eventStatus != nil || eventExpiresAt != nil {
		if eventAt == nil {
			return ErrInvalid
		}
	}
	if eventStatus != nil {
		switch *eventStatus {
		case "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "UNKNOWN":
		default:
			return ErrInvalid
		}
	}
	if eventAt != nil && eventExpiresAt != nil && !eventExpiresAt.After(*eventAt) {
		return ErrInvalid
	}
	return nil
}

func validIdempotencyKey(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case c == '.' || c == '_' || c == '~' || c == '-':
		default:
			return false
		}
	}
	return true
}

func parseMessageRef(ref string) (int64, bool) {
	if ref == "" || ref == sourceDirect {
		return 0, false
	}
	n := 0
	for i := 0; i < len(ref); i++ {
		if ref[i] < '0' || ref[i] > '9' {
			return 0, false
		}
		n = n*10 + int(ref[i]-'0')
		if n > 1_000_000_000_000 {
			return 0, false
		}
	}
	if n <= 0 {
		return 0, false
	}
	return int64(n), true
}

func nullIfBlank(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func int8Ptr(v pgtype.Int8) *int64 {
	if !v.Valid {
		return nil
	}
	n := v.Int64
	return &n
}

func tzPtr(v pgtype.Timestamptz) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time.UTC()
	return &t
}

func textPtr(v pgtype.Text) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}
