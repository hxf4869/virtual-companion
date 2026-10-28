package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"sort"
	"strings"
)

// BuildEngineProfile publishes only a fully verified engine profile. Model tool
// output remains inside staging until all source dependencies pass again.
func (s *Store) BuildEngineProfile(ctx context.Context, c JobClaim, op EngineOperation, token string) error {
	candidates, e := s.engineCandidates(ctx, c.OwnerID, op.Input.RelationshipID, op.Input.ConversationID)
	if e != nil {
		return e
	}
	if len(candidates) == 0 {
		return nil
	}
	ids := []string{}
	refs := []string{}
	seen := map[string]bool{}
	origin, ok := stsource.ParseRef(op.SourceRef)
	if !ok {
		return ErrInvalid
	}
	publishedHere := map[string]bool{}
	if op.ID != "" {
		projections, e := s.engineProjections(ctx, c.OwnerID, op.Input.RelationshipID)
		if e != nil {
			return e
		}
		for _, p := range projections {
			if p.OperationID == op.ID {
				publishedHere[p.RecordID] = true
			}
		}
	}
	for id, m := range candidates {
		// ST marks the actively generating chat unsettled. Keep each stored
		// conversation profile independent so it can still serve another chat.
		// A merged L1 retains all dependencies; never strip them to fit a profile.
		// A record this operation just published is the exception: a correction
		// keeps every source, including evidence from the superseded record.
		if !publishedHere[id] {
			if m.ConversationID == nil || *m.ConversationID != op.Input.ConversationID {
				continue
			}
			sameConversation := len(m.Sources) > 0
			for _, raw := range m.Sources {
				ref, valid := stsource.ParseRef(raw)
				if !valid || ref.Chat != origin.Chat {
					sameConversation = false
					break
				}
			}
			if !sameConversation {
				continue
			}
		}
		ids = append(ids, id)
		for _, ref := range m.Sources {
			if !seen[ref] {
				seen[ref] = true
				refs = append(refs, ref)
			}
		}
	}
	if len(ids) == 0 {
		return nil
	}
	sort.Strings(ids)
	sort.Strings(refs)
	deps := []string{}
	refByDependency := map[string]string{}
	e = s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		for _, ref := range refs {
			var id string
			if e := tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation FROM vc.st_message_source WHERE owner_user_id=$1 AND source_ref=$2 AND present AND eligible AND NOT suppressed`, c.OwnerID, ref).Scan(&id); e != nil {
				return e
			}
			deps = append(deps, id)
			refByDependency[id] = ref
		}
		return nil
	})
	if e != nil {
		return e
	}
	id := op.ProfileOperationID
	request := map[string]any{"scope": op.Scope, "revision": op.Revision, "operationId": id, "allowedRecordIds": ids, "operationToken": token}
	var status struct {
		Status string `json:"status"`
	}
	if e = s.memoryEngine.Call(ctx, "operation-status", request, &status); e != nil {
		return e
	}
	if status.Status == "failed" || status.Status == "revoked" {
		if e := s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `SELECT vc.go_retry_memorycore_profile($1,$2)`, c.OwnerID, c.JobID)
			return e
		}); e != nil {
			return e
		}
		return ErrConflict
	}
	if status.Status == "unknown" {
		if e = s.memoryEngine.Call(ctx, "rebuild-profile", request, nil); e != nil {
			return e
		}
	}
	if e = s.reconcileSTEvidence(ctx, c.OwnerID, refs); e != nil {
		return e
	}
	// The final definer write repeats revision/source/lease checks. A raced
	// publish cannot enter the Go summary projection.
	request["publish"] = true
	request["verifiedDependencies"] = deps
	if e = s.memoryEngine.Call(ctx, "rebuild-profile", request, nil); e != nil {
		return e
	}
	var profile struct {
		Dependencies []string          `json:"dependencies"`
		Files        map[string]string `json:"files"`
	}
	if e = s.memoryEngine.Call(ctx, "read-profile", request, &profile); e != nil {
		return e
	}
	trusted := map[string]bool{}
	for _, d := range deps {
		trusted[d] = true
	}
	if len(profile.Dependencies) == 0 {
		return ErrConflict
	}
	for _, d := range profile.Dependencies {
		if !trusted[d] {
			return ErrConflict
		}
	}
	refs = refs[:0]
	for _, dep := range profile.Dependencies {
		refs = append(refs, refByDependency[dep])
	}
	sort.Strings(refs)
	keys := []string{}
	for key := range profile.Files {
		if strings.HasSuffix(key, ".md") {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	texts := []string{}
	for _, key := range keys {
		texts = append(texts, profile.Files[key])
	}
	body := strings.Join(texts, "\n")
	if body == "" {
		return ErrInvalid
	}
	if len([]rune(body)) > 16000 {
		body = string([]rune(body)[:16000])
	}
	return mapStoreErr(s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_record_memorycore_profile($1,$2,$3,$4,$5,$6)`, c.OwnerID, c.JobID, c.Token, c.Fence, refs, body)
		return e
	}))
}
func (s *Store) RecoverEngineOperations(ctx context.Context) error {
	var tasks [][2]int64
	e := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT * FROM vc.go_revoked_memorycore_operations()`)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var t [2]int64
			if e = rows.Scan(&t[0], &t[1]); e != nil {
				return e
			}
			tasks = append(tasks, t)
		}
		return rows.Err()
	})
	if e != nil {
		return e
	}
	for _, t := range tasks {
		var rel int64
		var operation string
		var saved json.RawMessage
		e = s.WithOwner(ctx, t[0], func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT relationship_id,operation_id,proposal FROM vc.memorycore_operation WHERE owner_user_id=$1 AND job_id=$2 AND state='REVOKED'`, t[0], t[1]).Scan(&rel, &operation, &saved)
		})
		if e != nil {
			return e
		}
		// Capture durable IDs before scope invalidation scrubs engine proposals.
		// Both sides can have stopped between native commit and Go publication.
		var proposal EngineProposal
		if len(saved) > 0 && string(saved) != "null" {
			if e = json.Unmarshal(saved, &proposal); e != nil {
				return e
			}
		}
		recordIDs, sourceIDs := map[string]bool{}, map[string]bool{}
		collect := func(p EngineProposal) {
			for _, r := range p.Records {
				recordIDs[r.ID] = true
			}
			for _, id := range p.Dependencies {
				sourceIDs[id] = true
			}
		}
		collect(proposal)
		scope := EngineScope(t[0], rel)
		var status struct {
			Proposal EngineProposal `json:"proposal"`
			Receipt  struct {
				RecordIDs []string `json:"recordIds"`
				SourceIDs []string `json:"sourceIds"`
			} `json:"receipt"`
		}
		if e = s.memoryEngine.Call(ctx, "operation-status", map[string]any{"scope": scope, "operationId": operation}, &status); e != nil {
			return e
		}
		collect(status.Proposal)
		for _, id := range status.Receipt.RecordIDs {
			recordIDs[id] = true
		}
		for _, id := range status.Receipt.SourceIDs {
			sourceIDs[id] = true
		}
		ids, sources := []string{}, []string{}
		for id := range recordIDs {
			ids = append(ids, id)
		}
		for id := range sourceIDs {
			sources = append(sources, id)
		}
		sort.Strings(ids)
		sort.Strings(sources)
		scope, revision, e := s.SyncMemoryEngineScope(ctx, t[0], rel)
		if e != nil {
			return e
		}
		var result struct {
			Status string `json:"status"`
		}
		if e = s.memoryEngine.Call(ctx, "forget", map[string]any{"scope": scope, "revision": revision, "revisionAdvanced": true, "recordIds": ids, "sourceIds": sources, "matchSourceRecords": false}, &result); e != nil {
			return e
		}
		if result.Status != "cleared" {
			return fmt.Errorf("memory engine cleanup pending")
		}
		// Do not mark cleaned merely because the record left the allowlist.
		// Check all text-bearing export copies before dropping the durable IDs.
		var snapshot struct {
			Records    []EngineRecord `json:"records"`
			Operations []struct {
				Proposal EngineProposal `json:"proposal"`
			} `json:"operations"`
			JSONL []struct {
				Content string `json:"content"`
			} `json:"jsonl"`
		}
		if e = s.memoryEngine.Call(ctx, "export-owner", map[string]any{"scope": scope}, &snapshot); e != nil {
			return e
		}
		check := func(records []EngineRecord) error {
			for _, r := range records {
				if recordIDs[r.ID] {
					return fmt.Errorf("memory engine cleanup incomplete")
				}
			}
			return nil
		}
		if e = check(snapshot.Records); e != nil {
			return e
		}
		for _, op := range snapshot.Operations {
			if e = check(op.Proposal.Records); e != nil {
				return e
			}
		}
		for _, shard := range snapshot.JSONL {
			for _, line := range strings.Split(shard.Content, "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				var record EngineRecord
				if e = json.Unmarshal([]byte(line), &record); e != nil {
					return e
				}
				if e = check([]EngineRecord{record}); e != nil {
					return e
				}
			}
		}
		if e = s.WithOwner(ctx, t[0], func(ctx context.Context, tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `SELECT vc.go_memorycore_cleaned($1,$2)`, t[0], t[1])
			return e
		}); e != nil {
			return e
		}
	}
	return nil
}
