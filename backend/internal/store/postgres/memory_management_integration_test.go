//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

func TestManagedMemoryFiltersIsolationCorrectionAndForget(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "我下周五去厦门参加婚礼", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	original := addSTMemory(t, b, "我下周五去厦门参加婚礼", refForChat(t, sourceChat))
	if err := IsolationSuperExec(ctx, `UPDATE vc.memory_item SET engine_record_id='record-old',engine_version=1,engine_operation_id='op-original' WHERE owner_user_id=1 AND id=$1`, original.ID); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.vc_user(id,display_name) VALUES(7,'admin') ON CONFLICT DO NOTHING;
 INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES(1,'memory-owner','synthetic','USER','ACTIVE','owner'),(7,'memory-admin','synthetic','ADMIN','ACTIVE','admin') ON CONFLICT(id) DO UPDATE SET status='ACTIVE',role=excluded.role;
 TRUNCATE vc.embedding_config;`); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.SaveEmbeddingConfig(ctx, 7, SaveEmbeddingConfig{Model: "qwen3-embedding:0.6b", ArtifactVersion: "test", Dimensions: 1024, QueryPreprocessingVersion: "identity-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: "ENABLED", ExpectedRevision: 0}); err != nil {
		t.Fatal(err)
	}
	status := "unknown"
	failCommitResponse := true
	var onPropose func()
	calls := map[string]int{}
	engine := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls[r.URL.Path]++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/invalidate-scope":
			w.Write([]byte(`{"revision":0}`))
		case "/internal/operation-status":
			if status == "published" {
				w.Write([]byte(`{"status":"published","receipt":{"recordIds":["record-new"]},"proposal":{"records":[{"id":"record-new","version":1}]}}`))
			} else {
				w.Write([]byte(`{"status":"unknown"}`))
			}
		case "/internal/correct-propose":
			if onPropose != nil {
				onPropose()
			}
			w.Write([]byte(`{"records":[{"id":"record-new","version":1}]}`))
		case "/internal/commit":
			status = "published"
			if failCommitResponse {
				failCommitResponse = false
				w.WriteHeader(503)
				return
			}
			w.Write([]byte(`{"status":"published","recordIds":["record-new"]}`))
		case "/internal/forget":
			w.Write([]byte(`{"status":"cleared","physicalErasure":false}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer engine.Close()
	client, err := memoryengine.New(engine.URL, "test-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	t.Cleanup(func() { testEnv.store.UseMemoryEngine(nil) })
	list, next, err := testEnv.store.ListManagedMemories(ctx, 1, b.RelationshipID, MemoryFilters{Query: "婚礼", EventDateFrom: "2026-10-30", EventDateTo: "2026-10-30", Limit: 1})
	if err != nil || len(list) != 1 || next != "" {
		t.Fatalf("list n=%d next=%q err=%v", len(list), next, err)
	}
	if _, err := testEnv.store.GetManagedMemory(ctx, 2, original.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner detail %v", err)
	}
	out, err := testEnv.store.CorrectManagedMemory(ctx, 1, original.ID, 1, "我改到11月6日去杭州参加婚礼")
	if err != nil {
		t.Fatal(err)
	}
	var row struct {
		ID       string     `json:"memoryId"`
		Version  int64      `json:"version"`
		Previous string     `json:"supersedesMemoryId"`
		Time     MemoryTime `json:"time"`
	}
	if err = json.Unmarshal(out, &row); err != nil {
		t.Fatal(err)
	}
	if row.Version != 2 || row.Previous == "" || row.Time.EventDate == nil || *row.Time.EventDate != "2026-11-06" {
		t.Fatalf("replacement %+v", row)
	}
	if _, err = testEnv.store.CorrectManagedMemory(ctx, 1, original.ID, 1, "conflicting correction"); !errors.Is(err, ErrMemoryVersionConflict) {
		t.Fatalf("stale correction err=%v", err)
	}
	var id int64
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT ($1::jsonb->>'memoryId')::bigint`, out).Scan(&id)
	}); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.ForgetManagedMemory(ctx, 1, id); err != nil {
		t.Fatal(err)
	}
	detail, err := testEnv.store.GetManagedMemory(ctx, 1, id)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Lifecycle      string `json:"lifecycle"`
		RecallEligible bool   `json:"recallEligible"`
		Cleanup        struct {
			State string `json:"state"`
		} `json:"cleanup"`
	}
	json.Unmarshal(detail, &state)
	if state.Lifecycle != "FORGETTING" || state.RecallEligible || state.Cleanup.State != "PENDING" {
		t.Fatalf("suppression %+v", state)
	}
	assertForgottenBodyGone(t, ctx, 1, id, "我改到11月6日去杭州参加婚礼")
	if err = testEnv.store.continueMemoryCleanup(ctx, 1, id); err != nil {
		t.Fatal(err)
	}
	detail, err = testEnv.store.GetManagedMemory(ctx, 1, id)
	if err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(detail, &state)
	if state.Lifecycle != "FORGOTTEN" || state.Cleanup.State != "DONE" {
		t.Fatalf("cleanup %+v", state)
	}
	assertForgottenBodyGone(t, ctx, 1, id, "我改到11月6日去杭州参加婚礼")
	if calls["/internal/commit"] != 1 || calls["/internal/correct-propose"] != 1 || calls["/internal/forget"] != 1 {
		t.Fatalf("unexpected calls %v", calls)
	}
	// A source edit during proposal generation is observed before commit.
	snapshots[sourceChat].Revision++
	snapshots[sourceChat].Messages[0].MessageID = "20000000-0000-0000-0000-000000000088"
	snapshots[sourceChat].Messages[0].CandidateID = "30000000-0000-0000-0000-000000000088"
	snapshots[sourceChat].Messages[0].Revision = 1
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	another := addSTMemory(t, b, "新来源事实", refForChat(t, sourceChat))
	status = "unknown"
	onPropose = func() { snapshots[sourceChat].Revision++; snapshots[sourceChat].Messages[0].Revision++ }
	if _, err = testEnv.store.CorrectManagedMemory(ctx, 1, another.ID, 1, "迟到的纠正"); !errors.Is(err, ErrMemoryVersionConflict) {
		t.Fatalf("late correction accepted: %v", err)
	}
	if calls["/internal/commit"] != 1 {
		t.Fatal("invalidated proposal reached engine commit")
	}

}

func assertForgottenBodyGone(t *testing.T, ctx context.Context, owner, id int64, sentence string) {
	t.Helper()
	detail, err := testEnv.store.GetManagedMemory(ctx, owner, id)
	if err != nil {
		t.Fatal(err)
	}
	var row struct {
		Summary        string `json:"summary"`
		RelationshipID string `json:"relationshipId"`
	}
	if json.Unmarshal(detail, &row) != nil || row.Summary != "" || strings.Contains(string(detail), sentence) {
		t.Fatalf("forgotten detail still holds body: %s", detail)
	}
	rel, err := strconv.ParseInt(row.RelationshipID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	listed, _, err := testEnv.store.ListManagedMemories(ctx, owner, rel, MemoryFilters{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	seen := false
	for _, raw := range listed {
		var item struct {
			ID      string `json:"memoryId"`
			Summary string `json:"summary"`
		}
		if json.Unmarshal(raw, &item) != nil {
			t.Fatal("list row")
		}
		if item.ID == strconv.FormatInt(id, 10) {
			seen = true
			if item.Summary != "" {
				t.Fatalf("list summary %q", item.Summary)
			}
		}
		if strings.Contains(item.Summary, sentence) {
			t.Fatal("list still holds forgotten body")
		}
	}
	if !seen {
		t.Fatal("forgotten tombstone missing from list")
	}
	evidence, err := testEnv.store.ManagedMemoryEvidence(ctx, owner, id)
	if err != nil {
		t.Fatal(err)
	}
	if len(evidence) == 0 {
		t.Fatal("forgotten evidence rows missing")
	}
	for _, raw := range evidence {
		var ev struct {
			Excerpt string `json:"excerpt"`
		}
		if json.Unmarshal(raw, &ev) != nil || ev.Excerpt != "" || strings.Contains(string(raw), sentence) {
			t.Fatalf("evidence still holds body: %s", raw)
		}
	}
	conn, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var summary string
	var correction *string
	if err = conn.QueryRow(ctx, `SELECT summary, correction_summary FROM vc.memory_item WHERE owner_user_id=$1 AND id=$2`, owner, id).Scan(&summary, &correction); err != nil || summary != "" || correction != nil {
		t.Fatalf("stored body summary=%q correction=%v err=%v", summary, correction, err)
	}
}

func TestForgetDropsDerivedProfileAcrossSharedSessionsUntilRebuild(t *testing.T) {
	a, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	chatB := "10000000-0000-0000-0000-0000000000b2"
	b, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: chatB, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &a.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "今天只是随便聊聊。", at)
	snapshots[chatB] = stMemorySnapshot(chatB, "换个话题接着说。", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, chatB}); err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.relationship SET memory_share_scope='RELATIONSHIP' WHERE owner_user_id=1 AND id=$1`, a.RelationshipID); err != nil {
		t.Fatal(err)
	}
	var scope string
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT memory_share_scope FROM vc.relationship WHERE owner_user_id=1 AND id=$1`, a.RelationshipID).Scan(&scope)
	}); err != nil {
		t.Fatal(err)
	}
	if scope == "SESSION" || scope != "RELATIONSHIP" {
		t.Fatalf("share scope %s", scope)
	}
	refA, refB := refForChat(t, sourceChat), refForChat(t, chatB)
	forgotten := addSTMemory(t, a, "一条可遗忘的普通事实", refA)
	addSTMemory(t, b, "兄弟会话仍保留的周日阅读", refB)
	const secret = "紫丁香花盆下的备用钥匙"
	profileEngineFixture(t, a, refA, "画像："+secret)
	profileEngineFixture(t, b, refB, "画像：兄弟会话仍保留的周日阅读")
	var jobB int64
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT id FROM vc.work_item WHERE owner_user_id=1 AND kind='ST_MEMORY_EXTRACT' AND st_source_ref=$1`, refB).Scan(&jobB); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `SELECT vc.go_record_memorycore_profile(1,$1,'profile-token','profile-fence',$2,$3)`, jobB, []string{refA, refB}, "兄弟会话摘要："+secret)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/search":
			var input struct {
				Allowed []string `json:"allowedRecordIds"`
			}
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				w.WriteHeader(400)
				return
			}
			out := []map[string]string{}
			for _, id := range input.Allowed {
				out = append(out, map[string]string{"record_id": id})
			}
			json.NewEncoder(w).Encode(out)
		case "/internal/forget":
			w.Write([]byte(`{"status":"cleared"}`))
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-forget-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	t.Cleanup(func() { testEnv.store.UseMemoryEngine(nil) })
	sibling := STMemoryRequest{ChatIdentity: chatB, Revision: 1, Enabled: true, BudgetTokens: 1024}
	origin := STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024}
	shared, err := testEnv.store.RecallSTMemory(ctx, 1, sibling)
	if err != nil || !strings.Contains(shared.Block, secret) {
		t.Fatalf("sibling session did not receive the derived profile: %+v %v", shared, err)
	}
	if err = testEnv.store.ForgetManagedMemory(ctx, 1, forgotten.ID); err != nil {
		t.Fatal(err)
	}
	marker := "forget-" + strconv.FormatInt(forgotten.ID, 10) + "-profile"
	var jobStatus string
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT w.status FROM vc.work_item w JOIN vc.memorycore_operation op ON (op.owner_user_id,op.job_id)=(w.owner_user_id,w.id) WHERE op.owner_user_id=1 AND op.profile_operation_id=$1`, marker).Scan(&jobStatus)
	}); err != nil || jobStatus != "PENDING" {
		t.Fatalf("rebuild job status=%s err=%v", jobStatus, err)
	}
	for _, req := range []STMemoryRequest{sibling, origin} {
		out, err := testEnv.store.RecallSTMemory(ctx, 1, req)
		if err != nil || strings.Contains(out.Block, secret) {
			t.Fatalf("forgotten fact still injected chat=%s block=%q err=%v", req.ChatIdentity, out.Block, err)
		}
	}
	var leaked int
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.read_st_summaries(1,$1,$2) WHERE position($3 in out_summary)>0`, []int64{a.ConversationID, b.ConversationID}, b.ConversationID, secret).Scan(&leaked)
	}); err != nil || leaked != 0 {
		t.Fatalf("sibling read_st_summaries still returned the fact: n=%d err=%v", leaked, err)
	}
	conn, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var stored int
	if err = conn.QueryRow(ctx, `SELECT count(*) FROM vc.conversation_summary WHERE owner_user_id=1 AND position($1 in summary)>0`, secret).Scan(&stored); err != nil || stored != 0 {
		t.Fatalf("summary body still stores the forgotten fact: n=%d err=%v", stored, err)
	}
	if err = testEnv.store.continueMemoryCleanup(ctx, 1, forgotten.ID); err != nil {
		t.Fatal(err)
	}
	detail, err := testEnv.store.GetManagedMemory(ctx, 1, forgotten.ID)
	if err != nil {
		t.Fatal(err)
	}
	var state struct {
		Lifecycle string `json:"lifecycle"`
		Cleanup   struct {
			State string `json:"state"`
		} `json:"cleanup"`
	}
	if err = json.Unmarshal(detail, &state); err != nil {
		t.Fatal(err)
	}
	if state.Cleanup.State == "DONE" || state.Lifecycle == "FORGOTTEN" {
		t.Fatalf("cleanup completed before profile rebuild: %+v", state)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.work_item w SET status='DONE', finished_at=clock_timestamp() FROM vc.memorycore_operation op WHERE (op.owner_user_id,op.job_id)=(w.owner_user_id,w.id) AND op.owner_user_id=1 AND op.profile_operation_id=$1`, marker); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.continueMemoryCleanup(ctx, 1, forgotten.ID); err != nil {
		t.Fatal(err)
	}
	detail, err = testEnv.store.GetManagedMemory(ctx, 1, forgotten.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(detail, &state); err != nil {
		t.Fatal(err)
	}
	if state.Cleanup.State != "DONE" || state.Lifecycle != "FORGOTTEN" {
		t.Fatalf("cleanup after rebuild: %+v", state)
	}
	for _, req := range []STMemoryRequest{sibling, origin} {
		out, err := testEnv.store.RecallSTMemory(ctx, 1, req)
		if err != nil || strings.Contains(out.Block, secret) {
			t.Fatalf("rebuilt recall restored the forgotten fact chat=%s block=%q err=%v", req.ChatIdentity, out.Block, err)
		}
	}
}

func TestManagedCorrectionRebaseRequiresUnchangedTargetAndSources(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "原始来源事实", time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC))
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	original := addSTMemory(t, b, "原始来源事实", refForChat(t, sourceChat))
	var reserved json.RawMessage
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_correction_reserve(1,$1,1,'显式纠正','old-epoch')`, original.ID).Scan(&reserved)
	}); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.memorycore_scope SET revision=revision+1 WHERE owner_user_id=1 AND relationship_id=$1`, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	var revision int64
	var valid bool
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT vc.memory_correction_verify(1,$1,1,'old-epoch')`, original.ID).Scan(&valid); err != nil {
			return err
		}
		if valid {
			t.Fatal("stale reservation remained valid")
		}
		if err := tx.QueryRow(ctx, `SELECT vc.memory_correction_rebase(1,$1,1,'old-epoch','new-epoch')`, original.ID).Scan(&revision); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT vc.memory_correction_verify(1,$1,1,'new-epoch')`, original.ID).Scan(&valid)
	}); err != nil {
		t.Fatal(err)
	}
	if revision < 1 || !valid {
		t.Fatalf("safe rebase failed: revision=%d valid=%v", revision, valid)
	}
	snapshots[sourceChat].Revision++
	snapshots[sourceChat].Messages[0].Revision++
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_correction_rebase(1,$1,1,'new-epoch','invalid-source')`, original.ID).Scan(&revision)
	}); err != nil {
		t.Fatal(err)
	}
	if revision != -1 {
		t.Fatal("source invalidation was rebased into publication")
	}
}

