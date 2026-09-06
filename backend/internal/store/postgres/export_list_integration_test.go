//go:build integration

package postgres

import (
	"context"
	"fmt"
	"testing"
)

// insertExportFixtureConversation creates one conversation for owner with a
// single synthetic message and returns its id. Messages go through the store
// cipher so reads stay consistent.
func insertExportFixtureConversation(t *testing.T, owner, rel int64, n int) int64 {
	t.Helper()
	ctx := context.Background()
	conv, err := testEnv.store.CreateConversation(ctx, owner, rel, false)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := testEnv.store.encryptStored(fmt.Sprintf("export-%04d", n))
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx,
		`INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
		 VALUES ($1, nextval('vc.message_id_seq'), $2, 'user', $3)`,
		owner, conv, stored); err != nil {
		t.Fatal(err)
	}
	return conv
}

// TestListExportConversationsStableIdCursorPins audit L1 end to end: the V130
// listing pages the full owner conversation set by immutable id across page
// boundaries, and a derived last-activity change on a not-yet-exported
// conversation between pages cannot skip or repeat anything.
func TestListExportConversationsStableIdCursor(t *testing.T) {
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
	const total = 130
	ids := map[int64]bool{}
	for i := 0; i < total; i++ {
		id := insertExportFixtureConversation(t, 1, rel.ID, i)
		if ids[id] {
			t.Fatalf("duplicate fixture conversation %d", id)
		}
		ids[id] = true
	}

	// Page 1: newest 100 by id. A conversation NOT on this page receives new
	// activity (its newest message jumps forward in time), which under the old
	// mutable (last_activity_at, id) cursor would reorder pages mid-export.
	limit := 100
	page1, err := store.ListExportConversations(ctx, 1, nil, &limit)
	if err != nil {
		t.Fatal(err)
	}
	if len(page1) != 100 {
		t.Fatalf("page 1 rows %d, want 100", len(page1))
	}
	exported := map[int64]bool{}
	for _, c := range page1 {
		if !ids[c.ID] {
			t.Fatalf("page 1 returned unknown conversation %d", c.ID)
		}
		exported[c.ID] = true
	}
	var untouched int64
	for id := range ids {
		if !exported[id] {
			untouched = id
			break
		}
	}
	if untouched == 0 {
		t.Fatal("no unexported fixture conversation found")
	}
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.message SET created_at = clock_timestamp() + interval '1 hour'
		  WHERE conversation_id = $1 AND owner_user_id = 1`, untouched); err != nil {
		t.Fatal(err)
	}

	// Remaining pages over the stable id cursor.
	var all []Conversation
	all = append(all, page1...)
	after := page1[len(page1)-1].ID
	for {
		page, err := store.ListExportConversations(ctx, 1, &after, &limit)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, page...)
		if len(page) < limit {
			break
		}
		after = page[len(page)-1].ID
	}

	if len(all) != total {
		t.Fatalf("listed rows %d, want %d (exactly once each)", len(all), total)
	}
	seen := map[int64]bool{}
	for i, c := range all {
		if seen[c.ID] {
			t.Fatalf("conversation %d listed twice", c.ID)
		}
		seen[c.ID] = true
		if i > 0 && all[i-1].ID <= c.ID {
			t.Fatalf("rows not strictly descending at %d: %d then %d", i, all[i-1].ID, c.ID)
		}
		if c.ID == untouched && i < 100 {
			t.Fatalf("activity-changed conversation %d jumped ahead to position %d", untouched, i)
		}
	}
	if len(seen) != total {
		t.Fatalf("unique conversations %d, want %d", len(seen), total)
	}

	// Owner-bound: owner 2 sees nothing of owner 1.
	cross, err := store.ListExportConversations(ctx, 2, nil, &limit)
	if err != nil || len(cross) != 0 {
		t.Fatalf("cross-owner export listing %d rows err=%v", len(cross), err)
	}

	// The frontend listing keeps its V122 activity-order semantics untouched.
	front, err := store.ListConversations(ctx, 1, nil, nil, &limit)
	if err != nil {
		t.Fatal(err)
	}
	if len(front) != 100 {
		t.Fatalf("frontend listing rows %d, want 100", len(front))
	}
	if front[0].ID != untouched {
		t.Fatalf("frontend listing newest %d, want activity-changed %d", front[0].ID, untouched)
	}
}
