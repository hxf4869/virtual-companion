package postgres

import (
	"context"
	"sort"
	"strings"
	"unicode"

	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// recallQuery is shared by the native ST path and the remaining Go context
// builder. Scope is enforced in SQL before any text reaches the ranker.
type recallQuery struct {
	Text  string
	Date  *string
	Limit int
}
type recallCandidate struct {
	Memory
	temporal string
}

func keywordTerms(text string) map[string]bool {
	out := map[string]bool{}
	var word, han []rune
	flushWord := func() {
		if len(word) > 0 {
			numeric := true
			for _, r := range word {
				if !unicode.IsDigit(r) {
					numeric = false
					break
				}
			}
			// Short isolated date components must not match arbitrary list
			// numbers. Complete event dates have their own exact-date score.
			if !numeric || len(word) >= 4 {
				out[string(word)] = true
			}
		}
		word = nil
	}
	stop := map[string]bool{"我们": true, "用户": true, "我的": true, "什么": true, "怎么": true, "哪里": true, "哪儿": true, "现在": true, "上次": true, "之前": true, "记得": true, "准备": true, "那个": true, "这个": true, "一下": true, "有没有": true}
	flushHan := func() {
		for i := 0; i+1 < len(han); i++ {
			term := string(han[i : i+2])
			if !stop[term] {
				out[term] = true
			}
		}
		han = nil
	}
	for _, r := range strings.ToLower(text) {
		if unicode.Is(unicode.Han, r) {
			flushWord()
			han = append(han, r)
		} else if unicode.IsLetter(r) || unicode.IsDigit(r) {
			flushHan()
			word = append(word, r)
		} else {
			flushHan()
			flushWord()
		}
	}
	flushHan()
	flushWord()
	return out
}
func memoryScore(query recallQuery, m Memory) int {
	if query.Date != nil && m.Time != nil && m.Time.EventDate != nil && *query.Date != *m.Time.EventDate {
		return 0
	}
	if strings.TrimSpace(query.Text) == "" {
		return 1
	}
	score := 0
	body := strings.ToLower(m.Summary)
	for term := range keywordTerms(query.Text) {
		if strings.Contains(body, term) {
			score += len([]rune(term)) * 10
		}
	}
	if query.Date != nil && m.Time != nil && m.Time.EventDate != nil && *query.Date == *m.Time.EventDate {
		score += 1000
	}
	return score
}

func (s *Store) queryMemories(ctx context.Context, owner, relationship, conversation int64, scope string, query recallQuery) ([]Memory, error) {
	if scope == "" {
		scope = "RELATIONSHIP"
	}
	if query.Limit <= 0 {
		query.Limit = 20
	}
	candidates := []recallCandidate{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var after int64
		for {
			rows, err := tx.Query(ctx, `SELECT * FROM vc.query_memory_candidates($1,$2,$3,$4,$5)`, owner, relationship, conversation, scope, after)
			if err != nil {
				return err
			}
			count := 0
			for rows.Next() {
				var c recallCandidate
				var temporal *string
				if err := rows.Scan(&c.ID, &c.Scope, &c.Summary, &c.ConversationID, &c.CreatedAt, &c.EventAt, &c.EventStatus, &temporal, &c.Sources); err != nil {
					rows.Close()
					return err
				}
				c.RelationshipID = relationship
				after = c.ID
				count++
				if temporal != nil {
					c.temporal = *temporal
					c.Time, err = s.decodeMemoryTime(*temporal)
					if err != nil {
						rows.Close()
						return err
					}
				}
				c.Relevance = memoryScore(query, c.Memory)
				if c.Relevance > 0 {
					candidates = append(candidates, c)
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return err
			}
			if count < 256 {
				break
			}
		}
		return nil
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].Relevance != candidates[j].Relevance {
			return candidates[i].Relevance > candidates[j].Relevance
		}
		if !candidates[i].CreatedAt.Equal(candidates[j].CreatedAt) {
			return candidates[i].CreatedAt.After(candidates[j].CreatedAt)
		}
		return candidates[i].ID > candidates[j].ID
	})
	out := []Memory{}
	seenText := map[string]bool{}
	// Reconcile likely candidates, then refill once if edits/deletes removed
	// them. Bounded source IO is independent of the complete scoped ranking.
	batchSize := max(query.Limit*4, 64)
	for pass := 0; pass < 2 && pass*batchSize < len(candidates) && len(out) < query.Limit; pass++ {
		batch := candidates[pass*batchSize : min((pass+1)*batchSize, len(candidates))]
		refs := []string{}
		ids := []int64{}
		for _, c := range batch {
			refs = append(refs, c.Sources...)
			ids = append(ids, c.ID)
		}
		if err := s.reconcileSTEvidence(ctx, owner, refs); err != nil {
			return nil, err
		}
		valid := map[int64][2]string{}
		err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `SELECT * FROM vc.verified_memory_candidates($1,$2,$3,$4)`, owner, relationship, conversation, ids)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id int64
				var body string
				var temporal *string
				if err := rows.Scan(&id, &body, &temporal); err != nil {
					return err
				}
				v := [2]string{body, ""}
				if temporal != nil {
					v[1] = *temporal
				}
				valid[id] = v
			}
			return rows.Err()
		})
		if err != nil {
			return nil, mapStoreErr(err)
		}
		for _, c := range batch {
			if got, ok := valid[c.ID]; !ok || got != [2]string{c.Summary, c.temporal} {
				continue
			}
			if seenText[c.Summary] {
				continue
			}
			seenText[c.Summary] = true
			out = append(out, c.Memory)
			if len(out) == query.Limit {
				break
			}
		}
	}
	return out, nil
}

func memoryTimeLabel(m Memory) string {
	if m.Time == nil {
		return ""
	}
	if m.Time.EventDate != nil {
		return " [事件日期=" + *m.Time.EventDate + "；时区=" + valueOrEmpty(m.Time.EventTimezone) + "]"
	}
	if m.Time.NormalizationStatus == memorytime.StatusNeedsClarification {
		return " [时间待澄清，不是可触发提醒]"
	}
	return ""
}
func valueOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func sourceChats(refs []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, raw := range refs {
		if ref, ok := stsource.ParseRef(raw); ok && !seen[ref.Chat] {
			seen[ref.Chat] = true
			out = append(out, ref.Chat)
		}
	}
	return out
}
