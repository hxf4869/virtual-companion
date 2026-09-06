//go:build integration

package postgres

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/turn"
)

// insertFixtureWindow inserts n alternating user/assistant messages with
// zero-padded synthetic content "prefix-NNNN" and returns their ids in
// ascending order. Content is stored through the store cipher so reads stay
// consistent regardless of test order.
func insertFixtureWindow(t *testing.T, owner, conv int64, n int, prefix string) []int64 {
	t.Helper()
	ctx := context.Background()
	var tuples strings.Builder
	args := []any{owner, conv}
	for i := 1; i <= n; i++ {
		stored, err := testEnv.store.encryptStored(fmt.Sprintf("%s-%04d", prefix, i))
		if err != nil {
			t.Fatal(err)
		}
		role := "user"
		if i%2 == 0 {
			role = "assistant"
		}
		if i > 1 {
			tuples.WriteString(",")
		}
		fmt.Fprintf(&tuples, "($%d,$%d)", len(args)+1, len(args)+2)
		args = append(args, role, stored)
	}
	sql := `INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
	        SELECT $1, nextval('vc.message_id_seq'), $2, r.role, r.content
	          FROM (VALUES ` + tuples.String() + `) AS r(role, content)`
	if n > 0 {
		if err := IsolationSuperExec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	raw, err := psqlSuper(fmt.Sprintf(
		`SELECT string_agg(id::text, ',' ORDER BY id) FROM vc.message
		  WHERE owner_user_id = %d AND conversation_id = %d`, owner, conv))
	if err != nil {
		t.Fatal(err)
	}
	var ids []int64
	for _, part := range strings.Split(raw, ",") {
		if part == "" {
			continue
		}
		id, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func contents(msgs []Message) []string {
	out := make([]string, 0, len(msgs))
	for _, m := range msgs {
		out = append(out, m.Content)
	}
	return out
}

func TestListRecentMessagesRecentWindowBoundaries(t *testing.T) {
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
	empty, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	single, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	big, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}

	insertFixtureWindow(t, 1, single, 1, "one")
	bigIDs := insertFixtureWindow(t, 1, big, 200, "big")

	// Empty conversation: tail read returns an empty (non-nil) list.
	got, err := store.ListRecentMessages(ctx, 1, empty, nil, 50)
	if err != nil || len(got) != 0 || got == nil {
		t.Fatalf("empty window %v %v", got, err)
	}

	// One message: tail read returns exactly it, ascending.
	got, err = store.ListRecentMessages(ctx, 1, single, nil, 50)
	if err != nil || len(got) != 1 || got[0].Content != "one-0001" {
		t.Fatalf("single window %v %v", contents(got), err)
	}

	// 200-message conversation, various limit boundaries against the tail.
	for _, tc := range []struct {
		limit int
		want  int
		first string
	}{
		{limit: 0, want: 50, first: "big-0151"}, // server default
		{limit: 49, want: 49, first: "big-0152"},
		{limit: 50, want: 50, first: "big-0151"},
		{limit: 51, want: 51, first: "big-0150"},
		{limit: 200, want: 100, first: "big-0101"}, // capped at 100
	} {
		got, err = store.ListRecentMessages(ctx, 1, big, nil, tc.limit)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != tc.want {
			t.Fatalf("limit %d: got %d rows, want %d", tc.limit, len(got), tc.want)
		}
		if got[0].Content != tc.first {
			t.Fatalf("limit %d: first %q, want %q", tc.limit, got[0].Content, tc.first)
		}
		for i := 1; i < len(got); i++ {
			if got[i-1].ID >= got[i].ID {
				t.Fatalf("limit %d: rows not ascending at %d", tc.limit, i)
			}
		}
	}

	// before is exclusive: window ends just below bigIDs[149].
	got, err = store.ListRecentMessages(ctx, 1, big, &bigIDs[149], 51)
	if err != nil || len(got) != 51 {
		t.Fatalf("before window %d rows err=%v", len(got), err)
	}
	if got[0].Content != "big-0099" || got[len(got)-1].Content != "big-0149" {
		t.Fatalf("before window bounds %v", contents(got))
	}

	// before at the oldest message: nothing below it.
	got, err = store.ListRecentMessages(ctx, 1, big, &bigIDs[0], 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("before-oldest window %v %v", contents(got), err)
	}

	// Cross-owner reads stay empty.
	got, err = store.ListRecentMessages(ctx, 2, big, nil, 50)
	if err != nil || len(got) != 0 {
		t.Fatalf("cross-owner window %v %v", contents(got), err)
	}
}

func TestListRecentMessagesAssistantSelectedVisibility(t *testing.T) {
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

	genA, err := psqlSuper(`SELECT nextval('vc.generation_id_seq')`)
	if err != nil {
		t.Fatal(err)
	}
	genB, err := psqlSuper(`SELECT nextval('vc.generation_id_seq')`)
	if err != nil {
		t.Fatal(err)
	}
	genAID, err := strconv.ParseInt(genA, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	genBID, err := strconv.ParseInt(genB, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	userStored, err := store.encryptStored("vis-user")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx,
		`INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
		 VALUES ($1, nextval('vc.message_id_seq'), $2, 'user', $3)`,
		1, conv, userStored); err != nil {
		t.Fatal(err)
	}
	userIDRaw, err := psqlSuper(fmt.Sprintf(
		`SELECT max(id) FROM vc.message WHERE owner_user_id = 1 AND conversation_id = %d`, conv))
	if err != nil {
		t.Fatal(err)
	}
	userID, err := strconv.ParseInt(userIDRaw, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		genID   int64
		logical string
		stored  string
	}{
		{genAID, "vis-unselected", "vis-assistant-unselected"},
		{genBID, "vis-selected", "vis-assistant-selected"},
	} {
		stored, err := store.encryptStored(tc.stored)
		if err != nil {
			t.Fatal(err)
		}
		if err := IsolationSuperExec(ctx,
			`INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status, source_user_message_id, selected)
			 VALUES (1, $1, $2, $3, 'COMPLETED', $4, false)`,
			tc.genID, conv, tc.logical, userID); err != nil {
			t.Fatal(err)
		}
		if err := IsolationSuperExec(ctx,
			`INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, generation_id)
			 VALUES (1, nextval('vc.message_id_seq'), $1, 'assistant', $2, $3)`,
			conv, stored, tc.genID); err != nil {
			t.Fatal(err)
		}
	}

	// Both assistant versions unselected: FR-CHAT-003 hides both.
	got, err := store.ListRecentMessages(ctx, 1, conv, nil, 50)
	if err != nil || len(got) != 1 || got[0].Content != "vis-user" {
		t.Fatalf("unselected window %v %v", contents(got), err)
	}

	// Select genA: its assistant message becomes visible, genB stays hidden.
	if err := IsolationSuperExec(ctx, `UPDATE vc.generation SET selected = true WHERE id = $1`, genAID); err != nil {
		t.Fatal(err)
	}
	got, err = store.ListRecentMessages(ctx, 1, conv, nil, 50)
	if err != nil || len(got) != 2 || got[0].Content != "vis-user" || got[1].Content != "vis-assistant-unselected" {
		t.Fatalf("selected window %v %v", contents(got), err)
	}

	// Forward ListMessages keeps its exact semantics: same visibility, same rows.
	fwd, err := store.ListMessages(ctx, 1, conv, nil, nil)
	if err != nil || len(fwd) != 2 || fwd[1].Content != "vis-assistant-unselected" {
		t.Fatalf("forward path changed %v %v", contents(fwd), err)
	}
}

func confirmFixtureMemory(t *testing.T, store *Store, owner, relID int64, scope string, conv *int64, summary, key string) int64 {
	t.Helper()
	mem, err := store.CreateMemoryCandidate(context.Background(), owner, MemoryCreate{
		RelationshipID: relID, Scope: scope, Summary: summary,
		ConversationID: conv, IdempotencyKey: key,
	})
	if err != nil {
		t.Fatal(err)
	}
	confirmed, err := store.ConfirmMemory(context.Background(), owner, mem.ID, nil)
	if err != nil || confirmed.Status != "ACCEPTED" {
		t.Fatalf("confirm %s: %+v %v", summary, confirmed, err)
	}
	return mem.ID
}

func TestLoadSeedRecentWindowBeforeSource(t *testing.T) {
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

	// 70 history rows; the legacy earliest-window read would seed ids 1..64,
	// the recent-window read must seed ids 7..70.
	insertFixtureWindow(t, 1, conv, 70, "seed")

	view, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: conv, IdempotencyKey: "seed-turn-1",
		UserContent: "seed-current", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	seed, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)})
	if err != nil {
		t.Fatal(err)
	}
	if seed.CurrentUserMessage != "seed-current" {
		t.Fatalf("current %q", seed.CurrentUserMessage)
	}
	if len(seed.RecentMessages) != 64 {
		t.Fatalf("seed rows %d, want 64", len(seed.RecentMessages))
	}
	if got := seed.RecentMessages[0].Content; got != "seed-0007" {
		t.Fatalf("seed first %q, want seed-0007", got)
	}
	if got := seed.RecentMessages[len(seed.RecentMessages)-1].Content; got != "seed-0070" {
		t.Fatalf("seed last %q, want seed-0070", got)
	}
	for _, m := range seed.RecentMessages {
		if m.Content == "seed-current" {
			t.Fatal("source message leaked into seed history")
		}
	}
}

func TestLoadSeedSessionMemoryStaysInConversation(t *testing.T) {
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
		ConversationID: convA, IdempotencyKey: "mem-turn-1",
		UserContent: "mem-current", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}

	relID := confirmFixtureMemory(t, store, 1, rel.ID, "RELATIONSHIP", nil, "rel-memory", "mem-rel")
	sessionA := confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convA, "session-a", "mem-sa")
	sessionB := confirmFixtureMemory(t, store, 1, rel.ID, "SESSION", &convB, "session-b", "mem-sb")

	seed, err := store.LoadSeed(ctx, turn.TurnKey{OwnerID: 1, TurnID: itoa(view.ID)})
	if err != nil {
		t.Fatal(err)
	}
	eligible := map[string]bool{}
	for _, cand := range seed.EligibleMemories {
		eligible[cand.SourceID] = true
	}
	if !eligible[strconv.FormatInt(relID, 10)] {
		t.Fatal("relationship memory missing from seed")
	}
	if !eligible[strconv.FormatInt(sessionA, 10)] {
		t.Fatal("current-conversation SESSION memory missing from seed")
	}
	if eligible[strconv.FormatInt(sessionB, 10)] {
		t.Fatal("other-conversation SESSION memory leaked into seed")
	}
}
