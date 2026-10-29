package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5"
	"sort"
	"strings"
)

type profileScene struct {
	File      string   `json:"file"`
	Summary   string   `json:"summary"`
	RecordIDs []string `json:"recordIds"`
}

type memoryProfile struct {
	ID        int64
	Persona   string
	Scenes    []profileScene
	Refs      []string
	RecordIDs []string
}

// BuildEngineProfile publishes one profile for the target allowlist. The same
// fingerprint skips the engine. A cross-chat merge stays out; a correction
// successor stays in only when every source still passes the allowlist.
func (s *Store) BuildEngineProfile(ctx context.Context, c JobClaim, op EngineOperation, token string) error {
	fingerprint, ids, refs, cached, e := s.profileBuildInput(ctx, c.OwnerID, op.Input.RelationshipID, op.Input.ConversationID)
	if e != nil {
		return e
	}
	if fingerprint == "" || len(ids) == 0 || cached {
		return nil
	}
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
	persona := profile.Files["persona.md"]
	if strings.TrimSpace(persona) == "" {
		return ErrInvalid
	}
	if len([]rune(persona)) > 16000 {
		persona = string([]rune(persona)[:16000])
	}
	scenes, e := profileScenes(profile.Files, ids)
	if e != nil {
		return e
	}
	encoded, e := json.Marshal(scenes)
	if e != nil {
		return e
	}
	return mapStoreErr(s.WithOwner(ctx, c.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_record_memorycore_profile($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`, c.OwnerID, c.JobID, c.Token, c.Fence, refs, persona, string(encoded), ids, fingerprint)
		return e
	}))
}
func (s *Store) profileBuildInput(ctx context.Context, owner, rel, conv int64) (string, []string, []string, bool, error) {
	var fingerprint string
	ids, refs := []string{}, []string{}
	seenID, seenRef := map[string]bool{}, map[string]bool{}
	cached := false
	e := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if e := tx.QueryRow(ctx, `SELECT vc.memory_profile_fingerprint($1,$2,$3)`, owner, rel, conv).Scan(&fingerprint); e != nil {
			return e
		}
		rows, e := tx.Query(ctx, `SELECT record_id, source_ref FROM vc.memory_profile_allowlist($1,$2,$3)`, owner, rel, conv)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var id, ref string
			if e = rows.Scan(&id, &ref); e != nil {
				return e
			}
			if id != "" && !seenID[id] {
				seenID[id] = true
				ids = append(ids, id)
			}
			if ref != "" && !seenRef[ref] {
				seenRef[ref] = true
				refs = append(refs, ref)
			}
		}
		if e = rows.Err(); e != nil {
			return e
		}
		var present bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.memory_profile_current($1,$2,$3))`, owner, rel, conv).Scan(&present); e != nil {
			return e
		}
		cached = present
		return nil
	})
	sort.Strings(ids)
	sort.Strings(refs)
	return fingerprint, ids, refs, cached, mapStoreErr(e)
}
func profileScenes(files map[string]string, allow []string) ([]profileScene, error) {
	allowSet := map[string]bool{}
	for _, id := range allow {
		allowSet[id] = true
	}
	keys := []string{}
	for key := range files {
		if strings.HasPrefix(key, "scene_blocks/") && strings.HasSuffix(key, ".md") {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	listed := map[string][]string{}
	hasIndex := false
	if raw, ok := files["scene_index.json"]; ok {
		hasIndex = true
		var asMap map[string][]string
		if json.Unmarshal([]byte(raw), &asMap) == nil && asMap != nil {
			listed = asMap
		} else {
			var asList []profileScene
			if json.Unmarshal([]byte(raw), &asList) != nil {
				return nil, ErrInvalid
			}
			for _, scene := range asList {
				listed[scene.File] = scene.RecordIDs
			}
		}
	}
	out := []profileScene{}
	for _, key := range keys {
		ids := []string{}
		if hasIndex {
			for _, id := range listed[key] {
				if allowSet[id] {
					ids = append(ids, id)
				}
			}
		} else {
			ids = append(ids, allow...)
		}
		sort.Strings(ids)
		deduped := []string{}
		prev := ""
		for _, id := range ids {
			if id == "" || id == prev {
				continue
			}
			deduped = append(deduped, id)
			prev = id
		}
		out = append(out, profileScene{File: key, Summary: files[key], RecordIDs: deduped})
	}
	return out, nil
}
func (s *Store) currentMemoryProfile(ctx context.Context, owner, rel, conv int64) (*memoryProfile, error) {
	var out memoryProfile
	var scenes []byte
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_id,out_persona,out_scenes,out_refs,out_record_ids FROM vc.memory_profile_current($1,$2,$3)`, owner, rel, conv).Scan(&out.ID, &out.Persona, &scenes, &out.Refs, &out.RecordIDs)
	})
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, mapStoreErr(err)
	}
	if len(scenes) > 0 && string(scenes) != "null" {
		if e := json.Unmarshal(scenes, &out.Scenes); e != nil {
			return nil, ErrInvalid
		}
	}
	return &out, nil
}
func (s *Store) validMemoryProfileExists(ctx context.Context, owner, rel int64) (bool, error) {
	var present bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.memory_profile WHERE owner_user_id=$1 AND relationship_id=$2 AND valid AND btrim(persona)<>'')`, owner, rel).Scan(&present)
	})
	return present, mapStoreErr(err)
}
func (s *Store) enqueueProfileRebuild(ctx context.Context, owner, rel int64) error {
	return mapStoreErr(s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_enqueue_memory_profile_rebuild($1,$2)`, owner, rel)
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
