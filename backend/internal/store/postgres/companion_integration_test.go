//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestCompanionCreateListActivateCrossOwner(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	alice, err := testEnv.store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	if !alice.Active {
		t.Fatal("created companion must be active")
	}
	second, err := testEnv.store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	list, err := testEnv.store.ListRelationships(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	active := 0
	for _, rel := range list {
		if rel.Active {
			active++
			if rel.ID != second.ID {
				t.Fatalf("unique active want %d", second.ID)
			}
		}
	}
	if active != 1 {
		t.Fatalf("active %d", active)
	}
	_, err = testEnv.store.ActivateRelationship(ctx, 2, second.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner activate %v", err)
	}
	_, err = testEnv.store.CreateConversation(ctx, 2, second.ID, false)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner conversation %v", err)
	}
	convID, err := testEnv.store.CreateConversation(ctx, 1, second.ID, false)
	if err != nil || convID <= 0 {
		t.Fatalf("create conversation %d %v", convID, err)
	}
	convs, err := testEnv.store.ListConversations(ctx, 2, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(convs) != 0 {
		t.Fatalf("bob saw alice conversations %d", len(convs))
	}
	msgs, err := testEnv.store.ListMessages(ctx, 2, convID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 0 {
		t.Fatal("message list leaked")
	}
	if err := testEnv.store.DeleteConversation(ctx, 2, convID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner delete %v", err)
	}
	var n int
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.conversation`).Scan(&n)
	}); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("alice conversations %d", n)
	}
	if testEnv.store.Stats().Acquired != 0 {
		t.Fatalf("held connections %d", testEnv.store.Stats().Acquired)
	}
}

func TestEnsureDefaultRelationshipReusesExisting(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()

	first, err := testEnv.store.EnsureDefaultRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	second, err := testEnv.store.EnsureDefaultRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || !second.Active {
		t.Fatalf("default relationship changed: first=%d second=%d active=%t", first.ID, second.ID, second.Active)
	}

	list, err := testEnv.store.ListRelationships(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].PersonaRef != "gentle-listener" {
		t.Fatalf("default relationship list = %+v", list)
	}
}
