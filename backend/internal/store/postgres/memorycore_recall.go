package postgres

import (
	"context"
	"encoding/json"
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

type engineGateText struct {
	ID        string   `json:"id"`
	Text      string   `json:"text"`
	RecordIDs []string `json:"-"`
}

type RecallObserve struct {
	SummaryAllow       int    `json:"summaryGateAllow"`
	SummaryReject      int    `json:"summaryGateReject"`
	ProfileAllow       int    `json:"profileGateAllow"`
	ProfileReject      int    `json:"profileGateReject"`
	EmbeddingCacheHit  int    `json:"embeddingCacheHit"`
	EmbeddingCacheMiss int    `json:"embeddingCacheMiss"`
	RecallEmpty        int    `json:"recallEmpty"`
	RerankDecision     string `json:"rerankDecision"`
	RerankCandidates   int    `json:"rerankCandidates"`
	RerankKept         int    `json:"rerankKept"`
	RerankOnly         int    `json:"rerankOnly"`
	RerankFallback     int    `json:"rerankFallback"`
	Searched           bool   `json:"-"`
}

type engineRecall struct {
	Memories    []Memory
	DateIDs     []string
	UndatedIDs  []string
	OtherDayIDs []string
	Gated       []string
	GateKnown   bool
	Observe     RecallObserve
}

func dateFilteredGateTexts(texts []engineGateText, sameDay []string, dated bool) []engineGateText {
	if len(texts) == 0 {
		return nil
	}
	if !dated {
		return texts
	}
	allowed := map[string]bool{}
	for _, id := range sameDay {
		allowed[id] = true
	}
	out := make([]engineGateText, 0, len(texts))
	for _, text := range texts {
		if len(text.RecordIDs) == 0 {
			out = append(out, text)
			continue
		}
		for _, id := range text.RecordIDs {
			if allowed[id] {
				out = append(out, text)
				break
			}
		}
	}
	return out
}

func (s *Store) searchEngineMemories(ctx context.Context, owner, rel, conv int64, q recallQuery) ([]Memory, error) {
	found, e := s.searchEngineRecall(ctx, owner, rel, conv, q)
	if e != nil {
		return nil, e
	}
	return found.Memories, nil
}

func (s *Store) searchEngineRecall(ctx context.Context, owner, rel, conv int64, q recallQuery) (engineRecall, error) {
	candidates, e := s.engineCandidates(ctx, owner, rel, conv)
	if e != nil {
		return engineRecall{}, e
	}
	ids := []string{}
	undated, otherDay := []string{}, []string{}
	allowed := map[string]Memory{}
	for id, m := range candidates {
		if q.Date != nil && (m.Time == nil || m.Time.EventDate == nil) {
			undated = append(undated, id)
			continue
		}
		if q.Date != nil && *m.Time.EventDate != *q.Date {
			otherDay = append(otherDay, id)
			continue
		}
		allowed[id] = m
		ids = append(ids, id)
	}
	found := engineRecall{Memories: []Memory{}, DateIDs: append([]string{}, ids...), UndatedIDs: undated, OtherDayIDs: otherDay}
	// No same-day memory. A pure schedule question has nothing to inject.
	// A question that also asks an undated topic still needs the summary gate.
	if len(ids) == 0 && (len(q.GateTexts) == 0 || !queryHasUndatedTopic(q.Text)) {
		found.GateKnown = true
		return found, nil
	}
	embedding, e := s.ResolveEmbeddingConfig(ctx, owner)
	if e != nil {
		return engineRecall{}, e
	}
	// The allowlist above is already limited to q.Date. MemoryCore must not
	// apply that date again: a merged summary can omit metadata.eventDate
	// while the Go record still carries the verified source date.
	payload := map[string]any{"scope": EngineScope(owner, rel), "allowedRecordIds": ids, "embedding": embedding, "query": q.Text, "topK": q.Limit, "observe": true}
	if q.Date != nil {
		payload["dateRestricted"] = true
	}
	if texts := dateFilteredGateTexts(q.GateTexts, ids, q.Date != nil); len(texts) > 0 {
		payload["gateTexts"] = texts
	}
	// An omitted flag leaves MemoryCore on engineRerank, so VC_RERANK_ENABLED=0
	// still disables rerank. Only an explicit false turns the owner switch off.
	rerankOn, e := s.ResolveOwnerMemoryRerank(ctx, owner)
	if e != nil {
		return engineRecall{}, e
	}
	if !rerankOn {
		payload["rerankEnabled"] = false
	}
	var raw json.RawMessage
	e = s.memoryEngine.Call(ctx, "search", payload, &raw)
	if e != nil {
		return engineRecall{}, e
	}
	hits, gated, known, observed := decodeEngineSearch(raw)
	found.Gated = gated
	found.GateKnown = known
	found.Observe = observed
	found.Observe.Searched = true
	seen := map[string]bool{}
	for _, hit := range hits {
		id := hit.RecordID
		if id == "" {
			id = hit.ID
		}
		if m, ok := allowed[id]; ok && !seen[m.Summary] {
			seen[m.Summary] = true
			found.Memories = append(found.Memories, m)
		}
	}
	if len(found.Memories) == 0 {
		found.Observe.RecallEmpty = 1
	} else {
		found.Observe.RecallEmpty = 0
	}
	return found, nil
}

type engineHit struct {
	RecordID string `json:"record_id"`
	ID       string `json:"id"`
}

func decodeEngineSearch(raw json.RawMessage) (hits []engineHit, gated []string, known bool, observed RecallObserve) {
	if len(raw) == 0 || raw[0] == '[' {
		_ = json.Unmarshal(raw, &hits)
		return hits, nil, false, RecallObserve{}
	}
	var body struct {
		Hits  []engineHit   `json:"hits"`
		Gated []string      `json:"gated"`
		Stats RecallObserve `json:"stats"`
	}
	if json.Unmarshal(raw, &body) != nil {
		return nil, nil, false, RecallObserve{}
	}
	return body.Hits, body.Gated, true, body.Stats
}
