//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

type sourceReaderFunc func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error)

func (f sourceReaderFunc) Read(c context.Context, o int64, q []stsource.Query) ([]stsource.Snapshot, error) {
	return f(c, o, q)
}

const sourceChat = "10000000-0000-0000-0000-000000000001"
const sourceMessage = "20000000-0000-0000-0000-000000000001"
const sourceCandidate = "30000000-0000-0000-0000-000000000001"

func sourceFixture(t *testing.T) (STBinding, *stsource.Snapshot, *bool) {
	t.Helper()
	resetFixtures(t)
	binding, err := testEnv.store.ResolveSTBinding(context.Background(), 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "source-card", Mode: "COMPANION", DisplayName: "来源测试"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/card/one.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我喜欢乌龙茶", Settled: true, Eligible: true}}}
	unavailable := new(bool)
	testEnv.store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
		if owner != 1 || len(queries) != 1 || queries[0].ChatIdentity != sourceChat {
			t.Error("unexpected owner/source scope")
			return nil, stsource.ErrUnavailable
		}
		if *unavailable {
			return nil, stsource.ErrUnavailable
		}
		return []stsource.Snapshot{*snapshot}, nil
	}))
	t.Cleanup(func() { testEnv.store.UseSTSourceReader(nil) })
	return binding, snapshot, unavailable
}
func currentSourceRef(t *testing.T) string {
	t.Helper()
	var ref string
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT source_ref FROM vc.st_message_source WHERE owner_user_id=1 AND present`).Scan(&ref)
	})
	if err != nil {
		t.Fatal(err)
	}
	return ref
}
func acceptedSourceMemory(t *testing.T, binding STBinding, ref string) Memory {
	t.Helper()
	ctx := context.Background()
	m, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: binding.RelationshipID, ConversationID: &binding.ConversationID, Scope: "RELATIONSHIP", Summary: "喜欢乌龙茶", Evidence: []string{ref}})
	if err != nil {
		t.Fatal(err)
	}
	m, err = testEnv.store.ConfirmMemory(ctx, 1, m.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	return m
}
func TestSTSourcesCrossChatRecallReconcilesMissedEditsAndLateResults(t *testing.T) {
	binding, snapshot, _ := sourceFixture(t)
	ctx := context.Background()
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	oldRef := currentSourceRef(t)
	acceptedSourceMemory(t, binding, oldRef)
	branch, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: "10000000-0000-0000-0000-000000000002", CharacterRef: "source-card", Mode: "COMPANION", RelationshipID: &binding.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	mems, err := testEnv.store.SelectRecallMemories(ctx, 1, binding.RelationshipID, branch.ConversationID, "RELATIONSHIP")
	if err != nil || len(mems) != 1 {
		t.Fatalf("initial recall len=%d err=%v", len(mems), err)
	}
	snapshot.Revision = 2
	snapshot.Messages[0].Revision = 2
	snapshot.Messages[0].Text = "现在喜欢红茶"
	mems, err = testEnv.store.SelectRecallMemories(ctx, 1, binding.RelationshipID, branch.ConversationID, "RELATIONSHIP")
	if err != nil || len(mems) != 0 {
		t.Fatalf("stale cross-chat recall len=%d err=%v", len(mems), err)
	}
	_, err = testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: binding.RelationshipID, Scope: "RELATIONSHIP", Summary: "迟到的旧结果", Evidence: []string{oldRef}})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("late write=%v", err)
	}
}
func TestSTSourcesUnavailableRecoversWithoutPermanentInvalidation(t *testing.T) {
	binding, snapshot, unavailable := sourceFixture(t)
	ctx := context.Background()
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	m := acceptedSourceMemory(t, binding, currentSourceRef(t))
	*unavailable = true
	mems, err := testEnv.store.SelectRecallMemories(ctx, 1, binding.RelationshipID, binding.ConversationID, "RELATIONSHIP")
	if err != nil || len(mems) != 0 {
		t.Fatalf("unavailable recall len=%d err=%v", len(mems), err)
	}
	*unavailable = false
	snapshot.NotModified = true
	snapshot.Messages = nil
	mems, err = testEnv.store.SelectRecallMemories(ctx, 1, binding.RelationshipID, binding.ConversationID, "RELATIONSHIP")
	if err != nil || len(mems) != 1 || mems[0].ID != m.ID {
		t.Fatalf("recovered recall len=%d err=%v", len(mems), err)
	}
	snapshot.NotModified = false
	snapshot.State = "DELETED"
	snapshot.Revision = 2
	mems, err = testEnv.store.SelectRecallMemories(ctx, 1, binding.RelationshipID, binding.ConversationID, "RELATIONSHIP")
	if err != nil || len(mems) != 0 {
		t.Fatalf("deleted recall len=%d err=%v", len(mems), err)
	}
}
func TestSTSourcesUnsettledAndSuppressedCannotBeEvidence(t *testing.T) {
	binding, snapshot, _ := sourceFixture(t)
	ctx := context.Background()
	snapshot.Messages[0].Settled = false
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	oldRef := currentSourceRef(t)
	create := MemoryCreate{RelationshipID: binding.RelationshipID, Scope: "RELATIONSHIP", Summary: "来源事实", Evidence: []string{oldRef}}
	if _, err := testEnv.store.CreateMemoryCandidate(ctx, 1, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unsettled write=%v", err)
	}
	snapshot.Revision++
	snapshot.Messages[0].Settled = true
	m := acceptedSourceMemory(t, binding, oldRef)
	if _, err := testEnv.store.DeleteMemory(ctx, 1, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.CreateMemoryCandidate(ctx, 1, create); !errors.Is(err, ErrInvalid) {
		t.Fatalf("suppressed write=%v", err)
	}
}
