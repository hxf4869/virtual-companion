//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/memorytime"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestDatedRecallDropsEngineHitsOutsideTheAllowlist(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "今天记下两件不同日期的事。", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	wedding := addSTMemory(t, b, "用户将于2026年10月30日去厦门参加朋友婚礼。", ref)
	dentist := addSTMemory(t, b, "用户将于2026年11月6日看牙医。", ref)
	if wedding.Time == nil || wedding.Time.EventDate == nil || *wedding.Time.EventDate != "2026-10-30" {
		t.Fatalf("wedding date: %+v", wedding.Time)
	}
	if dentist.Time == nil || dentist.Time.EventDate == nil || *dentist.Time.EventDate != "2026-11-06" {
		t.Fatalf("dentist date: %+v", dentist.Time)
	}
	weddingRecord := "fixture-record-" + strconv.FormatInt(wedding.ID, 10)
	dentistRecord := "fixture-record-" + strconv.FormatInt(dentist.ID, 10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		lastEngineSearch = input
		_ = json.NewEncoder(w).Encode([]map[string]string{{"record_id": dentistRecord}, {"record_id": weddingRecord}})
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-memory-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	day := "2026-11-06"
	got, err := testEnv.store.searchEngineMemories(ctx, 1, b.RelationshipID, b.ConversationID, recallQuery{Text: "下周五有安排吗", Date: &day, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != dentist.ID {
		ids := make([]int64, 0, len(got))
		for _, m := range got {
			ids = append(ids, m.ID)
		}
		t.Fatalf("date gate accepted hits outside the allowlist: %v", ids)
	}
	allowed, _ := lastEngineSearch["allowedRecordIds"].([]any)
	for _, id := range allowed {
		if id == weddingRecord {
			t.Fatal("wrong event date was forwarded in the allowlist")
		}
	}
}

func TestStaleProfileCannotBypassTheDateGate(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 27, 4, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "下周五有安排吗", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	wedding := addSTMemory(t, b, "用户将于2026年10月30日去厦门参加朋友婚礼。", ref)
	bookmark := addSTMemory(t, b, "用户收藏了一枚书签。", ref)
	dentist := addSTMemory(t, b, "用户将于2026年11月6日看牙医。", ref)
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.memory_profile(owner_user_id,relationship_id,fingerprint,persona,st_source_refs,record_ids,valid) VALUES(1,$1,'stale-fingerprint','旧画像仍记载着别的日子',ARRAY[$2],ARRAY['stale-record'],true)`, b.RelationshipID, ref); err != nil {
		t.Fatal(err)
	}
	queryAt := at
	out, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024, QueryTimestamp: &queryAt, QueryTimezone: "Asia/Shanghai"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out.Block, "厦门") || strings.Contains(out.Block, "婚礼") || strings.Contains(out.Block, "书签") || strings.Contains(out.Block, "旧画像") {
		t.Fatalf("stale profile injected memories outside the query date: %q ids=%v", out.Block, out.MemoryIDs)
	}
	if !strings.Contains(out.Block, "牙医") {
		t.Fatalf("dated memory on the query day was dropped: %q ids=%v", out.Block, out.MemoryIDs)
	}
	for _, id := range out.MemoryIDs {
		if id == strconv.FormatInt(wedding.ID, 10) || id == strconv.FormatInt(bookmark.ID, 10) {
			t.Fatalf("wrong or undated memory id %s in %v", id, out.MemoryIDs)
		}
	}
	found := false
	for _, id := range out.MemoryIDs {
		if id == strconv.FormatInt(dentist.ID, 10) {
			found = true
		}
	}
	if !found {
		t.Fatalf("query-day memory missing: %v", out.MemoryIDs)
	}
}

func TestForgetClearsProfileTextAndRecallsOtherFacts(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	// Forgetting a memory suppresses its own source so that fact is not
	// extracted again. The remaining fact has a different source, matching
	// accumulated facts that came from other turns.
	const forgottenWording = "一条可遗忘的普通事实"
	const keptWording = "仍保留的阅读习惯"
	snap := stMemorySnapshot(sourceChat, forgottenWording, at)
	snap.Messages = append(snap.Messages,
		stsource.Message{MessageID: "20000000-0000-0000-0000-0000000000a2", CandidateID: "30000000-0000-0000-0000-0000000000a2", Revision: 1, Role: "user", Text: keptWording, Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"},
		stsource.Message{MessageID: "20000000-0000-0000-0000-0000000000a3", CandidateID: "30000000-0000-0000-0000-0000000000a3", Revision: 1, Role: "user", Text: "我们随便聊了几句。", Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"},
	)
	snapshots[sourceChat] = snap
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	forgottenRef := sourceRefByMessage(t, sourceMessage)
	keptRef := sourceRefByMessage(t, "20000000-0000-0000-0000-0000000000a2")
	forgotten := addSTMemory(t, b, forgottenWording, forgottenRef)
	kept := addSTMemory(t, b, keptWording, keptRef)
	const persona = "旧日常画像：仍保留的阅读习惯。一条可遗忘的普通事实。"
	profileEngineFixture(t, b, keptRef, persona)
	scenes := `[{"file":"scene_blocks/forgotten.md","summary":"` + forgottenWording + `","recordIds":["fixture-record-` + strconv.FormatInt(forgotten.ID, 10) + `"]}]`
	if err := IsolationSuperExec(ctx, `UPDATE vc.memory_profile SET scenes=$2::jsonb WHERE owner_user_id=1 AND relationship_id=$1`, b.RelationshipID, scenes); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,st_source_refs) VALUES(1,nextval('vc.conversation_summary_id_seq'),$1,$2,'memorycore','test','st-source-digest-v1',1,'ECONOMY',ARRAY[$3])`, b.ConversationID, "转述："+forgottenWording, forgottenRef); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/internal/forget" {
			_, _ = w.Write([]byte(`{"status":"cleared"}`))
			return
		}
		if r.URL.Path != "/internal/search" {
			w.WriteHeader(404)
			return
		}
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
		_ = json.NewEncoder(w).Encode(out)
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-forget-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	if err = testEnv.store.ForgetManagedMemory(ctx, 1, forgotten.ID); err != nil {
		t.Fatal(err)
	}
	var profiles, validProfiles int
	var storedPersona, storedScenes string
	err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE valid), COALESCE(string_agg(persona, ''), ''), COALESCE(string_agg(scenes::text, ''), '') FROM vc.memory_profile WHERE owner_user_id=1 AND relationship_id=$1`, b.RelationshipID).Scan(&profiles, &validProfiles, &storedPersona, &storedScenes)
	})
	if err != nil {
		t.Fatal(err)
	}
	if profiles != 1 || validProfiles != 0 || storedPersona != "" || storedScenes != "[]" {
		t.Fatalf("forgotten profile text remained: profiles=%d valid=%d persona=%q scenes=%s", profiles, validProfiles, storedPersona, storedScenes)
	}
	if wordingLeft(t, b.RelationshipID, forgottenWording) != 0 {
		t.Fatalf("forgotten wording still stored in profile, summary, or memory")
	}
	recall, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(recall.Block, forgottenWording) || strings.Contains(recall.Block, "旧日常画像") {
		t.Fatalf("cleared profile or forgotten fact returned: %q", recall.Block)
	}
	if !strings.Contains(recall.Block, keptWording) {
		t.Fatalf("remaining fact left the recall block: %q ids=%v", recall.Block, recall.MemoryIDs)
	}
	found := false
	for _, id := range recall.MemoryIDs {
		if id == strconv.FormatInt(kept.ID, 10) {
			found = true
		}
	}
	if !found {
		t.Fatalf("remaining memory id missing: %v", recall.MemoryIDs)
	}
	var job int64
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM vc.work_item WHERE owner_user_id=1 AND kind='ST_MEMORY_EXTRACT' AND st_source_ref=$1`, keptRef).Scan(&job)
	}); err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.work_item SET status='DEAD_LETTERED', attempt_count=3, finished_at=clock_timestamp() WHERE owner_user_id=1 AND id=$1`, job); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.enqueueProfileRebuild(ctx, 1, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	status, attempts := workStatus(t, job)
	if status != "DEAD_LETTERED" || attempts != 3 {
		t.Fatalf("dead-lettered rebuild was revived: %s attempts=%d", status, attempts)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.work_item SET status='FAILED', attempt_count=1, finished_at=clock_timestamp() WHERE owner_user_id=1 AND id=$1`, job); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.enqueueProfileRebuild(ctx, 1, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	status, attempts = workStatus(t, job)
	if status != "PENDING" || attempts != 1 {
		t.Fatalf("failed rebuild retry: %s attempts=%d", status, attempts)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.work_item SET status='DONE', attempt_count=2, finished_at=clock_timestamp() WHERE owner_user_id=1 AND id=$1`, job); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.enqueueProfileRebuild(ctx, 1, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	status, attempts = workStatus(t, job)
	if status != "PENDING" || attempts != 0 {
		t.Fatalf("finished rebuild was not started clean: %s attempts=%d", status, attempts)
	}
	var rebuilt string
	super, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	err = super.QueryRow(ctx, `SELECT COALESCE(string_agg(summary, E'\n' ORDER BY id), '') FROM vc.memory_item WHERE owner_user_id=1 AND relationship_id=$1 AND deleted_at IS NULL AND status='ACCEPTED'`, b.RelationshipID).Scan(&rebuilt)
	super.Close(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if rebuilt == "" || strings.Contains(rebuilt, forgottenWording) || !strings.Contains(rebuilt, keptWording) {
		t.Fatalf("remaining facts for rebuild: %q", rebuilt)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.work_item SET status='CLAIMED', claim_token='profile-token', claim_fence='profile-fence', lease_expires_at=now()+interval '1 hour' WHERE owner_user_id=1 AND id=$1`, job); err != nil {
		t.Fatal(err)
	}
	recordEngineProfile(t, b.ConversationID, job, "profile-token", "profile-fence", []string{keptRef}, rebuilt)
	var current string
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_persona FROM vc.memory_profile_current(1,$1,$2)`, b.RelationshipID, b.ConversationID).Scan(&current)
	}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(current, forgottenWording) || !strings.Contains(current, keptWording) || wordingLeft(t, b.RelationshipID, forgottenWording) != 0 {
		t.Fatalf("rebuilt profile still holds forgotten wording: %q", current)
	}
}

func TestAmbiguousEmptyProposalBecomesClarification(t *testing.T) {
	s, snapshots := engineSampleStore(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 16, 30, 0, 0, time.UTC)
	binding, claim, op := claimEngineSample(t, s, snapshots, engineSample{
		chat: sourceChat, message: sourceMessage, candidate: sourceCandidate,
		text: "明天晚上提醒我带书。", zone: "", at: at,
	})
	empty, _ := json.Marshal(EngineProposal{Records: []EngineRecord{}, Targets: []EngineTarget{}, Dependencies: []string{op.SourceKey}})
	if err := s.PublishEngineProposal(ctx, claim, op, empty); err != nil {
		t.Fatal(err)
	}
	if err := s.PublishEngineProposal(ctx, claim, op, empty); err != nil {
		t.Fatal(err)
	}
	n, summary, temporal := publishedMemory(t, binding.RelationshipID, op.ID)
	if n != 1 || summary != "明天晚上提醒我带书。" || !strings.Contains(temporal, memorytime.StatusNeedsClarification) || strings.Contains(temporal, `"eventDate":"20`) {
		t.Fatalf("ambiguous source published n=%d summary=%q temporal=%s", n, summary, temporal)
	}
	plainBinding, plainClaim, plainOp := claimEngineSample(t, s, snapshots, engineSample{
		chat: "10000000-0000-0000-0000-0000000000c9", message: "20000000-0000-0000-0000-0000000000c9", candidate: "30000000-0000-0000-0000-0000000000c9",
		text: "一个没有新事实的问题？", zone: "Asia/Shanghai", at: at,
	})
	none, _ := json.Marshal(EngineProposal{Records: []EngineRecord{}, Targets: []EngineTarget{}, Dependencies: []string{plainOp.SourceKey}})
	if err := s.PublishEngineProposal(ctx, plainClaim, plainOp, none); err != nil {
		t.Fatal(err)
	}
	extra, _, _ := publishedMemory(t, plainBinding.RelationshipID, plainOp.ID)
	if extra != 0 {
		t.Fatalf("unambiguous empty proposal inserted %d rows", extra)
	}
}

