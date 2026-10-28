//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func stMemoryFixture(t *testing.T) (STBinding, map[string]*stsource.Snapshot) {
	t.Helper()
	resetFixtures(t)
	memoryEngineFixture(t)
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseCipher(ciph)
	t.Cleanup(func() { testEnv.store.UseSTSourceReader(nil); testEnv.store.UseCipher(nil) })
	b, err := testEnv.store.ResolveSTBinding(context.Background(), 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "memory-card", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	snapshots := map[string]*stsource.Snapshot{}
	testEnv.store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
		if owner != 1 {
			return nil, stsource.ErrUnavailable
		}
		out := []stsource.Snapshot{}
		for _, q := range queries {
			v, ok := snapshots[q.ChatIdentity]
			if !ok {
				return nil, stsource.ErrUnavailable
			}
			out = append(out, *v)
		}
		return out, nil
	}))
	return b, snapshots
}
func stMemorySnapshot(chat, text string, at time.Time) *stsource.Snapshot {
	return &stsource.Snapshot{ChatIdentity: chat, BranchRoot: chat, State: "PRESENT", Revision: 1, Location: "chats/card/" + chat + ".jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: text, Eligible: true, Settled: true, SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai"}}}
}
func addSTMemory(t *testing.T, b STBinding, summary, ref string) Memory {
	t.Helper()
	ctx := context.Background()
	m, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: b.RelationshipID, ConversationID: &b.ConversationID, Scope: "RELATIONSHIP", Summary: summary, Evidence: []string{ref}})
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
func refForChat(t *testing.T, chat string) string {
	t.Helper()
	var ref string
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT s.source_ref FROM vc.st_message_source s JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id) WHERE s.owner_user_id=1 AND c.st_chat_identity=$1 AND s.present ORDER BY s.source_position DESC LIMIT 1`, chat).Scan(&ref)
	})
	if err != nil {
		t.Fatal(err)
	}
	return ref
}
func TestSTMemoryQueryBeyondHundredAndDateAnchor(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at, _ := time.Parse(time.RFC3339, "2026-10-20T20:00:00+08:00")
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "我下周五去厦门参加朋友婚礼。", at)
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	for i := 0; i < 101; i++ {
		addSTMemory(t, b, fmt.Sprintf("用户收藏了第%d枚书签", i), ref)
	}
	wedding := addSTMemory(t, b, "用户下周五去厦门参加朋友婚礼。", ref)
	if wedding.Time == nil || wedding.Time.EventDate == nil || *wedding.Time.EventDate != "2026-10-30" || wedding.Time.ReminderAt != nil {
		t.Fatalf("wrong immutable date: %+v", wedding.Time)
	}
	for _, text := range []string{"2026年10月30日准备去哪里，为什么？", "10月30日我要去哪里？"} {
		date := "2026-10-30"
		got, err := testEnv.store.searchEngineMemories(ctx, 1, b.RelationshipID, b.ConversationID, recallQuery{Text: text, Date: &date, Limit: 20})
		if err != nil || len(got) != 1 || got[0].ID != wedding.ID {
			t.Fatalf("new relevant record hidden by fixed window: n=%d err=%v", len(got), err)
		}
	}
	later := "2026-11-06"
	got, err := testEnv.store.searchEngineMemories(ctx, 1, b.RelationshipID, b.ConversationID, recallQuery{Text: "我下周五有什么安排", Date: &later, Limit: 20})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range got {
		if m.ID == wedding.ID {
			t.Fatal("query moved the event to next week")
		}
	}
	saved, err := testEnv.store.GetMemory(ctx, 1, wedding.ID)
	if err != nil || *saved.Time.EventDate != "2026-10-30" {
		t.Fatal("read mutated normalization")
	}
	if _, err := testEnv.store.UpdateMemory(ctx, 1, wedding.ID, "用户喜欢看书", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	saved, err = testEnv.store.GetMemory(ctx, 1, wedding.ID)
	if err != nil || saved.Time.EventDate != nil {
		t.Fatal("correction retained stale event date")
	}
}
func TestSTMemorySummaryScopeInvalidationAndBudget(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "我们正在讨论蓝窗书店的读书计划，下一本书未定。", at)
	otherChat := "10000000-0000-0000-0000-000000000002"
	other, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: otherChat, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &b.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	snapshots[otherChat] = stMemorySnapshot(otherChat, "我们上次谈到哪一步了？", at.Add(7*24*time.Hour))
	snapshots[otherChat].Messages[0].Settled = false
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{otherChat}); err != nil {
		t.Fatal(err)
	}
	memory := addSTMemory(t, b, "用户讨论蓝窗书店的读书计划", refForChat(t, sourceChat))
	profileEngineFixture(t, b, refForChat(t, sourceChat), "我们正在讨论蓝窗书店的读书计划，下一本书未定。")
	req := STMemoryRequest{ChatIdentity: otherChat, Revision: 1, Enabled: true, BudgetTokens: 1024}
	out, err := testEnv.store.RecallSTMemory(ctx, 1, req)
	if err != nil || !strings.Contains(out.Block, "蓝窗书店") || len(out.SummaryIDs) != 1 {
		t.Fatalf("summary not consumed: %+v err=%v", out, err)
	}
	if _, err := testEnv.store.DeleteMemory(ctx, 1, memory.ID); err != nil {
		t.Fatal(err)
	}
	out, err = testEnv.store.RecallSTMemory(ctx, 1, req)
	if err != nil || strings.Contains(out.Block, "蓝窗书店") {
		t.Fatalf("forgotten source survived summary: %+v %v", out, err)
	}
	snapshots[sourceChat].State = "UNAVAILABLE"
	out, err = testEnv.store.RecallSTMemory(ctx, 1, req)
	if err != nil || out.Status != "skipped" || out.Block != "" {
		t.Fatalf("unavailable used old summary: %+v %v", out, err)
	}
	snapshots[sourceChat].State = "PRESENT"
	req.Enabled = false
	out, err = testEnv.store.RecallSTMemory(ctx, 1, req)
	if err != nil || out.Status != "disabled" || out.Block != "" {
		t.Fatal("disabled injection not empty")
	}
	req.Enabled = true
	req.Revision = 0
	if _, err := testEnv.store.RecallSTMemory(ctx, 1, req); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale revision=%v", err)
	}
	req.Revision = 1
	if _, err := testEnv.store.RecallSTMemory(ctx, 2, req); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign chat=%v", err)
	}
	// Current branch cannot recall the independent parent/alternate snapshot.
	snapshots[otherChat].BranchRoot = sourceChat
	snapshots[otherChat].Revision = 2
	req.Revision = 2
	snapshots[sourceChat].Messages[0].Revision = 2
	// A new source after forgetting is a new message; editing the suppressed
	// candidate itself deliberately cannot opt it back into memory.
	snapshots[sourceChat].Messages[0].MessageID = "20000000-0000-0000-0000-000000000099"
	snapshots[sourceChat].Messages[0].CandidateID = "30000000-0000-0000-0000-000000000099"
	snapshots[sourceChat].Messages[0].Text = "我们选择了红门。"
	snapshots[sourceChat].Revision = 2
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	addSTMemory(t, b, "我们选择了红门", refForChat(t, sourceChat))
	out, err = testEnv.store.RecallSTMemory(ctx, 1, req)
	if err != nil || strings.Contains(out.Block, "红门") {
		t.Fatalf("parent branch leak: %+v %v", out, err)
	}
	_ = other
}
func TestSTMemoryAmbiguityAndStoryIsolation(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 16, 30, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "明天晚上提醒我带书。", at)
	snapshots[sourceChat].Messages[0].SourceTimezone = ""
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	m := addSTMemory(t, b, "用户明天晚上提醒我带书。", refForChat(t, sourceChat))
	if m.Time == nil || m.Time.NormalizationStatus != "needs_clarification" || m.Time.EventDate != nil || m.Time.ReminderAt != nil {
		t.Fatalf("ambiguous time guessed: %+v", m.Time)
	}
	storyChat := "10000000-0000-0000-0000-000000000009"
	_, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: storyChat, CharacterRef: "memory-card", Mode: "STORY", RelationshipID: &b.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	out, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: storyChat, Revision: 0, Enabled: true})
	if err != nil || out.Status != "disabled" || out.Block != "" {
		t.Fatalf("story used shared memory: %+v %v", out, err)
	}
}

func TestSTMemoryRechecksDiscoveredBranchScope(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	at := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "我们上次谈到哪一步了？", at)
	branch := "10000000-0000-0000-0000-000000000008"
	_, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: branch, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &b.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	// Binding exists, but the browser disappeared before its first source
	// notification. Only the recall's own read learns the branch family.
	snapshots[branch] = stMemorySnapshot(branch, "支线独有秘密：金色钟摆。", at)
	snapshots[branch].BranchRoot = sourceChat
	out, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024})
	if err != nil || strings.Contains(out.Block, "金色钟摆") {
		t.Fatalf("newly-discovered branch leaked: %+v err=%v", out, err)
	}
	var root string
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT st_branch_root FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity=$1`, branch).Scan(&root)
	}); err != nil || root != sourceChat {
		t.Fatalf("branch observation missing: root=%s err=%v", root, err)
	}
	out, err = testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 128})
	if err != nil {
		t.Fatal(err)
	}
	if out.Block != "" && stMemoryBlockTokens(out.Block) > 128 {
		t.Fatal("native wrapper exceeded memory budget")
	}
}
func TestSTMemoryRejectsTargetChangedDuringDependencyReads(t *testing.T) {
	for _, state := range []string{"PRESENT", "DELETED"} {
		t.Run(state, func(t *testing.T) {
			b, snapshots := stMemoryFixture(t)
			ctx := context.Background()
			at := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
			snapshot := stMemorySnapshot(sourceChat, "旧查询：我们上次讨论什么？", at)
			snapshots[sourceChat] = snapshot
			if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
				t.Fatal(err)
			}
			addSTMemory(t, b, "我们上次讨论读书", refForChat(t, sourceChat))
			reads := 0
			testEnv.store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, _ int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
				out := []stsource.Snapshot{}
				for range queries {
					reads++
					copy := *snapshot
					if reads > 1 {
						copy.Revision = 2
						copy.State = state
						if state == "DELETED" {
							copy.Messages = nil
						}
					}
					out = append(out, copy)
				}
				return out, nil
			}))
			_, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: sourceChat, Revision: 1, Enabled: true, BudgetTokens: 1024})
			if !errors.Is(err, ErrConflict) || reads < 2 {
				t.Fatalf("observed target mutation accepted: reads=%d err=%v", reads, err)
			}
		})
	}
}
