//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

func TestEngineProfileExcludesOtherChatAndMergedDependencies(t *testing.T) {
	a, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	chatB := "10000000-0000-0000-0000-000000000077"
	b, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: chatB, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &a.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "A 的固定阅读计划", at)
	snapshots[chatB] = stMemorySnapshot(chatB, "B 正在讨论另一个问题", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, chatB}); err != nil {
		t.Fatal(err)
	}
	refA, refB := refForChat(t, sourceChat), refForChat(t, chatB)
	memoryA := addSTMemory(t, a, "A 的固定阅读计划", refA)
	memoryB := addSTMemory(t, b, "B 正在讨论另一个问题", refB)
	// A cross-chat merged record belongs to A's conversation but still depends
	// on B. The profile builder must exclude the whole record, not trim its refs.
	merged, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: a.RelationshipID, ConversationID: &a.ConversationID, Scope: "RELATIONSHIP", Summary: "A 与 B 的合并记忆", Evidence: []string{refA, refB}})
	if err != nil {
		t.Fatal(err)
	}
	merged, err = testEnv.store.ConfirmMemory(ctx, 1, merged.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	projectEngineFixture(t, merged)
	prepareEngineProfileJob(t, a, refA)
	claim := JobClaim{OwnerID: 1, Kind: "ST_MEMORY_EXTRACT"}
	var revision int64
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT w.id,w.ref_id,w.claim_token,w.claim_fence,mc.revision FROM vc.work_item w JOIN vc.memorycore_scope mc ON mc.owner_user_id=w.owner_user_id AND mc.relationship_id=$2 WHERE w.owner_user_id=1 AND w.kind='ST_MEMORY_EXTRACT' AND w.st_source_ref=$1`, refA, a.RelationshipID).Scan(&claim.JobID, &claim.RefID, &claim.Token, &claim.Fence, &revision)
	}); err != nil {
		t.Fatal(err)
	}
	orderedRefs := []string{refA, refB}
	sort.Strings(orderedRefs)
	expectedDependencies := make([]string, 0, len(orderedRefs))
	for _, ref := range orderedRefs {
		expectedDependencies = append(expectedDependencies, sourceDependencyID(t, ref))
	}
	expectedIDs := []string{fmt.Sprintf("fixture-record-%d", memoryA.ID), fmt.Sprintf("fixture-record-%d", memoryB.ID)}
	sort.Strings(expectedIDs)
	built, published := false, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			AllowedRecordIDs     []string `json:"allowedRecordIds"`
			VerifiedDependencies []string `json:"verifiedDependencies"`
			Publish              bool     `json:"publish"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		case "/internal/rebuild-profile":
			if !reflect.DeepEqual(input.AllowedRecordIDs, expectedIDs) {
				t.Errorf("profile A received other-chat or partially stripped merged record: got=%v want=%v", input.AllowedRecordIDs, expectedIDs)
			}
			if input.Publish {
				published = true
				if !reflect.DeepEqual(input.VerifiedDependencies, expectedDependencies) {
					t.Errorf("profile A verified dependencies include B: %v", input.VerifiedDependencies)
				}
			} else {
				built = true
			}
			json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": expectedDependencies})
		case "/internal/read-profile":
			json.NewEncoder(w).Encode(map[string]any{"dependencies": expectedDependencies, "files": map[string]string{"persona.md": "A：固定阅读计划摘要"}})
		case "/internal/search":
			// Relevance stays in the engine. This double returns only the
			// allowlist Go already filtered, so a stale profile cannot add
			// records the engine did not return.
			out := []map[string]string{}
			for _, id := range input.AllowedRecordIDs {
				out = append(out, map[string]string{"record_id": id})
			}
			json.NewEncoder(w).Encode(out)
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	op := EngineOperation{ID: fmt.Sprintf("fixture-profile-%d", claim.JobID), ProfileOperationID: fmt.Sprintf("profile-isolation-%d", claim.JobID), Scope: EngineScope(1, a.RelationshipID), Revision: revision, SourceRef: refA, Input: MemoryExtractInput{RelationshipID: a.RelationshipID, ConversationID: a.ConversationID}}
	if err = testEnv.store.BuildEngineProfile(ctx, claim, op, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	if !built || !published {
		t.Fatal("profile did not traverse stage and verified publication")
	}
	recallB := func() STMemoryResult {
		t.Helper()
		result, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: chatB, Revision: 1, Enabled: true, BudgetTokens: 1024})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	result := recallB()
	if len(result.SummaryIDs) != 1 || !strings.Contains(result.Block, "A：固定阅读计划摘要") {
		t.Fatalf("verified profile missing before a dependency unsettles: %+v", result)
	}
	// B's active send leaves its own source unsettled. The shared profile no
	// longer matches, so B gets A's still-verified L1 and not the profile or B.
	snapshots[chatB].Messages[0].Settled = false
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{chatB}); err != nil {
		t.Fatal(err)
	}
	result = recallB()
	if strings.Contains(result.Block, "A：固定阅读计划摘要") || strings.Contains(result.Block, "B 正在讨论") || !strings.Contains(result.Block, "A 的固定阅读计划") || len(result.SummaryIDs) != 0 {
		t.Fatalf("unsettled B revoked A's verified fact or kept the profile: %+v", result)
	}
	snapshots[sourceChat].Messages[0].Settled = false
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	result = recallB()
	if len(result.SummaryIDs) != 0 || len(result.MemoryIDs) != 0 || strings.Contains(result.Block, "A：固定阅读计划摘要") || strings.Contains(result.Block, "A 的固定阅读计划") {
		t.Fatalf("unsettled A still injected: %+v", result)
	}
}

