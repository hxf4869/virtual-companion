//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

func TestDailySummaryRespectsRelevanceDateStoryAndForget(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at, err := time.Parse(time.RFC3339, "2026-10-20T20:00:00+08:00")
	if err != nil {
		t.Fatal(err)
	}
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "用户计划于2026年10月30日去厦门参加朋友婚礼。", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	memory := addSTMemory(t, b, "用户计划于2026年10月30日去厦门参加朋友婚礼。", ref)
	profileEngineFixture(t, b, ref, "用户将去厦门参加朋友婚礼，也在读蓝窗的书。")
	ask := func(chat, text string, at time.Time) STMemoryResult {
		t.Helper()
		message := "2" + chat[1:]
		snapshots[chat] = &stsource.Snapshot{ChatIdentity: chat, BranchRoot: chat, State: "PRESENT", Revision: 1, Location: "chats/card/" + chat + ".jsonl", Messages: []stsource.Message{{MessageID: message, CandidateID: "3" + chat[1:], Revision: 1, Role: "user", Text: text, Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"}}}
		if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{chat}); err != nil {
			t.Fatal(err)
		}
		out, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: chat, Revision: 1, Enabled: true, BudgetTokens: 1024})
		if err != nil {
			t.Fatal(err)
		}
		return out
	}
	bind := func(chat, mode string) {
		t.Helper()
		if _, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: chat, CharacterRef: "memory-card", Mode: mode, RelationshipID: &b.RelationshipID}); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Query     string `json:"query"`
			GateTexts []struct {
				ID string `json:"id"`
			} `json:"gateTexts"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || len(input.GateTexts) == 0 {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		gated := []string{}
		if strings.Contains(input.Query, "婚礼") || strings.Contains(input.Query, "安排") {
			gated = []string{"persona"}
		}
		json.NewEncoder(w).Encode(map[string]any{"hits": []any{}, "gated": gated})
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-summary-gate")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	queryChat := "10000000-0000-0000-0000-0000000000d1"
	bind(queryChat, "COMPANION")
	noAnswer := ask(queryChat, "我的幸运颜色是什么？", at)
	if strings.Contains(noAnswer.Block, "厦门") || strings.Contains(noAnswer.Block, "婚礼") || len(noAnswer.SummaryIDs) != 0 {
		t.Fatalf("unanswered question received the daily summary: %+v", noAnswer)
	}
	cross := ask(queryChat, "我的现实职业是什么？", at)
	if strings.Contains(cross.Block, "厦门") || strings.Contains(cross.Block, "蓝窗") || len(cross.SummaryIDs) != 0 {
		t.Fatalf("cross-topic question received the daily summary: %+v", cross)
	}
	relevantAt := at
	relevant := ask(queryChat, "厦门的婚礼是哪一天？", relevantAt)
	if len(relevant.SummaryIDs) != 1 || !strings.Contains(relevant.Block, "厦门") {
		t.Fatalf("relevant summary was dropped: %+v", relevant)
	}
	later, err := time.Parse(time.RFC3339, "2026-10-27T20:00:00+08:00")
	if err != nil {
		t.Fatal(err)
	}
	dated := ask(queryChat, "我下周五有什么安排？", later)
	if strings.Contains(dated.Block, "厦门") || strings.Contains(dated.Block, "婚礼") || strings.Contains(dated.Block, "蓝窗") || len(dated.SummaryIDs) != 0 {
		t.Fatalf("dated question kept a summary whose sources missed the date gate: %+v", dated)
	}
	storyChat := "10000000-0000-0000-0000-0000000000d2"
	bind(storyChat, "STORY")
	story := ask(storyChat, "怀表在哪里？", at)
	if story.Status != "disabled" || story.Block != "" || len(story.SummaryIDs) != 0 || strings.Contains(story.Block, "婚礼") {
		t.Fatalf("story mode injected the daily summary: %+v", story)
	}
	if err = testEnv.store.ForgetManagedMemory(ctx, 1, memory.ID); err != nil {
		t.Fatal(err)
	}
	forgotten := ask(queryChat, "厦门的婚礼是哪一天？", at)
	if strings.Contains(forgotten.Block, "厦门") || strings.Contains(forgotten.Block, "婚礼") || len(forgotten.SummaryIDs) != 0 {
		t.Fatalf("forgotten source still supplied the summary: %+v", forgotten)
	}
}
