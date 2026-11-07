//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// Exercise the SQL contracts directly so this regression does not depend on the
// CM extraction-window candidate or its not-yet-merged EngineRecord fields.
type cm4RecordFixture struct {
	s          *Store
	binding    STBinding
	snapshots  map[string]stsource.Snapshot
	claim      JobClaim
	op         EngineOperation
	refs, keys []string // independent user A, independent user B, assistant support
}

func cm4Records(t *testing.T) *cm4RecordFixture {
	t.Helper()
	s, snapshots := engineSampleStore(t)
	t.Cleanup(func() { s.UseCipher(nil) })
	binding, err := s.ResolveSTBinding(t.Context(), 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "cm4-records", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 11, 7, 1, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stsource.Snapshot{ChatIdentity: sourceChat, BranchRoot: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/cm4.jsonl", Messages: []stsource.Message{
		{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "synthetic independent A", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "UTC"},
		{MessageID: "20000000-0000-4000-8000-000000000042", CandidateID: "30000000-0000-4000-8000-000000000042", Revision: 1, Role: "user", Text: "synthetic independent B", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "UTC"},
		{MessageID: "20000000-0000-4000-8000-000000000043", CandidateID: "30000000-0000-4000-8000-000000000043", Revision: 1, Role: "assistant", Text: "synthetic support", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "UTC"},
	}}
	if _, err = s.ReconcileSTSources(t.Context(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	f := &cm4RecordFixture{s: s, binding: binding, snapshots: snapshots}
	var anchor int64
	if err = s.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT id,source_ref,'source-'||id||'-'||source_revision||'-'||source_generation FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND present ORDER BY source_position`, binding.ConversationID)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			var ref, key string
			if e = rows.Scan(&id, &ref, &key); e != nil {
				return e
			}
			if anchor == 0 {
				anchor = id
			}
			f.refs = append(f.refs, ref)
			f.keys = append(f.keys, key)
		}
		return rows.Err()
	}); err != nil {
		t.Fatal(err)
	}
	if len(f.refs) != 3 {
		t.Fatalf("source fixture has %d refs, want 3", len(f.refs))
	}
	claims, err := s.ClaimJobs(t.Context(), time.Minute, time.Minute, time.Minute, 8, 0, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, claim := range claims {
		if claim.Kind == "ST_MEMORY_EXTRACT" && claim.RefID == anchor {
			f.claim = claim
		}
	}
	if f.claim.JobID == 0 {
		t.Fatal("anchor extraction was not claimed")
	}
	f.op, err = s.PrepareEngineOperation(t.Context(), f.claim)
	if err != nil {
		t.Fatal(err)
	}
	if f.op.SourceKey != f.keys[0] {
		t.Fatal("operation did not use A as anchor")
	}
	return f
}

func (f *cm4RecordFixture) proposal(groups ...[]int) map[string]any {
	records := []any{}
	deps := []string{}
	for i, group := range groups {
		keys := []string{}
		for _, n := range group {
			keys = append(keys, f.keys[n])
			if !slices.Contains(deps, f.keys[n]) {
				deps = append(deps, f.keys[n])
			}
		}
		records = append(records, map[string]any{"id": fmt.Sprintf("cm4-record-%c", 'a'+i), "version": 1, "content": fmt.Sprintf("synthetic fact %c", 'A'+i), "source_message_ids": keys, "metadata": map[string]any{"source_message_ids": keys, "vcDependencies": keys}})
	}
	return map[string]any{"records": records, "targets": []any{}, "dependencies": deps}
}
func (f *cm4RecordFixture) mapping(groups ...[]int) map[string]any {
	out := map[string]any{}
	for i, group := range groups {
		refs := []string{}
		for _, n := range group {
			refs = append(refs, f.refs[n])
		}
		out[fmt.Sprintf("cm4-record-%c", 'a'+i)] = refs
	}
	return out
}
func cm4JSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
func (f *cm4RecordFixture) publish(t *testing.T, proposal any, refs []string, mapping any, legacy bool) error {
	t.Helper()
	return f.s.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
		args := []any{int64(1), f.claim.JobID, f.claim.Token, f.claim.Fence, cm4JSON(t, proposal), refs}
		query := `SELECT vc.go_publish_memorycore($1,$2,$3,$4,$5::jsonb,$6::text[])`
		if !legacy {
			query = `SELECT vc.go_publish_memorycore($1,$2,$3,$4,$5::jsonb,$6::text[],$7::jsonb)`
			args = append(args, cm4JSON(t, mapping))
		}
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
}
func (f *cm4RecordFixture) clean(t *testing.T, ids []string, legacy bool) error {
	t.Helper()
	return f.s.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.memory_write_barrier(1)`); err != nil {
			return err
		}
		query := `SELECT vc.go_memorycore_cleaned(1,$1,$2::text[])`
		args := []any{f.claim.JobID, ids}
		if legacy {
			query = `SELECT vc.go_memorycore_cleaned(1,$1)`
			args = args[:1]
		}
		_, err := tx.Exec(ctx, query, args...)
		return err
	})
}
func (f *cm4RecordFixture) saved(t *testing.T) (string, map[string]any) {
	t.Helper()
	var state string
	var raw []byte
	if err := f.s.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT state,COALESCE(proposal,'{}'::jsonb) FROM vc.memorycore_operation WHERE owner_user_id=1 AND job_id=$1`, f.claim.JobID).Scan(&state, &raw)
	}); err != nil {
		t.Fatal(err)
	}
	var proposal map[string]any
	if err := json.Unmarshal(raw, &proposal); err != nil {
		t.Fatal(err)
	}
	return state, proposal
}
func (f *cm4RecordFixture) evidence(t *testing.T) map[string][]string {
	t.Helper()
	out := map[string][]string{}
	if err := f.withBoundSuper(t, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT m.engine_record_id,COALESCE(array_agg(e.source_ref ORDER BY e.source_ref) FILTER(WHERE e.source_ref IS NOT NULL),'{}') FROM vc.memory_item m LEFT JOIN vc.memory_evidence e ON (e.owner_user_id,e.memory_item_id)=(m.owner_user_id,m.id) WHERE m.owner_user_id=1 AND m.engine_operation_id=$1 GROUP BY m.engine_record_id`, f.op.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			var refs []string
			if err = rows.Scan(&id, &refs); err != nil {
				return err
			}
			out[id] = refs
		}
		return rows.Err()
	}); err != nil {
		t.Fatal(err)
	}
	return out
}
func (f *cm4RecordFixture) invalidate(t *testing.T, n int) {
	t.Helper()
	snapshot := f.snapshots[sourceChat]
	snapshot.Revision++
	snapshot.Messages[n].Revision++
	snapshot.Messages[n].Text = "synthetic changed source"
	f.snapshots[sourceChat] = snapshot
	if _, err := f.s.ReconcileSTSources(t.Context(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	if state, _ := f.saved(t); state != "REVOKED" {
		t.Fatalf("source change left operation %s", state)
	}
}

// Fault injection and raw projection assertions need superuser table access,
// while their triggers still need the same trusted owner context as runtime.
// Publication and cleanup deliberately continue through the vc_api store pool.
func (f *cm4RecordFixture) withBoundSuper(t *testing.T, work func(context.Context, pgx.Tx) error) error {
	t.Helper()
	ctx := t.Context()
	conn, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		return err
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = f.s.bindOwner(ctx, tx, 1); err != nil {
		return err
	}
	if err = work(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (f *cm4RecordFixture) exec(t *testing.T, query string, args ...any) {
	t.Helper()
	if err := f.withBoundSuper(t, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, query, args...)
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
func (f *cm4RecordFixture) assertUnpublished(t *testing.T) {
	t.Helper()
	if got := f.evidence(t); len(got) != 0 {
		t.Fatalf("rejected batch leaked projections/evidence: %v", got)
	}
	if state, _ := f.saved(t); state != "NEW" {
		t.Fatalf("rejected batch changed operation to %s", state)
	}
}

func TestCM4RecordIndependentEvidenceAndPartialCleanupRemainTracked(t *testing.T) {
	f := cm4Records(t)
	proposal := f.proposal([]int{0}, []int{1, 2})
	mapping := f.mapping([]int{0}, []int{1, 2})
	if err := f.publish(t, proposal, f.refs, mapping, false); err != nil {
		t.Fatal(err)
	}
	// Same request must not create a second projection or duplicate evidence.
	if err := f.publish(t, proposal, f.refs, mapping, false); err != nil {
		t.Fatal(err)
	}
	got := f.evidence(t)
	for id, want := range map[string][]string{"cm4-record-a": {f.refs[0]}, "cm4-record-b": {f.refs[1], f.refs[2]}} {
		slices.Sort(want)
		if !slices.Equal(got[id], want) {
			t.Fatalf("%s evidence=%v, want %v", id, got[id], want)
		}
	}
	if len(got) != 2 {
		t.Fatalf("published %d records, want 2", len(got))
	}
	_, saved := f.saved(t)
	if string(cm4JSON(t, saved["record_source_refs"])) != string(cm4JSON(t, mapping)) {
		t.Fatal("verified per-record sources were not persisted")
	}
	f.invalidate(t, 1)
	before := cm4JSON(t, saved)
	for _, retained := range [][]string{{}, {"cm4-record-a", "cm4-record-b"}, {"cm4-record-a", "cm4-record-a"}, {"cm4-record-a", "not-published"}} {
		if err := f.clean(t, retained, false); err == nil {
			t.Fatalf("invalid retained set accepted: %v", retained)
		}
		state, unchanged := f.saved(t)
		if state != "REVOKED" || string(cm4JSON(t, unchanged)) != string(before) {
			t.Fatal("failed cleanup changed durable proposal")
		}
	}
	if err := f.clean(t, []string{"cm4-record-a"}, false); err != nil {
		t.Fatal(err)
	}
	if err := f.clean(t, []string{"cm4-record-a"}, false); err != nil {
		t.Fatalf("same cleanup replay: %v", err)
	}
	state, saved := f.saved(t)
	if state != "PUBLISHED" {
		t.Fatalf("partial cleanup state=%s", state)
	}
	records := saved["records"].([]any)
	if len(records) != 1 || records[0].(map[string]any)["id"] != "cm4-record-a" {
		t.Fatal("cleanup retained invalid sibling")
	}
	if string(cm4JSON(t, saved["dependencies"])) != string(cm4JSON(t, []string{f.keys[0]})) {
		t.Fatal("cleanup retained invalid dependency keys")
	}
	if string(cm4JSON(t, saved["record_source_refs"])) != string(cm4JSON(t, f.mapping([]int{0}))) {
		t.Fatal("cleanup retained invalid per-record mapping")
	}
	if strings.Contains(string(cm4JSON(t, saved)), "synthetic fact B") || strings.Contains(string(cm4JSON(t, saved)), f.keys[1]) || strings.Contains(string(cm4JSON(t, saved)), f.refs[1]) {
		t.Fatal("cleanup retained invalid source or fact body")
	}
	if len(saved["targets"].([]any)) != 0 {
		t.Fatal("cleanup retained old targets")
	}
	kept := records[0].(map[string]any)
	if string(cm4JSON(t, kept["source_message_ids"])) != string(cm4JSON(t, []string{f.keys[0]})) ||
		string(cm4JSON(t, kept["metadata"].(map[string]any)["vcDependencies"])) != string(cm4JSON(t, []string{f.keys[0]})) {
		t.Fatal("cleanup lost the survivor's actual source keys")
	}
	if ids := profileAllowlist(t, f.binding.RelationshipID, f.binding.ConversationID); !slices.Equal(ids, []string{"cm4-record-a"}) {
		t.Fatalf("PG recall allowlist after partial cleanup=%v", ids)
	}
	if got = f.evidence(t); !slices.Equal(got["cm4-record-a"], []string{f.refs[0]}) {
		t.Fatal("partial cleanup changed A's evidence")
	}
	f.invalidate(t, 0)
	if err := f.clean(t, []string{}, false); err != nil {
		t.Fatal(err)
	}
	if err := f.clean(t, []string{}, false); err != nil {
		t.Fatalf("empty cleanup replay: %v", err)
	}
	state, saved = f.saved(t)
	if state != "CLEANED" || len(saved) != 0 {
		t.Fatalf("final cleanup state=%s proposal=%v", state, saved)
	}
}

func TestCM4RecordSharedFactLosesEitherSource(t *testing.T) {
	for _, source := range []int{0, 1} {
		t.Run(fmt.Sprintf("source-%d", source), func(t *testing.T) {
			f := cm4Records(t)
			if err := f.publish(t, f.proposal([]int{0, 1}), f.refs[:2], f.mapping([]int{0, 1}), false); err != nil {
				t.Fatal(err)
			}
			f.invalidate(t, source)
			if err := f.clean(t, []string{"cm4-record-a"}, false); err == nil {
				t.Fatal("partial dependency was accepted as a whole fact")
			}
			if err := f.clean(t, []string{}, false); err != nil {
				t.Fatal(err)
			}
			if state, _ := f.saved(t); state != "CLEANED" {
				t.Fatalf("shared fact cleanup state=%s", state)
			}
		})
	}
}

func TestCM4RecordMappingRejectsWholeBatch(t *testing.T) {
	for _, name := range []string{"missing-key", "extra-key", "empty-array", "not-array", "not-string", "duplicate-ref", "union-missing", "union-extra", "duplicate-record-id", "assistant-only", "user-not-actually-referenced"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			proposal := f.proposal([]int{0}, []int{1})
			mapping := f.mapping([]int{0}, []int{1})
			refs := slices.Clone(f.refs[:2])
			switch name {
			case "missing-key":
				delete(mapping, "cm4-record-b")
			case "extra-key":
				mapping["unknown"] = []string{f.refs[0]}
			case "empty-array":
				mapping["cm4-record-b"] = []string{}
			case "not-array":
				mapping["cm4-record-b"] = f.refs[1]
			case "not-string":
				mapping["cm4-record-b"] = []any{42}
			case "duplicate-ref":
				mapping["cm4-record-b"] = []string{f.refs[1], f.refs[1]}
			case "union-missing":
				refs = refs[:1]
			case "union-extra":
				refs = append(refs, f.refs[2])
			case "duplicate-record-id":
				proposal["records"].([]any)[1].(map[string]any)["id"] = "cm4-record-a"
			case "assistant-only":
				proposal = f.proposal([]int{0}, []int{2})
				mapping = f.mapping([]int{0}, []int{2})
				refs = []string{f.refs[0], f.refs[2]}
			case "user-not-actually-referenced":
				proposal = f.proposal([]int{0}, []int{2})
				mapping = f.mapping([]int{0}, []int{1, 2})
				refs = f.refs
			}
			if err := f.publish(t, proposal, refs, mapping, false); err == nil {
				t.Fatalf("invalid mapping %s accepted", name)
			}
			f.assertUnpublished(t)
		})
	}
}

func TestCM4RecordEmptyAndLegacyContracts(t *testing.T) {
	t.Run("empty-verified-anchor", func(t *testing.T) {
		f := cm4Records(t)
		p := f.proposal()
		p["dependencies"] = []string{f.keys[0]}
		if err := f.publish(t, p, f.refs[:1], map[string]any{}, false); err != nil {
			t.Fatal(err)
		}
		if len(f.evidence(t)) != 0 {
			t.Fatal("empty proposal created a fact")
		}
		if state, _ := f.saved(t); state != "PUBLISHED" {
			t.Fatal(state)
		}
	})
	t.Run("empty-mapping-must-be-object", func(t *testing.T) {
		f := cm4Records(t)
		if err := f.publish(t, f.proposal(), f.refs[:1], []any{}, false); err == nil {
			t.Fatal("empty mapping array accepted")
		}
		f.assertUnpublished(t)
	})
	t.Run("legacy-six-and-two", func(t *testing.T) {
		f := cm4Records(t)
		p := f.proposal([]int{0}, []int{1})
		for _, record := range p["records"].([]any) {
			delete(record.(map[string]any), "source_message_ids")
			delete(record.(map[string]any), "metadata")
		}
		if err := f.publish(t, p, f.refs[:2], nil, true); err != nil {
			t.Fatal(err)
		}
		if err := f.publish(t, p, f.refs[:2], nil, true); err != nil {
			t.Fatal(err)
		}
		for id, refs := range f.evidence(t) {
			want := slices.Clone(f.refs[:2])
			slices.Sort(want)
			if !slices.Equal(refs, want) {
				t.Fatalf("legacy %s evidence=%v", id, refs)
			}
		}
		f.invalidate(t, 1)
		if err := f.clean(t, nil, true); err != nil {
			t.Fatal(err)
		}
		if state, _ := f.saved(t); state != "CLEANED" {
			t.Fatal(state)
		}
	})
	t.Run("legacy-proposal-new-cleanup", func(t *testing.T) {
		f := cm4Records(t)
		p := f.proposal([]int{0})
		r := p["records"].([]any)[0].(map[string]any)
		delete(r, "source_message_ids")
		delete(r, "metadata")
		if err := f.publish(t, p, f.refs[:1], nil, true); err != nil {
			t.Fatal(err)
		}
		f.exec(t, `UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=1 AND job_id=$1`, f.claim.JobID)
		if err := f.clean(t, []string{"cm4-record-a"}, false); err != nil {
			t.Fatal(err)
		}
		if state, _ := f.saved(t); state != "PUBLISHED" {
			t.Fatal(state)
		}
	})
}

func TestCM4CleanupRequiresCompletePublishedEvidence(t *testing.T) {
	for _, name := range []string{"missing-all-evidence", "missing-one-of-two", "unpublished-record", "deleted-record", "superseded-record"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			group := []int{0}
			if name == "missing-one-of-two" {
				group = []int{0, 1}
			}
			groups := [][]int{group}
			if name == "missing-one-of-two" {
				// The valid sibling shares A; cleanup must invalidate only the
				// incomplete projection, without suppressing that shared source.
				groups = append(groups, []int{0})
			}
			p := f.proposal(groups...)
			if name != "unpublished-record" {
				if err := f.publish(t, p, func() []string {
					if len(group) == 2 {
						return f.refs[:2]
					}
					return f.refs[:1]
				}(), f.mapping(groups...), false); err != nil {
					t.Fatal(err)
				}
			} else {
				p["record_source_refs"] = f.mapping(group)
				f.exec(t, `UPDATE vc.memorycore_operation SET proposal=$2::jsonb WHERE owner_user_id=1 AND job_id=$1`, f.claim.JobID, cm4JSON(t, p))
			}
			switch name {
			case "missing-all-evidence":
				f.exec(t, `DELETE FROM vc.memory_evidence WHERE owner_user_id=1 AND memory_item_id IN(SELECT id FROM vc.memory_item WHERE owner_user_id=1 AND engine_operation_id=$1)`, f.op.ID)
			case "missing-one-of-two":
				f.exec(t, `DELETE FROM vc.memory_evidence WHERE owner_user_id=1 AND source_ref=$1`, f.refs[1])
			case "deleted-record":
				f.exec(t, `UPDATE vc.memory_item SET deleted_at=now() WHERE owner_user_id=1 AND engine_operation_id=$1`, f.op.ID)
			case "superseded-record":
				f.exec(t, `UPDATE vc.memory_item SET superseded_at=now() WHERE owner_user_id=1 AND engine_operation_id=$1`, f.op.ID)
			}
			f.exec(t, `UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=1 AND job_id=$1`, f.claim.JobID)
			if err := f.clean(t, []string{"cm4-record-a"}, false); err == nil {
				t.Fatalf("%s retained", name)
			}
			retained, wantState := []string{}, "CLEANED"
			if name == "missing-one-of-two" {
				retained, wantState = []string{"cm4-record-b"}, "PUBLISHED"
			}
			if err := f.clean(t, retained, false); err != nil {
				t.Fatal(err)
			}
			if state, _ := f.saved(t); state != wantState {
				t.Fatal(state)
			}
			if name == "missing-one-of-two" {
				if ids := profileAllowlist(t, f.binding.RelationshipID, f.binding.ConversationID); !slices.Equal(ids, retained) {
					t.Fatalf("incomplete projection remained recallable or valid sibling was lost: %v", ids)
				}
				var invalidated, siblingValid, sourceValid bool
				if err := f.withBoundSuper(t, func(ctx context.Context, tx pgx.Tx) error {
					return tx.QueryRow(ctx, `SELECT
					 (SELECT source_invalidated_at IS NOT NULL OR deleted_at IS NOT NULL OR superseded_at IS NOT NULL FROM vc.memory_item WHERE owner_user_id=1 AND engine_record_id='cm4-record-a'),
					 (SELECT source_invalidated_at IS NULL AND deleted_at IS NULL AND superseded_at IS NULL AND vc.st_memory_sources_valid(1,id) FROM vc.memory_item WHERE owner_user_id=1 AND engine_record_id='cm4-record-b'),
					 (SELECT present AND settled AND eligible AND NOT suppressed FROM vc.st_message_source WHERE owner_user_id=1 AND source_ref=$1)`, f.refs[0]).Scan(&invalidated, &siblingValid, &sourceValid)
				}); err != nil {
					t.Fatal(err)
				}
				if !invalidated || !siblingValid || !sourceValid {
					t.Fatalf("incomplete invalidated=%t sibling valid=%t shared A source valid=%t", invalidated, siblingValid, sourceValid)
				}
			}
		})
	}
}

func TestCM4CleanupRequiresRevokedAndRejectsDifferentReplay(t *testing.T) {
	f := cm4Records(t)
	if err := f.clean(t, []string{}, false); err == nil {
		t.Fatal("NEW operation cleaned")
	}
	if err := f.publish(t, f.proposal([]int{0}), f.refs[:1], f.mapping([]int{0}), false); err != nil {
		t.Fatal(err)
	}
	if err := f.clean(t, []string{}, false); err == nil {
		t.Fatal("PUBLISHED operation cleaned without revocation")
	}
	f.invalidate(t, 0)
	if err := f.clean(t, []string{}, false); err != nil {
		t.Fatal(err)
	}
	if err := f.clean(t, []string{"cm4-record-a"}, false); err == nil {
		t.Fatal("different request accepted after CLEANED")
	}
}

func TestCM4CleanupTemporaryAuthorityCannotEraseHistory(t *testing.T) {
	for _, name := range []string{"frozen", "go-projection-behind"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			if err := f.publish(t, f.proposal([]int{0}, []int{1}), f.refs[:2], f.mapping([]int{0}, []int{1}), false); err != nil {
				t.Fatal(err)
			}
			f.invalidate(t, 1)
			_, before := f.saved(t)
			if name == "frozen" {
				f.exec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'FROZEN',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='FROZEN'`)
			} else {
				f.exec(t, `INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,character_ref,branch_root,header_cipher,metadata_cipher,revision) VALUES(1,$1,'SINGLE',$2,$3,'cm4-records',$1,'enc2:synthetic','enc2:synthetic',99)`, sourceChat, f.binding.ConversationID, f.binding.RelationshipID)
				f.exec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='GO'`)
			}
			for _, retained := range [][]string{{}, {"cm4-record-a"}} {
				if err := f.clean(t, retained, false); err == nil {
					t.Fatalf("temporary %s accepted cleanup %v", name, retained)
				}
				state, after := f.saved(t)
				if state != "REVOKED" || string(cm4JSON(t, before)) != string(cm4JSON(t, after)) {
					t.Fatal("temporary authority changed historical proposal")
				}
			}
			if !slices.Equal(f.evidence(t)["cm4-record-a"], []string{f.refs[0]}) {
				t.Fatal("temporary authority changed historical evidence")
			}
			f.exec(t, `UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=1`)
			if err := f.clean(t, []string{"cm4-record-a"}, false); err != nil {
				t.Fatalf("restored authority could not retry: %v", err)
			}
		})
	}
}

