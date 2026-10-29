package postgres

import (
	"context"
	"github.com/jackc/pgx/v5"
)

// engineCandidates computes the trusted allowlist using W07 scope and source
// predicates. No ranking or semantic fallback is performed in Go.
func (s *Store) engineCandidates(ctx context.Context, owner, rel, conv int64) (map[string]Memory, error) {
	projections, e := s.engineProjections(ctx, owner, rel)
	if e != nil {
		return nil, e
	}
	byID := map[int64]string{}
	for _, p := range projections {
		byID[p.MemoryID] = p.RecordID
	}
	out := map[string]Memory{}
	e = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var scope string
		if e := tx.QueryRow(ctx, `SELECT memory_share_scope FROM vc.relationship WHERE owner_user_id=$1 AND id=$2`, owner, rel).Scan(&scope); e != nil {
			return e
		}
		var after int64
		for {
			rows, e := tx.Query(ctx, `SELECT * FROM vc.query_memory_candidates($1,$2,$3,$4,$5)`, owner, rel, conv, scope, after)
			if e != nil {
				return e
			}
			n := 0
			for rows.Next() {
				var m Memory
				var temporal *string
				if e = rows.Scan(&m.ID, &m.Scope, &m.Summary, &m.ConversationID, &m.CreatedAt, &m.EventAt, &m.EventStatus, &temporal, &m.Sources); e != nil {
					rows.Close()
					return e
				}
				after = m.ID
				n++
				m.RelationshipID = rel
				if temporal != nil {
					m.Time, e = s.decodeMemoryTime(*temporal)
					if e != nil {
						rows.Close()
						return e
					}
				}
				if id := byID[m.ID]; id != "" {
					out[id] = m
				}
			}
			e = rows.Err()
			rows.Close()
			if e != nil {
				return e
			}
			if n < 256 {
				break
			}
		}
		return nil
	})
	return out, mapStoreErr(e)
}
func (s *Store) searchEngineMemories(ctx context.Context, owner, rel, conv int64, q recallQuery) ([]Memory, error) {
	candidates, e := s.engineCandidates(ctx, owner, rel, conv)
	if e != nil {
		return nil, e
	}
	ids := []string{}
	allowed := map[string]Memory{}
	for id, m := range candidates {
		if q.Date != nil && (m.Time == nil || m.Time.EventDate == nil || *m.Time.EventDate != *q.Date) {
			continue
		}
		allowed[id] = m
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return []Memory{}, nil
	}
	embedding, e := s.ResolveEmbeddingConfig(ctx, owner)
	if e != nil {
		return nil, e
	}
	var hits []struct {
		RecordID string `json:"record_id"`
		ID       string `json:"id"`
	}
	// The allowlist above is already limited to q.Date. MemoryCore must not
	// apply that date again: a merged summary can omit metadata.eventDate
	// while the Go record still carries the verified source date.
	payload := map[string]any{"scope": EngineScope(owner, rel), "allowedRecordIds": ids, "embedding": embedding, "query": q.Text, "topK": q.Limit}
	if q.Date != nil {
		payload["dateRestricted"] = true
	}
	e = s.memoryEngine.Call(ctx, "search", payload, &hits)
	if e != nil {
		return nil, e
	}
	out := []Memory{}
	seen := map[string]bool{}
	for _, hit := range hits {
		id := hit.RecordID
		if id == "" {
			id = hit.ID
		}
		if m, ok := allowed[id]; ok && !seen[m.Summary] {
			seen[m.Summary] = true
			out = append(out, m)
		}
	}
	return out, nil
}