func claimEngineSample(t *testing.T, s *Store, snapshots map[string]stsource.Snapshot, in engineSample) (STBinding, JobClaim, EngineOperation) {
	t.Helper()
	ctx := context.Background()
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: in.chat, CharacterRef: "engine-test", Mode: "COMPANION", RelationshipID: in.relationship})
	if err != nil {
		t.Fatalf("bind: %v", err)
	}
	snapshots[in.chat] = stsource.Snapshot{ChatIdentity: in.chat, BranchRoot: in.chat, State: "PRESENT", Revision: 1, Location: "chats/synthetic/" + in.chat + ".jsonl", Messages: []stsource.Message{{MessageID: in.message, CandidateID: in.candidate, Revision: 1, Role: "user", Text: in.text, Eligible: true, Settled: true, SourceTimestamp: &in.at, SourceTimezone: in.zone}}}
	if _, err = s.ReconcileSTSources(ctx, 1, []string{in.chat}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim %v %v", jobs, err)
	}
	op, err := s.PrepareEngineOperation(ctx, jobs[0])
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	return binding, jobs[0], op
}

func sourceRefByMessage(t *testing.T, messageID string) string {
	t.Helper()
	var ref string
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT source_ref FROM vc.st_message_source WHERE owner_user_id=1 AND message_id=$1::uuid AND present`, messageID).Scan(&ref)
	})
	if err != nil {
		t.Fatal(err)
	}
	return ref
}

func wordingLeft(t *testing.T, rel int64, wording string) int {
	t.Helper()
	// conversation_summary SELECT is revoked from runtime roles. Count the
	// stored rows as the fixture superuser so the assertion sees the table.
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	err = conn.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM vc.memory_profile WHERE owner_user_id=1 AND relationship_id=$1 AND position($2 in (persona || scenes::text))>0)
		+ (SELECT count(*) FROM vc.conversation_summary cs JOIN vc.conversation c ON (c.owner_user_id,c.id)=(cs.owner_user_id,cs.conversation_id) WHERE cs.owner_user_id=1 AND c.relationship_id=$1 AND position($2 in cs.summary)>0)
		+ (SELECT count(*) FROM vc.memory_item WHERE owner_user_id=1 AND relationship_id=$1 AND position($2 in (summary || coalesce(correction_summary,'')))>0)`, rel, wording).Scan(&n)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func workStatus(t *testing.T, job int64) (string, int) {
	t.Helper()
	var status string
	var attempts int
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status, attempt_count FROM vc.work_item WHERE owner_user_id=1 AND id=$1`, job).Scan(&status, &attempts)
	})
	if err != nil {
		t.Fatal(err)
	}
	return status, attempts
}

func publishedMemory(t *testing.T, rel int64, operationID string) (int, string, string) {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var n int
	var summary, temporal *string
	if err = conn.QueryRow(ctx, `SELECT count(*), max(summary), max(temporal_cipher) FROM vc.memory_item WHERE owner_user_id=1 AND relationship_id=$1 AND engine_operation_id=$2 AND deleted_at IS NULL`, rel, operationID).Scan(&n, &summary, &temporal); err != nil {
		t.Fatal(err)
	}
	text, clock := "", ""
	if summary != nil {
		text = *summary
	}
	if temporal != nil {
		clock = *temporal
	}
	return n, text, clock
}
