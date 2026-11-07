//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func TestEngineRecoveryCleansEachPublishedFactByItsOwnEvidence(t *testing.T) {
	for _, condition := range []string{"independent", "independent-twice", "joint-forget-a", "joint-forget-b", "concurrent", "unpublished-neighbor"} {
		t.Run(condition, func(t *testing.T) {
			s, snapshots, binding, first, a, _ := extractionWindowFixture(t)
			ctx := context.Background()
			// A supplies context only in this scenario: the fixture reserved
			// its operation but never called native prepare/commit. Finish that
			// empty setup operation before creating the batch under recovery.
			// Otherwise forgetting revokes both operations, and an unscoped
			// fake receipt could attribute B's records to A's empty operation.
			if condition != "unpublished-neighbor" {
				if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
					if _, err := tx.Exec(ctx, `SELECT vc.go_memorycore_failed(1,$1,$2,$3)`, first.JobID, first.Token, first.Fence); err != nil {
						return err
					}
					_, err := tx.Exec(ctx, `SELECT vc.go_memorycore_cleaned(1,$1,$2::text[])`, first.JobID, []string{})
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}

			job, b, window := nextExtractionWindow(t, s, snapshots, first)
			if len(window) != 3 || window[1].ID != a.SourceKey {
				t.Fatalf("second window count=%d", len(window))
			}
			joint := strings.HasPrefix(condition, "joint-")
			records := []EngineRecord{windowRecord("record-a", "合成事实 A", a.SourceKey), windowRecord("record-b", "合成事实 B", b.SourceKey)}
			if joint {
				records = []EngineRecord{windowRecord("record-ab", "合成联合事实", a.SourceKey, b.SourceKey)}
			}
			raw := windowProposal(t, window, records...)
			for range 2 {
				if err := s.PublishEngineProposal(ctx, job, b, raw); err != nil {
					t.Fatal(err)
				}
			}
			projections, err := s.engineCandidates(ctx, 1, binding.RelationshipID, binding.ConversationID)
			if err != nil || len(projections) != len(records) {
				t.Fatalf("publication count=%d: %v", len(projections), err)
			}
			var forgotten int64
			if joint {
				ref := b.SourceRef
				if condition == "joint-forget-a" {
					ref = a.SourceRef
				}
				forgotten = addSTMemory(t, binding, "将抑制联合事实的一个来源", ref).ID
				refs := projections["record-ab"].Sources
				if len(refs) != 2 || !slices.Contains(refs, a.SourceRef) || !slices.Contains(refs, b.SourceRef) {
					t.Fatalf("joint evidence: %v", refs)
				}
			} else {
				if !slices.Equal(projections["record-a"].Sources, []string{a.SourceRef}) ||
					!slices.Equal(projections["record-b"].Sources, []string{b.SourceRef}) {
					t.Fatalf("independent records did not receive their own evidence")
				}
				forgotten = projections["record-b"].ID
			}
			if err := s.ForgetManagedMemory(ctx, 1, forgotten); err != nil {
				t.Fatal(err)
			}
			ids := make([]string, 0, len(records))
			native := make(map[string]EngineRecord)
			for _, record := range records {
				ids = append(ids, record.ID)
				native[record.ID] = record
			}
			entered, resume := make(chan struct{}), make(chan struct{})
			runCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
			defer cancel()
			var mu sync.Mutex
			var cleanups [][]string
			unknownStatusCalls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				mu.Lock()
				defer mu.Unlock()
				switch r.URL.Path {
				case "/internal/operation-status":
					var in struct {
						OperationID string `json:"operationId"`
					}
					if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					if condition == "unpublished-neighbor" && in.OperationID == a.ID {
						unknownStatusCalls++
						json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
						return
					}
					if in.OperationID != b.ID {
						t.Errorf("unexpected recovery operation")
						w.WriteHeader(404)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"status": "revoked", "receipt": map[string]any{"recordIds": ids}})
				case "/internal/invalidate-scope":
					json.NewEncoder(w).Encode(map[string]int{"revision": 1})
				case "/internal/forget":
					var in struct {
						RecordIDs []string `json:"recordIds"`
					}
					if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
						t.Error(err)
					}
					cleanups = append(cleanups, in.RecordIDs)
					if condition == "concurrent" && len(cleanups) == 1 {
						close(entered)
						select {
						case <-resume:
						case <-r.Context().Done():
							return
						}
					}
					for _, id := range in.RecordIDs {
						delete(native, id)
					}
					json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
				case "/internal/export-owner":
					remaining := make([]EngineRecord, 0, len(native))
					for _, record := range native {
						remaining = append(remaining, record)
					}
					json.NewEncoder(w).Encode(map[string]any{"records": remaining})
				default:
					t.Errorf("unexpected engine action %s", r.URL.Path)
					w.WriteHeader(404)
				}
			}))
			defer server.Close()
			client, err := memoryengine.New(server.URL, "synthetic")
			if err != nil {
				t.Fatal(err)
			}
			s.UseMemoryEngine(client)

			if condition == "concurrent" {
				recovered := make(chan error, 1)
				go func() { recovered <- s.RecoverEngineOperations(runCtx) }()
				select {
				case <-entered:
				case err := <-recovered:
					t.Fatalf("recovery stopped before native cleanup: %v", err)
				case <-runCtx.Done():
					t.Fatal(runCtx.Err())
				}
				forgetting, pid := make(chan error, 1), make(chan uint32, 1)
				go func() {
					forgetting <- s.WithOwner(runCtx, 1, func(ctx context.Context, tx pgx.Tx) error {
						pid <- tx.Conn().PgConn().PID()
						var found bool
						return tx.QueryRow(ctx, `SELECT vc.memory_forget_begin(1,$1)`, projections["record-a"].ID).Scan(&found)
					})
				}()
				select {
				case waiter := <-pid:
					for {
						var waiting bool
						err := s.pool.QueryRow(runCtx, `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted)`, int32(waiter)).Scan(&waiting)
						if err != nil {
							t.Fatal(err)
						}
						if waiting {
							break
						}
						select {
						case err := <-forgetting:
							t.Fatalf("forget bypassed recovery barrier: %v", err)
						case <-time.After(10 * time.Millisecond):
						}
					}
				case <-runCtx.Done():
					t.Fatal(runCtx.Err())
				}
				close(resume)
				for _, done := range []chan error{recovered, forgetting} {
					if err := <-done; err != nil {
						t.Fatal(err)
					}
				}
			}

			// The second pass is inert after completion, except when the
			// concurrent forget revoked the surviving A in a new generation.
			for range 2 {
				if err := s.RecoverEngineOperations(ctx); err != nil {
					t.Fatal(err)
				}
			}
			wantCleanups, wantRecall := [][]string{{"record-b"}}, []string{"record-a"}
			if joint {
				wantCleanups, wantRecall = [][]string{{"record-ab"}}, []string{}
			} else if condition == "concurrent" {
				wantCleanups, wantRecall = [][]string{{"record-b"}, {"record-a", "record-b"}}, []string{}
			}
			if condition == "unpublished-neighbor" {
				wantCleanups = [][]string{{}, {"record-b"}}
				if unknownStatusCalls != 1 {
					t.Fatalf("unprepared neighbor status calls=%d", unknownStatusCalls)
				}
			}
			mu.Lock()
			gotCleanup := append([][]string(nil), cleanups...)
			remaining := len(native)
			mu.Unlock()
			if !reflect.DeepEqual(gotCleanup, wantCleanups) || remaining != len(wantRecall) {
				t.Fatalf("native cleanup=%v remaining=%d", cleanups, len(native))
			}
			gotRecall, err := s.engineAllowed(ctx, 1, binding.RelationshipID, binding.ConversationID)
			if err != nil || !slices.Equal(gotRecall, wantRecall) {
				t.Fatalf("remaining recall IDs=%v: %v", gotRecall, err)
			}
			if condition == "independent-twice" {
				if err := s.ForgetManagedMemory(ctx, 1, projections["record-a"].ID); err != nil {
					t.Fatal(err)
				}
				for range 2 {
					if err := s.RecoverEngineOperations(ctx); err != nil {
						t.Fatal(err)
					}
				}
				mu.Lock()
				remaining = len(native)
				mu.Unlock()
				allowed, err := s.engineAllowed(ctx, 1, binding.RelationshipID, binding.ConversationID)
				if err != nil || len(allowed) != 0 || remaining != 0 {
					t.Fatalf("surviving A lost future revocation: allowed=%v native=%d err=%v", allowed, remaining, err)
				}
			}
		})
	}
}

