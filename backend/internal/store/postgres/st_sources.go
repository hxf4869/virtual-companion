package postgres

import (
	"context"
	"encoding/json"
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

// ReconcileSTSources compares only the explicitly requested, owner-bound
// chats. The HTTP read runs outside a DB transaction; apply uses a CAS on the
// applied revision so a slower response cannot undo a newer reconciliation.
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
	pending := append([]string(nil), chats...)
	results := make(map[string]STSourceState, len(chats))
	for attempt := 0; len(pending) > 0 && attempt < 3; attempt++ {
		bases, err := s.stSourceBases(ctx, owner, pending)
		if err != nil {
			return nil, err
		}
		queries := make([]stsource.Query, len(bases))
		for i, b := range bases {
			queries[i] = b.Query
		}
		var snapshots []stsource.Snapshot
		if s.stSources != nil {
			snapshots, err = s.stSources.Read(ctx, owner, queries)
		} else {
			err = stsource.ErrUnavailable
		}
		if err != nil {
			snapshots = make([]stsource.Snapshot, len(bases))
			for i, b := range bases {
				snapshots[i] = stsource.Snapshot{ChatIdentity: b.ChatIdentity, State: "UNAVAILABLE"}
			}
		}
		byID := make(map[string]stsource.Snapshot, len(snapshots))
		for _, snap := range snapshots {
			byID[snap.ChatIdentity] = snap
		}
		pending = nil
		for _, base := range bases {
			snap, ok := byID[base.ChatIdentity]
			if !ok || snap.State == "UNKNOWN" {
				snap = stsource.Snapshot{ChatIdentity: base.ChatIdentity, State: "UNAVAILABLE"}
			}
			state, err := s.applySTSourceSnapshot(ctx, owner, base, snap)
			if err != nil {
				return nil, err
			}
			if state.State == "RETRY" {
				pending = append(pending, base.ChatIdentity)
			} else {
				results[base.ChatIdentity] = state
			}
		}
	}
	if len(pending) > 0 {
		return nil, ErrConflict
	}
	out := make([]STSourceState, 0, len(chats))
	for _, id := range chats {
		out = append(out, results[id])
	}
	return out, nil
}
func (s *Store) stSourceBases(ctx context.Context, owner int64, chats []string) ([]stSourceBase, error) {
	out := make([]stSourceBase, 0, len(chats))
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT st_chat_identity,st_applied_revision,incognito FROM vc.conversation
            WHERE owner_user_id=$1 AND st_chat_identity=ANY($2::text[])`, owner, chats)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var b stSourceBase
			if err := rows.Scan(&b.ChatIdentity, &b.Revision, &b.incognito); err != nil {
				return err
			}
			out = append(out, b)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if len(out) != len(chats) {
		return nil, ErrNotFound
	}
	return out, nil
}
func (s *Store) applySTSourceSnapshot(ctx context.Context, owner int64, base stSourceBase, snap stsource.Snapshot) (STSourceState, error) {
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
		if err := tx.QueryRow(ctx, `SELECT vc.apply_st_source_snapshot($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
			owner, base.ChatIdentity, base.Revision, revision, snap.State, snap.Location, payload, nullIfBlank(snap.BranchRoot)).Scan(&out.State); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT st_applied_revision FROM vc.conversation WHERE owner_user_id=$1 AND st_chat_identity=$2`, owner, base.ChatIdentity).Scan(&out.Revision)
	})
	return out, mapStoreErr(err)
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
		if _, err := s.ReconcileSTSources(ctx, owner, chats[start:end]); err != nil {
			return err
		}
	}
	return nil
}
func guardSTEvidence(ctx context.Context, tx pgx.Tx, owner, relationship int64, ref string) error {
	if _, ok := stsource.ParseRef(ref); !ok {
		return ErrInvalid
	}
	var allowed bool
	if err := tx.QueryRow(ctx, `SELECT vc.guard_st_memory_source($1,$2,$3)`, owner, relationship, ref).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return ErrInvalid
	}
	return nil
}