func TestMemoryProfileSessionScopeStaysInConversation(t *testing.T) {
	a, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	chatB := "10000000-0000-0000-0000-0000000000c2"
	b, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: chatB, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &a.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "第一会话的周日阅读", at)
	snapshots[chatB] = stMemorySnapshot(chatB, "第二会话的航海计划", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, chatB}); err != nil {
		t.Fatal(err)
	}
	refA, refB := refForChat(t, sourceChat), refForChat(t, chatB)
	memA := addScopedMemory(t, a, "SESSION", "第一会话事实", refA)
	memB := addScopedMemory(t, b, "SESSION", "第二会话事实", refB)
	idA, idB := fmt.Sprintf("fixture-record-%d", memA.ID), fmt.Sprintf("fixture-record-%d", memB.ID)
	if got := profileAllowlist(t, a.RelationshipID, a.ConversationID); !reflect.DeepEqual(got, []string{idA}) {
		t.Fatalf("session A allowlist %v", got)
	}
	if got := profileAllowlist(t, a.RelationshipID, b.ConversationID); !reflect.DeepEqual(got, []string{idB}) {
		t.Fatalf("session B allowlist %v", got)
	}
	shared := addSTMemory(t, a, "关系级事实", refA)
	sharedID := fmt.Sprintf("fixture-record-%d", shared.ID)
	wantA := []string{idA, sharedID}
	sort.Strings(wantA)
	if got := profileAllowlist(t, a.RelationshipID, a.ConversationID); !reflect.DeepEqual(got, wantA) {
		t.Fatalf("relationship fact missing from A: %v", got)
	}
	wantB := []string{idB, sharedID}
	sort.Strings(wantB)
	if got := profileAllowlist(t, a.RelationshipID, b.ConversationID); !reflect.DeepEqual(got, wantB) {
		t.Fatalf("relationship fact missing from B: %v", got)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.relationship SET memory_share_scope='SESSION' WHERE owner_user_id=1 AND id=$1`, a.RelationshipID); err != nil {
		t.Fatal(err)
	}
	if got := profileAllowlist(t, a.RelationshipID, a.ConversationID); !reflect.DeepEqual(got, []string{idA}) {
		t.Fatalf("SESSION share kept another conversation: %v", got)
	}
	if got := profileAllowlist(t, a.RelationshipID, b.ConversationID); !reflect.DeepEqual(got, []string{idB}) {
		t.Fatalf("SESSION share kept another conversation: %v", got)
	}
}

func TestMemoryProfileBranchFamilyStaysOut(t *testing.T) {
	parent, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	siblingID := "10000000-0000-0000-0000-0000000000c3"
	independentID := "10000000-0000-0000-0000-0000000000c4"
	sibling, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: siblingID, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &parent.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	independent, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: independentID, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &parent.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "父分支事实", at)
	snapshots[siblingID] = stMemorySnapshot(siblingID, "兄弟分支事实", at)
	snapshots[siblingID].BranchRoot = sourceChat
	snapshots[independentID] = stMemorySnapshot(independentID, "独立会话事实", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, siblingID, independentID}); err != nil {
		t.Fatal(err)
	}
	parentMem := addSTMemory(t, parent, "父分支事实", refForChat(t, sourceChat))
	siblingMem := addSTMemory(t, sibling, "兄弟分支事实", refForChat(t, siblingID))
	independentMem := addSTMemory(t, independent, "独立会话事实", refForChat(t, independentID))
	parentID := fmt.Sprintf("fixture-record-%d", parentMem.ID)
	siblingRecord := fmt.Sprintf("fixture-record-%d", siblingMem.ID)
	independentRecord := fmt.Sprintf("fixture-record-%d", independentMem.ID)
	assertAllow := func(conv int64, want ...string) {
		t.Helper()
		sort.Strings(want)
		got := profileAllowlist(t, parent.RelationshipID, conv)
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("conversation %d allowlist %v want %v", conv, got, want)
		}
	}
	assertAllow(parent.ConversationID, parentID, independentRecord)
	assertAllow(sibling.ConversationID, siblingRecord, independentRecord)
	assertAllow(independent.ConversationID, parentID, siblingRecord, independentRecord)
}

func TestMemoryProfileExcludesStoryFacts(t *testing.T) {
	daily, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	storyID := "10000000-0000-0000-0000-0000000000c5"
	story, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: storyID, CharacterRef: "memory-card", Mode: "STORY", RelationshipID: &daily.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "今天阅读", at)
	snapshots[storyID] = stMemorySnapshot(storyID, "故事里的钟表", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, storyID}); err != nil {
		t.Fatal(err)
	}
	dailyMem := addSTMemory(t, daily, "日常阅读", refForChat(t, sourceChat))
	storyMem := addScopedMemory(t, story, "RELATIONSHIP", "故事钟表", refForChat(t, storyID))
	got := profileAllowlist(t, daily.RelationshipID, daily.ConversationID)
	want := []string{fmt.Sprintf("fixture-record-%d", dailyMem.ID)}
	if !reflect.DeepEqual(got, want) || containsString(got, fmt.Sprintf("fixture-record-%d", storyMem.ID)) {
		t.Fatalf("story fact entered the daily allowlist: %v", got)
	}
	if storyAllow := profileAllowlist(t, daily.RelationshipID, story.ConversationID); len(storyAllow) != 0 {
		t.Fatalf("story target allowlist %v", storyAllow)
	}
}

func TestEngineProfileCacheSkipsRebuild(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "固定阅读计划", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	addSTMemory(t, b, "固定阅读计划", ref)
	prepareEngineProfileJob(t, b, ref)
	claim, revision := loadProfileClaim(t, ref, b.RelationshipID)
	dep := sourceDependencyID(t, ref)
	rebuilds := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		case "/internal/rebuild-profile":
			rebuilds++
			json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": []string{dep}})
		case "/internal/read-profile":
			json.NewEncoder(w).Encode(map[string]any{"dependencies": []string{dep}, "files": map[string]string{"persona.md": "常驻短印象"}})
		case "/internal/search":
			json.NewEncoder(w).Encode([]any{})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	op := EngineOperation{ID: fmt.Sprintf("fixture-profile-%d", claim.JobID), ProfileOperationID: fmt.Sprintf("profile-cache-%d", claim.JobID), Scope: EngineScope(1, b.RelationshipID), Revision: revision, SourceRef: ref, Input: MemoryExtractInput{RelationshipID: b.RelationshipID, ConversationID: b.ConversationID}}
	if err = testEnv.store.BuildEngineProfile(ctx, claim, op, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	if rebuilds != 2 {
		t.Fatalf("first profile rebuilds=%d", rebuilds)
	}
	if err = testEnv.store.BuildEngineProfile(ctx, claim, op, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	if rebuilds != 2 {
		t.Fatalf("unchanged fingerprint called rebuild-profile %d times", rebuilds)
	}
}

func TestEngineProfileSelectsRelevantScenes(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "今天是周日阅读计划", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	memory := addSTMemory(t, b, "一条普通事实", ref)
	prepareEngineProfileJob(t, b, ref)
	claim, revision := loadProfileClaim(t, ref, b.RelationshipID)
	dep := sourceDependencyID(t, ref)
	recordID := fmt.Sprintf("fixture-record-%d", memory.ID)
	index := map[string][]string{"scene_blocks/keep.md": {recordID}, "scene_blocks/drop.md": {}}
	rawIndex, _ := json.Marshal(index)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		case "/internal/rebuild-profile":
			json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": []string{dep}})
		case "/internal/read-profile":
			json.NewEncoder(w).Encode(map[string]any{"dependencies": []string{dep}, "files": map[string]string{
				"persona.md":           "常驻短印象",
				"scene_blocks/keep.md": "周日阅读留在场景里",
				"scene_blocks/drop.md": "周日阅读不该进入注入",
				"scene_index.json":     string(rawIndex),
			}})
		case "/internal/search":
			json.NewEncoder(w).Encode([]any{})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	op := EngineOperation{ID: fmt.Sprintf("fixture-profile-%d", claim.JobID), ProfileOperationID: fmt.Sprintf("profile-scene-%d", claim.JobID), Scope: EngineScope(1, b.RelationshipID), Revision: revision, SourceRef: ref, Input: MemoryExtractInput{RelationshipID: b.RelationshipID, ConversationID: b.ConversationID}}
	if err = testEnv.store.BuildEngineProfile(ctx, claim, op, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	result, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.SummaryIDs) != 1 || len(result.MemoryIDs) != 0 || !strings.Contains(result.Block, "常驻短印象") || !strings.Contains(result.Block, "周日阅读留在场景里") || strings.Contains(result.Block, "周日阅读不该进入注入") {
		t.Fatalf("scene selection %+v", result)
	}
}

func sourceDependencyID(t *testing.T, ref string) string {
	t.Helper()
	var dependency string
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation FROM vc.st_message_source WHERE owner_user_id=1 AND source_ref=$1`, ref).Scan(&dependency)
	})
	if err != nil {
		t.Fatal(err)
	}
	return dependency
}

