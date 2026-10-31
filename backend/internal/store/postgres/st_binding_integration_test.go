//go:build integration

package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestResolveSTBindingConcurrentIdempotency(t *testing.T) {
	resetFixtures(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	input := STBindingInput{ChatIdentity: "chat-idempotent", CharacterRef: "card-one", Mode: "COMPANION", DisplayName: "澄夏"}
	const callers = 8
	results := make([]STBinding, callers)
	errs := make([]error, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = testEnv.store.ResolveSTBinding(ctx, 1, input)
		}(i)
	}
	close(start)
	wg.Wait()
	for i, result := range results {
		if errs[i] != nil {
			t.Fatalf("resolve %d: %v", i, errs[i])
		}
		if result != results[0] || result.RelationshipID <= 0 || result.ConversationID <= 0 {
			t.Fatalf("resolve %d changed identity: %+v != %+v", i, result, results[0])
		}
	}
	var relationships, conversations int
	err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM vc.relationship WHERE st_character_ref = 'card-one'),
			(SELECT count(*) FROM vc.conversation WHERE st_chat_identity = 'chat-idempotent')`,
		).Scan(&relationships, &conversations)
	})
	if err != nil || relationships != 1 || conversations != 1 {
		t.Fatalf("duplicate/orphan rows: relationships=%d conversations=%d err=%v", relationships, conversations, err)
	}
	// Retries do not silently rename an already established instance.
	input.DisplayName = "重试时的另一名称"
	if got, err := testEnv.store.ResolveSTBinding(ctx, 1, input); err != nil || got != results[0] {
		t.Fatalf("repeat resolve = %+v, %v", got, err)
	}
}

func TestSTBindingSeparateInstancesAndExplicitBranch(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	input := STBindingInput{ChatIdentity: "chat-a", CharacterRef: "same-card", Mode: "COMPANION", DisplayName: "澄夏"}
	first, err := testEnv.store.ResolveSTBinding(ctx, 1, input)
	if err != nil {
		t.Fatal(err)
	}
	input.ChatIdentity = "chat-b"
	second, err := testEnv.store.ResolveSTBinding(ctx, 1, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.RelationshipID == second.RelationshipID || first.ConversationID == second.ConversationID {
		t.Fatal("same card must not deduplicate independent instances")
	}
	input.ChatIdentity = "branch-of-a"
	input.RelationshipID = &first.RelationshipID
	branch, err := testEnv.store.ResolveSTBinding(ctx, 1, input)
	if err != nil || branch.RelationshipID != first.RelationshipID || branch.ConversationID == first.ConversationID {
		t.Fatalf("explicit branch = %+v, %v", branch, err)
	}
	input.ChatIdentity, input.RelationshipID, input.Mode = "story-chat", nil, "STORY"
	story, err := testEnv.store.ResolveSTBinding(ctx, 1, input)
	if err != nil || story.Mode != "STORY" || story.RelationshipID == first.RelationshipID {
		t.Fatalf("story binding = %+v, %v", story, err)
	}
	list, err := testEnv.store.ListRelationships(ctx, 1)
	if err != nil || len(list) != 4 { // the existing fixture + three explicit instances
		t.Fatalf("instances = %+v, %v", list, err)
	}
	for _, rel := range list {
		if !rel.Active {
			t.Fatalf("creating another instance disabled relationship %d", rel.ID)
		}
		if rel.PersonaRef == "st-character" && (rel.CharacterRef == nil || *rel.CharacterRef != input.CharacterRef) {
			t.Fatalf("instance %d lost its persisted card association", rel.ID)
		}
	}
	if _, err := testEnv.store.DeactivateRelationship(ctx, 1, first.RelationshipID); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.ActivateRelationship(ctx, 1, first.RelationshipID); err != nil {
		t.Fatal(err)
	}
	list, err = testEnv.store.ListRelationships(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, rel := range list {
		if !rel.Active {
			t.Fatalf("reactivation disabled another relationship %d", rel.ID)
		}
	}
}

func TestSTBindingRejectsConflictsAndCrossOwnerReuse(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	input := STBindingInput{ChatIdentity: "shared-spelling", CharacterRef: "card-one", Mode: "COMPANION"}
	first, err := testEnv.store.ResolveSTBinding(ctx, 1, input)
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := testEnv.store.ResolveSTBinding(ctx, 2, input)
	if err != nil || foreign.RelationshipID == first.RelationshipID {
		t.Fatalf("owner-scoped identity = %+v, %v", foreign, err)
	}
	for _, conflict := range []STBindingInput{
		{ChatIdentity: input.ChatIdentity, CharacterRef: "other-card", Mode: input.Mode},
		{ChatIdentity: input.ChatIdentity, CharacterRef: input.CharacterRef, Mode: "STORY"},
		{ChatIdentity: input.ChatIdentity, CharacterRef: input.CharacterRef, Mode: input.Mode, RelationshipID: &foreign.RelationshipID},
		{ChatIdentity: "new-chat", CharacterRef: "other-card", Mode: input.Mode, RelationshipID: &first.RelationshipID},
	} {
		if _, err := testEnv.store.ResolveSTBinding(ctx, 1, conflict); !errors.Is(err, ErrConflict) {
			t.Fatalf("binding mismatch must conflict: %v", err)
		}
	}
	input.ChatIdentity, input.RelationshipID = "new-foreign-chat", &first.RelationshipID
	if _, err := testEnv.store.ResolveSTBinding(ctx, 2, input); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner instance reuse must be not found: %v", err)
	}
	input.RelationshipID, input.Mode = nil, "UNKNOWN"
	if _, err := testEnv.store.ResolveSTBinding(ctx, 1, input); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid mode: %v", err)
	}
	var n int
	err = testEnv.store.WithOwner(ctx, 2, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.conversation WHERE id = $1`, first.ConversationID).Scan(&n)
	})
	if err != nil || n != 0 {
		t.Fatalf("foreign binding visible: count=%d err=%v", n, err)
	}
}
