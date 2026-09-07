//go:build integration

package postgres

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/turn"
)

// markIneligible flips the persisted egress fact (V112) for the given message
// ids the way the runtime block/cancel paths do, bypassing the owner-bound
// marking function because the isolation superuser has no owner context.
func markIneligible(t *testing.T, ids []int64) {
	t.Helper()
	for _, id := range ids {
		if _, err := psqlSuper(fmt.Sprintf(
			`UPDATE vc.message SET model_eligible = false WHERE owner_user_id = 1 AND id = %d`, id)); err != nil {
			t.Fatal(err)
		}
	}
}

func messageContents(msgs []Message) map[string]bool {
	out := map[string]bool{}
	for _, m := range msgs {
		out[m.Content] = true
	}
	return out
}

// T-01: the model-facing reads exclude model_eligible=false rows while the
// user-facing read keeps seeing them (history/export visibility unchanged).
func TestModelEligibleReadsExcludeIneligibleRows(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := insertFixtureWindow(t, 1, conv, 10, "elig")
	markIneligible(t, []int64{ids[3], ids[8]})

	recent, err := store.ListRecentModelMessages(ctx, 1, conv, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 8 {
		t.Fatalf("model recent rows %d, want 8", len(recent))
	}
	got := messageContents(recent)
	if got["elig-0004"] || got["elig-0009"] {
		t.Fatalf("ineligible rows leaked into model read: %v", got)
	}

	userRecent, err := store.ListRecentMessages(ctx, 1, conv, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(userRecent) != 10 {
		t.Fatalf("user recent rows %d, want 10 (visibility unchanged)", len(userRecent))
	}

	forward, err := store.ListModelHistoryMessages(ctx, 1, conv, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(forward) != 8 {
		t.Fatalf("legacy forward rows %d, want 8", len(forward))
	}
	if forward[0].Content != "elig-0001" || forward[len(forward)-1].Content != "elig-0010" {
		t.Fatalf("legacy forward window %q..%q", forward[0].Content, forward[len(forward)-1].Content)
	}
	got = messageContents(forward)
	if got["elig-0004"] || got["elig-0009"] {
		t.Fatalf("ineligible rows leaked into legacy forward read: %v", got)
	}

	eligible, err := store.MessageModelEligible(ctx, 1, ids[3])
	if err != nil || eligible {
		t.Fatalf("source eligibility = %v, %v; want false", eligible, err)
	}
	eligible, err = store.MessageModelEligible(ctx, 1, ids[0])
	if err != nil || !eligible {
		t.Fatalf("kept-row eligibility = %v, %v; want true", eligible, err)
	}
}

// T-02: the eligibility filter runs BEFORE the LIMIT — an ineligible recent
// page must be backfilled with older eligible rows, not shorten the window.
func TestModelEligibleFiltersBeforeLimit(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := insertFixtureWindow(t, 1, conv, 70, "seed")
	markIneligible(t, ids[60:])

	recent, err := store.ListRecentModelMessages(ctx, 1, conv, nil, 64)
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 60 {
		t.Fatalf("model rows %d, want 60 (filter before limit)", len(recent))
	}
	if got := recent[0].Content; got != "seed-0001" {
		t.Fatalf("first row %q, want seed-0001", got)
	}
	if got := recent[len(recent)-1].Content; got != "seed-0060" {
		t.Fatalf("last row %q, want seed-0060", got)
	}
}

// T-04: foreign owners get nothing — the source fact fails closed and the
// recall selection returns an empty set instead of leaking existence.
func TestModelReadsRejectForeignOwner(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	ids := insertFixtureWindow(t, 1, conv, 2, "own")

	// 外账号与不存在同样不可区分：fail closed 返回 false，不报错、不泄露存在性。
	if eligible, err := store.MessageModelEligible(ctx, 2, ids[0]); err != nil || eligible {
		t.Fatalf("foreign owner eligibility = %v, %v; want false with no error", eligible, err)
	}
	foreign, err := store.SelectRecallMemories(ctx, 2, rel.ID, conv, "RELATIONSHIP")
	if err != nil {
		t.Fatal(err)
	}
	if len(foreign) != 0 {
		t.Fatalf("foreign owner recalled %d memories", len(foreign))
	}
}

// A retried turn re-checks its own source message: once the source lost
// eligibility the seed fails closed instead of re-sending the text.
func TestLoadSeedIneligibleSourceFailsClosed(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	grantOutboundConsents(t, store, 1)

	view, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: conv, IdempotencyKey: "src-turn-1",
		UserContent: "source-current", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)}); err != nil {
		t.Fatal(err)
	}
	raw, err := psqlSuper(fmt.Sprintf(
		`SELECT source_user_message_id FROM vc.generation WHERE owner_user_id = 1 AND id = %d`, view.ID))
	if err != nil {
		t.Fatal(err)
	}
	var srcID int64
	if _, err := fmt.Sscan(raw, &srcID); err != nil {
		t.Fatal(err)
	}
	markIneligible(t, []int64{srcID})

	if _, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)}); err == nil {
		t.Fatal("seed must fail closed when the source message lost eligibility")
	}
}