func loadProfileClaim(t *testing.T, ref string, rel int64) (JobClaim, int64) {
	t.Helper()
	claim := JobClaim{OwnerID: 1, Kind: "ST_MEMORY_EXTRACT"}
	var revision int64
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT w.id,w.ref_id,w.claim_token,w.claim_fence,mc.revision FROM vc.work_item w JOIN vc.memorycore_scope mc ON mc.owner_user_id=w.owner_user_id AND mc.relationship_id=$2 WHERE w.owner_user_id=1 AND w.kind='ST_MEMORY_EXTRACT' AND w.st_source_ref=$1`, ref, rel).Scan(&claim.JobID, &claim.RefID, &claim.Token, &claim.Fence, &revision)
	})
	if err != nil {
		t.Fatal(err)
	}
	return claim, revision
}

func profileAllowlist(t *testing.T, rel, conv int64) []string {
	t.Helper()
	ids := []string{}
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT DISTINCT record_id FROM vc.memory_profile_allowlist(1,$1,$2) ORDER BY record_id`, rel, conv)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	return ids
}

func addScopedMemory(t *testing.T, b STBinding, scope, summary, ref string) Memory {
	t.Helper()
	ctx := context.Background()
	m, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: b.RelationshipID, ConversationID: &b.ConversationID, Scope: scope, Summary: summary, Evidence: []string{ref}})
	if err != nil {
		t.Fatal(err)
	}
	m, err = testEnv.store.ConfirmMemory(ctx, 1, m.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	projectEngineFixture(t, m)
	return m
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
