//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

func TestEngineRecoveryPreservesCleanupIDsAndVerifiesExportBeforeCompletion(t *testing.T) {
	s, _ := rightsFixture(t)
	ctx := context.Background()
	rel, err := s.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	proposal := `{"records":[{"id":"go-record"}],"dependencies":["source-old"]}`
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(1,$1,1);`, rel.ID); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.memorycore_operation(owner_user_id,job_id,relationship_id,source_id,operation_id,scope,revision,proposal,state) VALUES(1,987,$1,456,'recover-op','{}',0,$2,'REVOKED')`, rel.ID, proposal); err != nil {
		t.Fatal(err)
	}
	residue := true
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		action := r.URL.Path
		calls = append(calls, action)
		w.Header().Set("Content-Type", "application/json")
		switch action {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]any{"status": "revoked", "receipt": map[string]any{"recordIds": []string{"engine-record"}, "sourceIds": []string{"source-engine"}}})
		case "/internal/invalidate-scope":
			json.NewEncoder(w).Encode(map[string]int{"revision": 1})
		case "/internal/forget":
			var in struct {
				IDs                []string `json:"recordIds"`
				Sources            []string `json:"sourceIds"`
				MatchSourceRecords *bool    `json:"matchSourceRecords"`
			}
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				t.Error(err)
			}
			if in.MatchSourceRecords == nil || *in.MatchSourceRecords {
				t.Error("recovery must not expand into valid old targets")
			}
			if !reflect.DeepEqual(in.IDs, []string{"engine-record", "go-record"}) || !reflect.DeepEqual(in.Sources, []string{"source-engine", "source-old"}) {
				t.Errorf("cleanup IDs=%v sources=%v", in.IDs, in.Sources)
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
		case "/internal/export-owner":
			if residue {
				json.NewEncoder(w).Encode(map[string]any{"records": []any{}, "jsonl": []any{map[string]string{"content": "{\"id\":\"engine-record\",\"content\":\"synthetic\"}\n"}}})
			} else {
				json.NewEncoder(w).Encode(map[string]any{"records": []any{}, "jsonl": []any{}, "operations": []any{}})
			}
		default:
			t.Errorf("unexpected action %s", action)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic")
	if err != nil {
		t.Fatal(err)
	}
	s.UseMemoryEngine(client)
	t.Cleanup(func() { s.UseMemoryEngine(nil) })
	if err := s.RecoverEngineOperations(ctx); err == nil {
		t.Fatal("cleanup accepted residual JSONL")
	}
	state := func() string {
		var value string
		if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT state FROM vc.memorycore_operation WHERE owner_user_id=1 AND job_id=987`).Scan(&value)
		}); err != nil {
			t.Fatal(err)
		}
		return value
	}
	if state() != "REVOKED" {
		t.Fatal("durable cleanup IDs dropped early")
	}
	if !reflect.DeepEqual(calls, []string{"/internal/operation-status", "/internal/invalidate-scope", "/internal/forget", "/internal/export-owner"}) {
		t.Fatalf("cleanup order=%v", calls)
	}
	residue = false
	if err := s.RecoverEngineOperations(ctx); err != nil {
		t.Fatal(err)
	}
	if state() != "CLEANED" {
		t.Fatal("completed cleanup not persisted")
	}
}

func TestEngineProfileCannotLaunderParentBranchThroughIndependentChat(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	s := testEnv.store
	ctx := context.Background()
	independentID := "70000000-0000-4000-8000-000000000002"
	childID := "70000000-0000-4000-8000-000000000003"
	independent, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: independentID, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &b.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	child, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: childID, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &b.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "parent-only fact", at)
	snapshots[independentID] = stMemorySnapshot(independentID, "independent fact", at)
	snapshots[childID] = stMemorySnapshot(childID, "child fact", at)
	snapshots[childID].BranchRoot = sourceChat
	if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat, independentID, childID}); err != nil {
		t.Fatal(err)
	}
	addSTMemory(t, b, "parent-only fact", refForChat(t, sourceChat))
	addSTMemory(t, independent, "independent fact", refForChat(t, independentID))
	var fingerprint string
	var refs, ids []string
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT vc.memory_profile_fingerprint(1,$1,$2)`, independent.RelationshipID, independent.ConversationID).Scan(&fingerprint); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT COALESCE((SELECT array_agg(DISTINCT source_ref ORDER BY source_ref) FROM vc.memory_profile_allowlist(1,$1,$2)), '{}'), COALESCE((SELECT array_agg(DISTINCT record_id ORDER BY record_id) FROM vc.memory_profile_allowlist(1,$1,$2)), '{}')`, independent.RelationshipID, independent.ConversationID).Scan(&refs, &ids)
	}); err != nil {
		t.Fatal(err)
	}
	if fingerprint == "" || len(ids) != 2 || len(refs) != 2 {
		t.Fatalf("independent allowlist fingerprint=%q ids=%v refs=%v", fingerprint, ids, refs)
	}
	const persona = "累积画像含父分支事实"
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.memory_profile(owner_user_id,relationship_id,fingerprint,persona,st_source_refs,record_ids) VALUES(1,$1,$2,$3,$4,$5)`, independent.RelationshipID, fingerprint, persona, refs, ids); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,st_source_refs) VALUES(1,nextval('vc.conversation_summary_id_seq'),$1,'engine profile containing parent-only fact','memorycore','test','st-memorycore-profile-v1',1,'ECONOMY',$2)`, independent.ConversationID, refs); err != nil {
		t.Fatal(err)
	}
	chats := []stSummaryChat{{id: independent.ConversationID, chat: independentID}, {id: b.ConversationID, chat: sourceChat}, {id: child.ConversationID, chat: childID}}
	got, err := s.stSummaries(ctx, 1, independent.ConversationID, chats)
	if err != nil || len(got) != 0 {
		t.Fatalf("retired profile-v1 summary stayed on the read path: n=%d err=%v", len(got), err)
	}
	recall := func(chat string) STMemoryResult {
		t.Helper()
		out, err := s.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: chat, Revision: 1, Enabled: true, BudgetTokens: 1024})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	shared := recall(independentID)
	if !strings.Contains(shared.Block, persona) {
		t.Fatalf("independent target lost the verified profile: %+v", shared)
	}
	branched := recall(childID)
	if strings.Contains(branched.Block, "parent-only fact") || strings.Contains(branched.Block, persona) {
		t.Fatalf("parent fact laundered through independent profile: %+v", branched)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.relationship SET memory_share_scope='SESSION' WHERE owner_user_id=1 AND id=$1`, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	shared = recall(independentID)
	if strings.Contains(shared.Block, "parent-only fact") || strings.Contains(shared.Block, persona) {
		t.Fatalf("cross-chat dependency survived SESSION gate: %+v", shared)
	}
}