func TestManagedSequentialCorrectionsAndConcurrentRecovery(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "连续纠正来源", time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC))
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	original := addSTMemory(t, b, "原值", refForChat(t, sourceChat))
	if err := IsolationSuperExec(ctx, `UPDATE vc.memory_item SET engine_record_id='strict-original',engine_version=3 WHERE owner_user_id=1 AND id=$1`, original.ID); err != nil {
		t.Fatal(err)
	}
	type prepared struct {
		proposal  EngineProposal
		target    string
		published bool
	}
	var mu sync.Mutex
	operations := map[string]*prepared{}
	live := map[string]int64{"strict-original": 3}
	sequence, prepareCalls, commits := 0, 0, 0
	entered, release := make(chan struct{}), make(chan struct{})
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			OperationID     string `json:"operationId"`
			RecordID        string `json:"recordId"`
			ExpectedVersion int64  `json:"expectedVersion"`
			Summary         string `json:"summary"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		mu.Lock()
		op := operations[input.OperationID]
		switch r.URL.Path {
		case "/internal/invalidate-scope":
			mu.Unlock()
			json.NewEncoder(w).Encode(map[string]int{"revision": 0})
		case "/internal/operation-status":
			if op == nil {
				mu.Unlock()
				json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
				return
			}
			status := "proposed"
			if op.published {
				status = "published"
			}
			reply := map[string]any{"status": status, "proposal": op.proposal, "receipt": map[string]any{"recordIds": []string{op.proposal.Records[0].ID}}}
			mu.Unlock()
			json.NewEncoder(w).Encode(reply)
		case "/internal/correct-propose":
			prepareCalls++
			call := prepareCalls
			if op == nil {
				if live[input.RecordID] != input.ExpectedVersion || input.ExpectedVersion < 1 {
					mu.Unlock()
					w.WriteHeader(409)
					return
				}
				sequence++
				record := EngineRecord{ID: fmt.Sprintf("strict-replacement-%d", sequence), Version: input.ExpectedVersion + 1, Content: input.Summary}
				op = &prepared{proposal: EngineProposal{Records: []EngineRecord{record}, Targets: []EngineTarget{{ID: input.RecordID, Version: input.ExpectedVersion}}}, target: input.RecordID}
				operations[input.OperationID] = op
			}
			proposal := op.proposal
			mu.Unlock()
			if call == 1 {
				close(entered)
				<-release
			}
			json.NewEncoder(w).Encode(proposal)
		case "/internal/commit":
			if op == nil {
				mu.Unlock()
				w.WriteHeader(409)
				return
			}
			if !op.published {
				commits++
				delete(live, op.target)
				live[op.proposal.Records[0].ID] = op.proposal.Records[0].Version
				op.published = true
			}
			ids := []string{op.proposal.Records[0].ID}
			mu.Unlock()
			json.NewEncoder(w).Encode(map[string]any{"status": "published", "recordIds": ids})
		default:
			mu.Unlock()
			w.WriteHeader(404)
		}
	}))
	defer service.Close()
	client, err := memoryengine.New(service.URL, "synthetic-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	type result struct {
		body json.RawMessage
		err  error
	}
	first := make(chan result, 1)
	go func() {
		body, err := testEnv.store.CorrectManagedMemory(ctx, 1, original.ID, 1, "第一次纠正")
		first <- result{body, err}
	}()
	<-entered
	recovered, err := testEnv.store.CorrectManagedMemory(ctx, 1, original.ID, 1, "第一次纠正")
	close(release)
	if err != nil {
		t.Fatal(err)
	}
	originalResponse := <-first
	if originalResponse.err != nil {
		t.Fatalf("same operation falsely conflicted: %v", originalResponse.err)
	}
	var one, two, final struct {
		ID      string `json:"memoryId"`
		Version int64  `json:"version"`
		Summary string `json:"summary"`
	}
	json.Unmarshal(recovered, &one)
	json.Unmarshal(originalResponse.body, &two)
	if one.ID != two.ID || one.Version != 2 {
		t.Fatal("concurrent recovery returned different replacement")
	}
	id, _ := strconv.ParseInt(one.ID, 10, 64)
	next, err := testEnv.store.CorrectManagedMemory(ctx, 1, id, 2, "第二次纠正")
	if err != nil {
		t.Fatalf("second correction failed: %v", err)
	}
	json.Unmarshal(next, &final)
	if final.ID == one.ID || final.Version != 3 || final.Summary != "第二次纠正" {
		t.Fatalf("second replacement %+v", final)
	}
	if _, err := testEnv.store.CorrectManagedMemory(ctx, 1, id, 2, "过期编辑"); !errors.Is(err, ErrMemoryVersionConflict) {
		t.Fatalf("stale version accepted: %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if commits != 2 || len(live) != 1 || live["strict-replacement-2"] != 5 {
		t.Fatalf("engine versions or commits drift: commits=%d live=%v", commits, live)
	}
}
