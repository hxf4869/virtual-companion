package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// UseSTSourceReader installs the private persisted-source channel. No browser
// message body or claimed revision is accepted as the source of truth.
func (s *Store) UseSTSourceReader(reader stsource.Reader) { s.stSources = reader }

type STSourceState struct {
	ChatIdentity string `json:"chatIdentity"`
	State        string `json:"state"`
	Revision     *int64 `json:"revision,omitempty"`
}
type stSourceBase struct {
	stsource.Query
	incognito bool
}

type stSourceBatch struct {
	ChatStorageState
	bases  []stSourceBase
	states []STSourceState
}

// ReconcileSTSources reads only explicitly requested, owner-bound chats. In
// ST mode the HTTP read runs outside the transaction, and apply checks both
// authority epoch and applied revision before accepting the response.
func (s *Store) ReconcileSTSources(ctx context.Context, owner int64, chats []string) ([]STSourceState, error) {
	if len(chats) == 0 || len(chats) > 64 {
		return nil, ErrInvalid
	}
	seen := make(map[string]bool, len(chats))
	for _, id := range chats {
		if !stsource.ValidIdentity(id) || seen[id] {
			return nil, ErrInvalid
		}
		seen[id] = true
	}
	results := make(map[string]STSourceState, len(chats))
	var epoch int64
	for attempt := 0; len(results) < len(chats) && attempt < 3; attempt++ {
		batch, err := s.readSTSourceBatch(ctx, owner, chats)
		if err != nil {
			return nil, err
		}
		if batch.Mode != "ST" {
			return batch.states, nil
		}
		if epoch != batch.AuthorityEpoch {
			clear(results)
			epoch = batch.AuthorityEpoch
		}
		queries := make([]stsource.Query, 0, len(batch.bases)-len(results))
		for _, base := range batch.bases {
			if _, ok := results[base.ChatIdentity]; !ok {
				queries = append(queries, base.Query)
			}
		}
		var snapshots []stsource.Snapshot
		if s.stSources != nil {
			snapshots, err = s.stSources.Read(ctx, owner, queries)
			if err != nil {
				snapshots = nil
			}
		}
		byID := make(map[string]stsource.Snapshot, len(snapshots))
		for _, snap := range snapshots {
			byID[snap.ChatIdentity] = snap
		}
		// Applying snapshots writes source and memory rows that several chats
		// can share; keep these transactions sequential to avoid lock-order
		// deadlocks. Only the snapshot reads above run in parallel.
		for _, base := range batch.bases {
			if _, ok := results[base.ChatIdentity]; ok {
				continue
			}
			snap, ok := byID[base.ChatIdentity]
			if !ok || snap.State == "UNKNOWN" {
				snap = stsource.Snapshot{ChatIdentity: base.ChatIdentity, State: "UNAVAILABLE"}
			}
			state, err := s.applySTSourceSnapshot(ctx, owner, epoch, base, snap)
			if err != nil {
				return nil, err
			}
			if state.State != "RETRY" {
				results[base.ChatIdentity] = state
			}
		}
	}
	if len(results) != len(chats) {
		return nil, ErrConflict
	}
	out := make([]STSourceState, 0, len(chats))
	for _, id := range chats {
		out = append(out, results[id])
	}
	return out, nil
}
func (s *Store) readSTSourceBatch(ctx context.Context, owner int64, chats []string) (stSourceBatch, error) {
	var batch stSourceBatch
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		batch.Mode, batch.AuthorityEpoch, err = lockChatAuthority(ctx, tx, owner, false)
		if err != nil {
			return err
		}
		if batch.Mode == "GO" {
			batch.states, err = readStoredChatSourceStates(ctx, tx, owner, chats)
			return err
		}
		rows, err := tx.Query(ctx, `SELECT st_chat_identity,st_applied_revision,incognito FROM vc.conversation
			WHERE owner_user_id=$1 AND st_chat_identity=ANY($2::text[])
			ORDER BY array_position($2::text[],st_chat_identity)`, owner, chats)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var base stSourceBase
			if err := rows.Scan(&base.ChatIdentity, &base.Revision, &base.incognito); err != nil {
				return err
			}
			if batch.Mode == "ST" {
				batch.bases = append(batch.bases, base)
			} else {
				batch.states = append(batch.states, STSourceState{ChatIdentity: base.ChatIdentity, State: "UNAVAILABLE"})
			}
		}
		return rows.Err()
	})
	if err != nil {
		err = mapStoreErr(err)
		if errors.Is(err, ErrServiceOwnerRejected) {
			return stSourceBatch{}, ErrNotFound
		}
		return stSourceBatch{}, err
	}
	if len(batch.bases)+len(batch.states) != len(chats) {
		return stSourceBatch{}, ErrNotFound
	}
	return batch, nil
}
func (s *Store) applySTSourceSnapshot(ctx context.Context, owner, epoch int64, base stSourceBase, snap stsource.Snapshot) (STSourceState, error) {
	var revision *int64
	var payload []byte
	if snap.State == "PRESENT" || snap.State == "DELETED" {
		revision = &snap.Revision
	}
	if snap.State == "PRESENT" && !snap.NotModified {
		messages := make([]map[string]any, 0, len(snap.Messages))
		for _, m := range snap.Messages {
			content := ""
			if m.Eligible && !base.incognito {
				content = m.Text
			}
			messages = append(messages, map[string]any{"messageId": m.MessageID, "candidateId": m.CandidateID, "revision": m.Revision,
				"role": m.Role, "cipher": content, "settled": m.Settled, "eligible": m.Eligible && !base.incognito,
				"sourceTimestamp": m.SourceTimestamp, "sourceTimezone": m.SourceTimezone})
		}
		var err error
		payload, err = json.Marshal(messages)
		if err != nil {
			return STSourceState{}, errStore
		}
	}
	out := STSourceState{ChatIdentity: base.ChatIdentity}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		mode, currentEpoch, err := lockChatAuthority(ctx, tx, owner, true)
		if err != nil {
			return err
		}
		if mode != "ST" || currentEpoch != epoch {
			out.State = "RETRY"
			return nil
		}
		if err := tx.QueryRow(ctx, `SELECT vc.apply_st_source_snapshot($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
			owner, base.ChatIdentity, base.Revision, revision, snap.State, snap.Location, payload, nullIfBlank(snap.BranchRoot)).Scan(&out.State); err != nil {
			return err
		}
		var appliedState string
		if err := tx.QueryRow(ctx, `SELECT st_applied_revision,COALESCE(st_source_state,'UNAVAILABLE') FROM vc.conversation WHERE owner_user_id=$1 AND st_chat_identity=$2`, owner, base.ChatIdentity).Scan(&out.Revision, &appliedState); err != nil {
			return err
		}
		if out.State == "RETRY" {
			// A sibling may already have applied this revision or a newer one.
			// Its state satisfies the read without replaying old side effects.
			if snap.State == "PRESENT" && out.Revision != nil && *out.Revision >= snap.Revision {
				out.State = appliedState
			}
			return nil
		}
		if snap.State == "PRESENT" && !snap.NotModified {
			if _, err := tx.Exec(ctx, `SELECT vc.suppress_proactive_sources($1,$2)`, owner, base.ChatIdentity); err != nil {
				return mapFollowUpErr(err)
			}
		}
		// Store link observations under the same authority lock as the source.
		// A not-modified snapshot cannot change the link.
		if snap.State == "DELETED" || (snap.State == "PRESENT" && !snap.NotModified) {
			return syncSTInboxLinks(ctx, tx, owner, base.ChatIdentity, snap)
		}
		return nil
	})
	return out, mapStoreErr(err)
}

func syncSTInboxLinks(ctx context.Context, tx pgx.Tx, owner int64, chat string, snap stsource.Snapshot) error {
	rows, err := tx.Query(ctx, `
		SELECT i.event_id
		  FROM vc.inbox_event i
		  JOIN vc.conversation c
		    ON c.owner_user_id = i.owner_user_id AND c.id = i.conversation_id
		 WHERE i.owner_user_id = $1 AND c.st_chat_identity = $2
		 ORDER BY i.id`, owner, chat)
	if err != nil {
		return err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range ids {
		event, ok, err := getInboxTx(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		if status := ObserveInboxLink(event, snap); status != event.LinkStatus {
			if _, err := tx.Exec(ctx, `SELECT vc.set_inbox_link_status($1,$2,$3)`, owner, id, status); err != nil {
				return mapInboxErr(err)
			}
		}
	}
	return nil
}

// Both extraction completion and manual evidence creation re-read persisted
// sources before opening the write transaction. The SQL guard then pins their
// current source references until that transaction commits.
func (s *Store) reconcileSTEvidence(ctx context.Context, owner int64, evidence []string) error {
	var chats []string
	seen := map[string]bool{}
	for _, raw := range evidence {
		if !strings.HasPrefix(raw, "st:") {
			continue
		}
		ref, ok := stsource.ParseRef(raw)
		if !ok {
			return ErrInvalid
		}
		if !seen[ref.Chat] {
			seen[ref.Chat] = true
			chats = append(chats, ref.Chat)
		}
	}
	for start := 0; start < len(chats); start += 64 {
		end := min(start+64, len(chats))
		states, err := s.ReconcileSTSources(ctx, owner, chats[start:end])
		if err != nil {
			return err
		}
		for _, state := range states {
			if state.State != "PRESENT" {
				return ErrInvalid
			}
		}
	}
	return nil
}
func guardSTEvidence(ctx context.Context, tx pgx.Tx, owner, relationship int64, ref string) error {
	if _, ok := stsource.ParseRef(ref); !ok {
		return ErrInvalid
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `SELECT vc.guard_st_evidence_write($1,$2,$3)`, owner, relationship, ref).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrInvalid
	}
	return nil
}