func TestCM4RecordPublicationPreservesV290Guards(t *testing.T) {
	for _, name := range []string{"scope-revision", "claim-token", "lease-expired", "auto-save-disabled", "target-version", "incognito", "no-memory", "suppressed", "not-settled", "frozen", "go-projection-behind"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			p := f.proposal([]int{0}, []int{1})
			switch name {
			case "scope-revision":
				f.exec(t, `UPDATE vc.memorycore_scope SET revision=revision+1 WHERE owner_user_id=1 AND relationship_id=$1`, f.binding.RelationshipID)
			case "claim-token":
				f.claim.Token = "synthetic-invalid-claim"
			case "lease-expired":
				f.exec(t, `UPDATE vc.work_item SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=1 AND id=$1`, f.claim.JobID)
			case "auto-save-disabled":
				if _, err := f.s.UpdateMemoryAutoSavePref(t.Context(), 1, false); err != nil {
					t.Fatal(err)
				}
			case "target-version":
				p["targets"] = []any{map[string]any{"id": "nonexistent-target", "version": 99}}
			case "incognito":
				f.exec(t, `UPDATE vc.conversation SET incognito=true WHERE owner_user_id=1 AND id=$1`, f.binding.ConversationID)
			case "no-memory":
				f.exec(t, `UPDATE vc.st_message_source SET eligible=false WHERE owner_user_id=1 AND source_ref=$1`, f.refs[1])
			case "suppressed":
				f.exec(t, `UPDATE vc.st_message_source SET suppressed=true WHERE owner_user_id=1 AND source_ref=$1`, f.refs[1])
			case "not-settled":
				f.exec(t, `UPDATE vc.st_message_source SET settled=false WHERE owner_user_id=1 AND source_ref=$1`, f.refs[1])
			case "frozen":
				f.exec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'FROZEN',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='FROZEN'`)
			case "go-projection-behind":
				f.exec(t, `INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,character_ref,branch_root,header_cipher,metadata_cipher,revision) VALUES(1,$1,'SINGLE',$2,$3,'cm4-records',$1,'enc2:synthetic','enc2:synthetic',99)`, sourceChat, f.binding.ConversationID, f.binding.RelationshipID)
				f.exec(t, `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='GO'`)
			}
			if err := f.publish(t, p, f.refs[:2], f.mapping([]int{0}, []int{1}), false); err == nil {
				t.Fatalf("%s publication accepted", name)
			}
			if len(f.evidence(t)) != 0 {
				t.Fatal("failed guard published part of a batch")
			}
			if state, _ := f.saved(t); state == "PUBLISHED" {
				t.Fatal("failed guard marked batch published")
			}
		})
	}
}

func TestCM4RecordDependencyScopeGuards(t *testing.T) {
	for _, name := range []string{"foreign-relationship", "session-only", "assistant-cross-conversation"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			var relationship *int64
			if name != "foreign-relationship" {
				relationship = &f.binding.RelationshipID
			}
			other, err := f.s.ResolveSTBinding(t.Context(), 1, STBindingInput{ChatIdentity: chatUUID(), CharacterRef: "cm4-records", Mode: "COMPANION", RelationshipID: relationship})
			if err != nil {
				t.Fatal(err)
			}
			snapshot := f.snapshots[sourceChat]
			snapshot.ChatIdentity = other.ChatIdentity
			snapshot.BranchRoot = other.ChatIdentity
			snapshot.Messages = slices.Clone(snapshot.Messages[:1])
			snapshot.Messages[0].Text = "synthetic other conversation"
			if name == "assistant-cross-conversation" {
				snapshot.Messages[0].Role = "assistant"
			}
			f.snapshots[other.ChatIdentity] = snapshot
			if _, err = f.s.ReconcileSTSources(t.Context(), 1, []string{other.ChatIdentity}); err != nil {
				t.Fatal(err)
			}
			ref := refForChat(t, other.ChatIdentity)
			f.refs = append(f.refs, ref)
			f.keys = append(f.keys, sourceDependencyID(t, ref))
			if name == "session-only" {
				f.exec(t, `UPDATE vc.relationship SET memory_share_scope='SESSION' WHERE owner_user_id=1 AND id=$1`, f.binding.RelationshipID)
			}
			if err = f.publish(t, f.proposal([]int{0, 3}), []string{f.refs[0], ref}, f.mapping([]int{0, 3}), false); err == nil {
				t.Fatalf("%s dependency accepted", name)
			}
			if len(f.evidence(t)) != 0 {
				t.Fatal("scope rejection leaked a projection")
			}
		})
	}
}

func TestCM4RecordAssistantSupportTracksExactCandidate(t *testing.T) {
	for _, name := range []string{"edit", "delete", "switch-candidate"} {
		t.Run(name, func(t *testing.T) {
			f := cm4Records(t)
			if err := f.publish(t, f.proposal([]int{0, 2}), []string{f.refs[0], f.refs[2]}, f.mapping([]int{0, 2}), false); err != nil {
				t.Fatal(err)
			}
			snapshot := f.snapshots[sourceChat]
			snapshot.Revision++
			switch name {
			case "edit":
				snapshot.Messages[2].Revision++
				snapshot.Messages[2].Text = "synthetic edited support"
			case "delete":
				snapshot.Messages = snapshot.Messages[:2]
			case "switch-candidate":
				snapshot.Messages[2].CandidateID = "30000000-0000-4000-8000-000000000044"
				snapshot.Messages[2].Text = "synthetic other candidate"
			}
			f.snapshots[sourceChat] = snapshot
			if _, err := f.s.ReconcileSTSources(t.Context(), 1, []string{sourceChat}); err != nil {
				t.Fatal(err)
			}
			if state, _ := f.saved(t); state != "REVOKED" {
				t.Fatalf("assistant %s left operation %s", name, state)
			}
			if err := f.clean(t, []string{"cm4-record-a"}, false); err == nil {
				t.Fatalf("assistant %s retained dependent fact", name)
			}
			if err := f.clean(t, []string{}, false); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCM4RecordTargetInheritanceRequiresEveryActualSource(t *testing.T) {
	f := cm4Records(t)
	// The existing target genuinely depends on both A and B.
	if err := f.publish(t, f.proposal([]int{0, 1}), f.refs[:2], f.mapping([]int{0, 1}), false); err != nil {
		t.Fatal(err)
	}
	replacement := *f
	replacement.claim, _ = loadProfileClaim(t, f.refs[1], f.binding.RelationshipID)
	if replacement.claim.JobID == f.claim.JobID {
		t.Fatal("replacement reused the target's extraction job")
	}
	var claimed bool
	if err := f.s.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status='CLAIMED' FROM vc.work_item WHERE owner_user_id=1 AND id=$1`, replacement.claim.JobID).Scan(&claimed)
	}); err != nil || !claimed {
		t.Fatalf("replacement source job claimed=%t: %v", claimed, err)
	}
	var err error
	replacement.op, err = f.s.PrepareEngineOperation(t.Context(), replacement.claim)
	if err != nil {
		t.Fatal(err)
	}
	const newID = "cm4-record-replacement"
	proposal := func(group []int) map[string]any {
		p := replacement.proposal(group)
		record := p["records"].([]any)[0].(map[string]any)
		record["id"] = newID
		record["content"] = "synthetic replacement fact"
		record["conflictTargetIds"] = []string{"cm4-record-a"}
		p["targets"] = []any{map[string]any{"id": "cm4-record-a", "version": 1}}
		return p
	}
	// Metadata, refs and record map agree with each other, but they omit B from
	// the actual target evidence. Cross-field consistency cannot launder that loss.
	if err := replacement.publish(t, proposal([]int{0}), f.refs[:1], map[string]any{newID: f.refs[:1]}, false); err == nil {
		t.Fatal("replacement discarded an inherited target dependency")
	}
	replacement.assertUnpublished(t)
	if refs := f.evidence(t)["cm4-record-a"]; len(refs) != 2 || !slices.Contains(refs, f.refs[0]) || !slices.Contains(refs, f.refs[1]) {
		t.Fatalf("rejected replacement changed the target evidence: %v", refs)
	}
	var live bool
	if err := f.withBoundSuper(t, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT deleted_at IS NULL AND superseded_at IS NULL AND source_invalidated_at IS NULL FROM vc.memory_item WHERE owner_user_id=1 AND engine_record_id='cm4-record-a'`).Scan(&live)
	}); err != nil || !live {
		t.Fatalf("rejected replacement changed the live target: live=%t error=%v", live, err)
	}
	if err := replacement.publish(t, proposal([]int{0, 1}), f.refs[:2], map[string]any{newID: f.refs[:2]}, false); err != nil {
		t.Fatalf("replacement with complete inherited evidence: %v", err)
	}
	refs := replacement.evidence(t)[newID]
	if len(refs) != 2 || !slices.Contains(refs, f.refs[0]) || !slices.Contains(refs, f.refs[1]) {
		t.Fatalf("replacement evidence=%v, want A+B", refs)
	}
	replacement.invalidate(t, 1)
	if err := replacement.clean(t, []string{newID}, false); err == nil {
		t.Fatal("replacement survived loss of inherited B")
	}
	if err := replacement.clean(t, []string{}, false); err != nil {
		t.Fatal(err)
	}
	if ids := profileAllowlist(t, f.binding.RelationshipID, f.binding.ConversationID); len(ids) != 0 {
		t.Fatalf("invalid inherited target fact remains recallable: %v", ids)
	}
}

func TestCM4RecordSupersessionFollowsDeclaredTargets(t *testing.T) {
	const oldX, oldY = "cm4-record-a", "cm4-record-b"
	const newA, newB = "cm4-next-a", "cm4-next-b"
	type link struct {
		supersedes, supersededBy string
		superseded               bool
		managementVersion        int64
	}
	for _, tc := range []struct {
		name         string
		groups       [][]int
		declarations [][]string
		targets      []string
		want         map[string]link
		reject       bool
	}{
		{"unrelated-sibling", [][]int{{0}, {1}}, [][]string{{oldX}, {}}, []string{oldX}, map[string]link{
			oldX: {"", newA, true, 3}, oldY: {"", "", false, 7},
			newA: {oldX, "", false, 4}, newB: {"", "", false, 1},
		}, false},
		{"crossed-targets", [][]int{{1}, {0}}, [][]string{{oldY}, {oldX}}, []string{oldX, oldY}, map[string]link{
			oldX: {"", newB, true, 3}, oldY: {"", newA, true, 7},
			newA: {oldY, "", false, 8}, newB: {oldX, "", false, 4},
		}, false},
		{"shared-target-lowest-record-id", [][]int{{0}, {0}}, [][]string{{oldX}, {oldX}}, []string{oldX}, map[string]link{
			oldX: {"", newA, true, 3}, oldY: {"", "", false, 7},
			newA: {oldX, "", false, 4}, newB: {oldX, "", false, 4},
		}, false},
		{"multiple-targets-lowest-memory-id", [][]int{{0, 1}, {1}}, [][]string{{oldY, oldX}, {}}, []string{oldY, oldX}, map[string]link{
			oldX: {"", newA, true, 3}, oldY: {"", newA, true, 7},
			newA: {oldX, "", false, 4}, newB: {"", "", false, 1},
		}, false},
		{"unclaimed-target-rejects-whole-batch", [][]int{{0}, {1}}, [][]string{{oldX}, {}}, []string{oldX, oldY}, map[string]link{
			oldX: {"", "", false, 3}, oldY: {"", "", false, 7},
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := cm4Records(t)
			if err := f.publish(t, f.proposal([]int{0}, []int{1}), f.refs[:2], f.mapping([]int{0}, []int{1}), false); err != nil {
				t.Fatal(err)
			}
			f.exec(t, `UPDATE vc.memory_item SET management_version=CASE engine_record_id WHEN $1 THEN 3 ELSE 7 END WHERE owner_user_id=1 AND engine_operation_id=$2`, oldX, f.op.ID)
			replacement := *f
			replacement.claim, _ = loadProfileClaim(t, f.refs[1], f.binding.RelationshipID)
			var err error
			replacement.op, err = f.s.PrepareEngineOperation(t.Context(), replacement.claim)
			if err != nil {
				t.Fatal(err)
			}
			proposal := replacement.proposal(tc.groups...)
			mapping := replacement.mapping(tc.groups...)
			records := proposal["records"].([]any)
			for i, id := range []string{newA, newB} {
				record := records[i].(map[string]any)
				previousID := record["id"].(string)
				record["id"] = id
				record["conflictTargetIds"] = tc.declarations[i]
				mapping[id] = mapping[previousID]
				delete(mapping, previousID)
			}
			// Put B first to prove both link directions ignore batch order.
			proposal["records"] = []any{records[1], records[0]}
			targets := []any{}
			for _, id := range tc.targets {
				targets = append(targets, map[string]any{"id": id, "version": 1})
			}
			proposal["targets"] = targets
			refs := []string{}
			for _, group := range tc.groups {
				for _, i := range group {
					if !slices.Contains(refs, f.refs[i]) {
						refs = append(refs, f.refs[i])
					}
				}
			}
			err = replacement.publish(t, proposal, refs, mapping, false)
			if tc.reject {
				if err == nil || !strings.Contains(err.Error(), "memorycore target not referenced") {
					t.Fatalf("unclaimed target error=%v", err)
				}
				replacement.assertUnpublished(t)
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if err = replacement.publish(t, proposal, refs, mapping, false); err != nil {
					t.Fatalf("published replay: %v", err)
				}
			}
			got := map[string]link{}
			if err := f.withBoundSuper(t, func(ctx context.Context, tx pgx.Tx) error {
				rows, err := tx.Query(ctx, `SELECT m.engine_record_id,COALESCE(prev.engine_record_id,''),COALESCE(next.engine_record_id,''),m.superseded_at IS NOT NULL,m.management_version
 FROM vc.memory_item m
 LEFT JOIN vc.memory_item prev ON (prev.owner_user_id,prev.id)=(m.owner_user_id,m.supersedes_memory_id)
 LEFT JOIN vc.memory_item next ON (next.owner_user_id,next.id)=(m.owner_user_id,m.superseded_by_memory_id)
 WHERE m.owner_user_id=1 AND m.engine_record_id=ANY($1::text[])`, []string{oldX, oldY, newA, newB})
				if err != nil {
					return err
				}
				defer rows.Close()
				for rows.Next() {
					var id string
					var l link
					if err = rows.Scan(&id, &l.supersedes, &l.supersededBy, &l.superseded, &l.managementVersion); err != nil {
						return err
					}
					got[id] = l
				}
				return rows.Err()
			}); err != nil {
				t.Fatal(err)
			}
			for id, want := range tc.want {
				if actual, ok := got[id]; !ok || actual != want {
					t.Errorf("%s links=%+v present=%t, want %+v", id, actual, ok, want)
				}
			}
			if len(got) != len(tc.want) {
				t.Errorf("projected %d records, want %d", len(got), len(tc.want))
			}
		})
	}
}

func TestCM4RecordAndCleanupSerializeWithForget(t *testing.T) {
	for _, action := range []string{"publish", "cleanup"} {
		t.Run(action, func(t *testing.T) {
			f := cm4Records(t)
			if action == "cleanup" {
				if err := f.publish(t, f.proposal([]int{0}, []int{1}), f.refs[:2], f.mapping([]int{0}, []int{1}), false); err != nil {
					t.Fatal(err)
				}
				f.invalidate(t, 1)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			conn, err := pgx.Connect(ctx, IsolationSuperDSN())
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close(context.Background())
			forgetTx, err := conn.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer forgetTx.Rollback(context.Background())
			if err = f.s.bindOwner(ctx, forgetTx, 1); err != nil {
				t.Fatal(err)
			}
			if _, err = forgetTx.Exec(ctx, `SELECT vc.memory_write_barrier(1)`); err != nil {
				t.Fatal(err)
			}

			// Execute the actual new overload on a second vc_api connection. Publishing
			// its PID lets the forgetting transaction prove an observed lock wait before
			// changing the source; no scheduler delay stands in for that evidence.
			query := `SELECT vc.go_publish_memorycore(1,$1,$2,$3,$4::jsonb,$5::text[],$6::jsonb)`
			args := []any{f.claim.JobID, f.claim.Token, f.claim.Fence, cm4JSON(t, f.proposal([]int{0})), f.refs[:1], cm4JSON(t, f.mapping([]int{0}))}
			if action == "cleanup" {
				query = `SELECT vc.go_memorycore_cleaned(1,$1,$2::text[])`
				args = []any{f.claim.JobID, []string{"cm4-record-a"}}
			}
			pidReady, done := make(chan int32, 1), make(chan struct{})
			var callErr error
			go func() {
				defer close(done)
				callErr = f.s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
					pidReady <- int32(tx.Conn().PgConn().PID())
					_, err := tx.Exec(ctx, query, args...)
					return err
				})
			}()
			t.Cleanup(func() { cancel(); <-done })
			var waitingPID int32
			select {
			case waitingPID = <-pidReady:
			case <-done:
				t.Fatalf("%s ended before reaching the owner barrier: %v", action, callErr)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			ticker := time.NewTicker(10 * time.Millisecond)
			defer ticker.Stop()
			for {
				var blockedByForget bool
				if err = forgetTx.QueryRow(ctx, `SELECT pg_backend_pid()=ANY(pg_blocking_pids($1))`, waitingPID).Scan(&blockedByForget); err != nil {
					t.Fatal(err)
				}
				if blockedByForget {
					break
				}
				select {
				case <-done:
					t.Fatalf("%s did not wait for forgetting: %v", action, callErr)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-ticker.C:
				}
			}
			// Suppress the exact user source while still owning the barrier. The source
			// fence revokes the operation before the waiting publication/recovery runs.
			if _, err = forgetTx.Exec(ctx, `UPDATE vc.st_message_source SET suppressed=true WHERE owner_user_id=1 AND source_ref=$1`, f.refs[0]); err != nil {
				t.Fatal(err)
			}
			if err = forgetTx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			if callErr == nil {
				t.Fatalf("%s accepted a source forgotten while waiting", action)
			}
			if state, _ := f.saved(t); state != "REVOKED" {
				t.Fatalf("%s restored forgotten operation to %s", action, state)
			}
			if action == "publish" && len(f.evidence(t)) != 0 {
				t.Fatal("publication wrote new evidence after forgetting")
			}
			if err = f.clean(t, []string{}, false); err != nil {
				t.Fatalf("empty cleanup after concurrent forget: %v", err)
			}
			if state, _ := f.saved(t); state != "CLEANED" {
				t.Fatalf("empty cleanup after concurrent forget state=%s", state)
			}
			if ids := profileAllowlist(t, f.binding.RelationshipID, f.binding.ConversationID); len(ids) != 0 {
				t.Fatalf("forgotten records remained recallable: %v", ids)
			}
		})
	}
}