// T-05/T-06/T-08/T-10: the effective recall set excludes superseded,
// foreign-conversation SESSION, rejected, deleted, pending and expired rows;
// a past-due PLANNED event without expiry keeps its semantics.
func TestSelectRecallMemoriesExcludesIneffectiveRows(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	convA, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	convB, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}

	relOld := confirmFixtureMemory(t, store, 1, rel.ID, "RELATIONSHIP", nil, "rel-old", "k-old")
	memNew, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: rel.ID, Scope: "RELATIONSHIP", Summary: "rel-new", IdempotencyKey: "k-new",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConfirmMemory(ctx, 1, memNew.ID, &relOld); err != nil {
		t.Fatal(err)
	}
	confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convA, "sess-a", "k-sa")
	confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convB, "sess-b", "k-sb")

	rejected, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: rel.ID, Scope: "RELATIONSHIP", Summary: "rel-rejected", IdempotencyKey: "k-rej",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.RejectMemory(ctx, 1, rejected.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: rel.ID, Scope: "RELATIONSHIP", Summary: "rel-pending", IdempotencyKey: "k-pend",
	}); err != nil {
		t.Fatal(err)
	}
	deleted := confirmFixtureMemory(t, store, 1, rel.ID, "RELATIONSHIP", nil, "rel-deleted", "k-del")
	if _, err := store.DeleteMemory(ctx, 1, deleted); err != nil {
		t.Fatal(err)
	}

	past := time.Now().Add(-10 * 24 * time.Hour)
	expiredAt := time.Now().Add(-5 * 24 * time.Hour)
	expired, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: rel.ID, Scope: "RELATIONSHIP", Summary: "rel-expired", IdempotencyKey: "k-exp",
		EventAt: &past, EventExpiresAt: &expiredAt,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConfirmMemory(ctx, 1, expired.ID, nil); err != nil {
		t.Fatal(err)
	}
	due := time.Now().Add(-2 * 24 * time.Hour)
	planned, err := store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: rel.ID, Scope: "RELATIONSHIP", Summary: "rel-planned", IdempotencyKey: "k-plan",
		EventAt: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ConfirmMemory(ctx, 1, planned.ID, nil); err != nil {
		t.Fatal(err)
	}

	summarize := func(mems []Memory) map[string]bool {
		out := map[string]bool{}
		for _, m := range mems {
			out[m.Summary] = true
		}
		return out
	}

	relRecall, err := store.SelectRecallMemories(ctx, 1, rel.ID, convA, "RELATIONSHIP")
	if err != nil {
		t.Fatal(err)
	}
	got := summarize(relRecall)
	for _, want := range []string{"rel-new", "sess-a", "rel-planned"} {
		if !got[want] {
			t.Fatalf("effective recall missing %q: %v", want, got)
		}
	}
	for _, banned := range []string{"rel-old", "sess-b", "rel-rejected", "rel-pending", "rel-deleted", "rel-expired"} {
		if got[banned] {
			t.Fatalf("ineffective row %q recalled: %v", banned, got)
		}
	}

	sessionRecall, err := store.SelectRecallMemories(ctx, 1, rel.ID, convA, "SESSION")
	if err != nil {
		t.Fatal(err)
	}
	got = summarize(sessionRecall)
	if len(got) != 1 || !got["sess-a"] {
		t.Fatalf("SESSION share scope must recall only the current conversation's SESSION rows: %v", got)
	}
}

// T-07: the seed honours the relationship's memoryShareScope read convention.
func TestLoadSeedHonoursMemoryShareScope(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	ciph, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)

	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	convA, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	convB, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	grantOutboundConsents(t, store, 1)

	view, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: convA, IdempotencyKey: "scope-turn-1",
		UserContent: "scope-current", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	relMem := confirmFixtureMemory(t, store, 1, rel.ID, "RELATIONSHIP", nil, "rel-scope", "k-rel")
	sessionA := confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convA, "sess-a", "k-a")
	sessionB := confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convB, "sess-b", "k-b")

	eligible := func() map[string]bool {
		t.Helper()
		seed, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)})
		if err != nil {
			t.Fatal(err)
		}
		out := map[string]bool{}
		for _, cand := range seed.EligibleMemories {
			out[cand.SourceID] = true
		}
		return out
	}

	if _, err := psqlSuper(fmt.Sprintf(
		`UPDATE vc.relationship SET memory_share_scope = 'SESSION' WHERE owner_user_id = 1 AND id = %d`, rel.ID)); err != nil {
		t.Fatal(err)
	}
	got := eligible()
	if !got[strconv.FormatInt(sessionA, 10)] {
		t.Fatal("current-conversation SESSION memory missing under SESSION scope")
	}
	if got[strconv.FormatInt(relMem, 10)] || got[strconv.FormatInt(sessionB, 10)] {
		t.Fatal("SESSION share scope leaked relationship or foreign-conversation memories")
	}

	if _, err := psqlSuper(fmt.Sprintf(
		`UPDATE vc.relationship SET memory_share_scope = 'RELATIONSHIP' WHERE owner_user_id = 1 AND id = %d`, rel.ID)); err != nil {
		t.Fatal(err)
	}
	got = eligible()
	if !got[strconv.FormatInt(relMem, 10)] || !got[strconv.FormatInt(sessionA, 10)] {
		t.Fatalf("RELATIONSHIP scope must recall relationship + current-conversation SESSION rows: %v", got)
	}
	if got[strconv.FormatInt(sessionB, 10)] {
		t.Fatal("other-conversation SESSION memory leaked into seed")
	}
}
