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
	memoryEngineFixture(t)
	binding, err := testEnv.store.ResolveSTBinding(context.Background(), 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "source-card", Mode: "COMPANION", DisplayName: "来源测试"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/card/one.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我喜欢乌龙茶", Settled: true, Eligible: true}}}
	unavailable := new(bool)
	testEnv.store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
		if owner != 1 {
			t.Error("unexpected owner/source scope")
			return nil, stsource.ErrUnavailable
		}
		out := []stsource.Snapshot{}
		for _, query := range queries {
			if query.ChatIdentity != sourceChat {
				other := *snapshot
				other.ChatIdentity = query.ChatIdentity
				other.BranchRoot = other.ChatIdentity
				other.Revision = 1
				other.State = "PRESENT"
				other.NotModified = false
				other.Messages = []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "你记得我喜欢什么茶吗？", Eligible: true, Settled: false}}
				out = append(out, other)
			} else {
				if *unavailable {
					return nil, stsource.ErrUnavailable
				}
				out = append(out, *snapshot)
			}
		}
		return out, nil
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
	projectEngineFixture(t, m)
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
	mems, err := nativeSourceRecall(ctx, branch, 1)
	if err != nil || len(mems) != 1 {
		t.Fatalf("initial recall len=%d err=%v", len(mems), err)
	}
	snapshot.Revision = 2
	snapshot.Messages[0].Revision = 2
	snapshot.Messages[0].Text = "现在喜欢红茶"
	mems, err = nativeSourceRecall(ctx, branch, 1)
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
	mems, err := nativeSourceRecall(ctx, binding, snapshot.Revision)
	if err != nil || len(mems) != 0 {
		t.Fatalf("unavailable recall len=%d err=%v", len(mems), err)
	}
	*unavailable = false
	snapshot.NotModified = true
	snapshot.Messages = nil
	mems, err = nativeSourceRecall(ctx, binding, snapshot.Revision)
	if err != nil || len(mems) != 1 || mems[0].ID != m.ID {
		t.Fatalf("recovered recall len=%d err=%v", len(mems), err)
	}
	snapshot.NotModified = false
	snapshot.State = "DELETED"
	snapshot.Revision = 2
	mems, err = nativeSourceRecall(ctx, binding, snapshot.Revision)
	if err != nil || len(mems) != 0 {
		t.Fatalf("deleted recall len=%d err=%v", len(mems), err)
	}
}

func TestSTSourcesReconcileAcceptsNewerCommittedSnapshot(t *testing.T) {
	for _, state := range []string{"PRESENT", "UNAVAILABLE", "DELETED"} {
		t.Run(state, func(t *testing.T) {
			_, template, _ := sourceFixture(t)
			reads := 0
			testEnv.store.UseSTSourceReader(sourceReaderFunc(func(ctx context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
				reads++
				query := queries[0]
				revision := int64(1)
				if query.Revision != nil {
					revision = *query.Revision + 1
				}
				observed := *template
				observed.Revision = revision
				winner := observed
				winner.Revision++
				// A sibling reconciliation commits while this persisted read is in flight.
				_, err := testEnv.store.applySTSourceSnapshot(ctx, owner, stSourceBase{Query: query}, winner)
				if err != nil {
					t.Fatalf("commit sibling snapshot: %v", err)
				}
				if state != "PRESENT" {
					appliedRevision := winner.Revision
					winner.Revision++
					winner.State, winner.Messages = state, nil
					if _, err := testEnv.store.applySTSourceSnapshot(ctx, owner, stSourceBase{Query: stsource.Query{ChatIdentity: sourceChat, Revision: &appliedRevision}}, winner); err != nil {
						t.Fatalf("commit sibling availability decision: %v", err)
					}
				}
				return []stsource.Snapshot{observed}, nil
			}))
			result, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat})
			if err != nil {
				t.Fatalf("newer committed state must satisfy reconciliation: %v", err)
			}
			if len(result) != 1 || result[0].State != state || result[0].Revision == nil || *result[0].Revision < 2 || reads != 1 {
				t.Fatalf("state=%v reads=%d, want %s without repeated stale reads", result, reads, state)
			}
		})
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