// Recovery must validate V292's complete durable manifest before touching the
// native store, including when Go's tentative survivor list happens to be empty.
func TestEngineRecoveryValidatesBeforeNativeMutation(t *testing.T) {
	for _, condition := range []string{"missing-evidence", "legacy-missing-evidence", "unsettled", "frozen", "go-watermark", "empty-frozen", "native-failure"} {
		t.Run(condition, func(t *testing.T) {
			s, snapshots, binding, first, a, _ := extractionWindowFixture(t)
			ctx := context.Background()
			job, b, window := nextExtractionWindow(t, s, snapshots, first)
			raw := windowProposal(t, window, windowRecord("joint", "合成联合事实", a.SourceKey, b.SourceKey))
			if err := s.PublishEngineProposal(ctx, job, b, raw); err != nil {
				t.Fatal(err)
			}
			exec := func(sql string, args ...any) {
				t.Helper()
				if err := IsolationSuperExec(ctx, sql, args...); err != nil {
					t.Fatal(err)
				}
			}
			exec(`UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=1 AND job_id=$1`, job.JobID)
			if condition == "legacy-missing-evidence" {
				exec(`UPDATE vc.memorycore_operation SET proposal=proposal-'record_source_refs' WHERE owner_user_id=1 AND job_id=$1`, job.JobID)
			}
			switch condition {
			case "missing-evidence", "legacy-missing-evidence":
				exec(`DELETE FROM vc.memory_evidence WHERE owner_user_id=1 AND source_ref=$1`, b.SourceRef)
			case "unsettled":
				exec(`UPDATE vc.st_message_source SET settled=false WHERE owner_user_id=1 AND source_ref=$1`, b.SourceRef)
			case "frozen", "empty-frozen":
				if condition == "empty-frozen" {
					exec(`UPDATE vc.memory_item SET source_invalidated_at=clock_timestamp() WHERE owner_user_id=1 AND engine_record_id='joint'`)
				}
				exec(`INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'FROZEN',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='FROZEN'`)
			case "go-watermark":
				exec(`INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,conversation_id,relationship_id,character_ref,branch_root,header_cipher,metadata_cipher,revision) VALUES(1,$1,'SINGLE',$2,$3,'cm4-records',$1,'enc2:synthetic','enc2:synthetic',99)`, sourceChat, binding.ConversationID, binding.RelationshipID)
				exec(`INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2) ON CONFLICT(owner_user_id) DO UPDATE SET authority='GO'`)
			}
			var calls []string
			failNative := condition == "native-failure"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls = append(calls, r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/internal/operation-status":
					json.NewEncoder(w).Encode(map[string]any{"receipt": map[string]any{"recordIds": []string{"joint"}}})
				case "/internal/invalidate-scope":
					json.NewEncoder(w).Encode(map[string]int{"revision": 0})
				case "/internal/forget":
					if failNative {
						w.WriteHeader(503)
						return
					}
					var in struct {
						IDs []string `json:"recordIds"`
					}
					if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
						t.Error(err)
					}
					if strings.Contains(condition, "missing-evidence") && !slices.Equal(in.IDs, []string{"joint"}) {
						t.Errorf("incomplete joint fact retained: %v", in.IDs)
					}
					json.NewEncoder(w).Encode(map[string]string{"status": "cleared"})
				case "/internal/export-owner":
					json.NewEncoder(w).Encode(map[string]any{"records": []any{}})
				default:
					t.Errorf("unexpected action %s", r.URL.Path)
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
			state := func() string {
				var value string
				if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
					return tx.QueryRow(ctx, `SELECT state FROM vc.memorycore_operation WHERE owner_user_id=1 AND job_id=$1`, job.JobID).Scan(&value)
				}); err != nil {
					t.Fatal(err)
				}
				return value
			}
			err = s.RecoverEngineOperations(ctx)
			if strings.Contains(condition, "missing-evidence") {
				if err != nil || state() != "CLEANED" {
					t.Fatalf("incomplete evidence recovery: %v state=%s", err, state())
				}
				before := len(calls)
				if err := s.RecoverEngineOperations(ctx); err != nil || len(calls) != before {
					t.Fatalf("cleanup replay: %v calls=%v", err, calls)
				}
			} else if condition == "native-failure" {
				if err == nil || state() != "REVOKED" {
					t.Fatalf("native failure did not roll back staged PUBLISHED: %v state=%s", err, state())
				}
				failNative = false
				if err := s.RecoverEngineOperations(ctx); err != nil || state() != "PUBLISHED" {
					t.Fatalf("native retry: %v state=%s", err, state())
				}
			} else {
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != "40001" || len(calls) != 0 || state() != "REVOKED" {
					t.Fatalf("temporary state mutated native or completed: err=%v calls=%v state=%s", err, calls, state())
				}
			}
		})
	}
}
