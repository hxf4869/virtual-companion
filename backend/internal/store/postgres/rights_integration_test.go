//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

func TestG8MemoryLifecycleAndDeletionFence(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	alice, err := testEnv.store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	created, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: alice.ID,
		Scope:          "RELATIONSHIP",
		Summary:        "fixture-fact",
		IdempotencyKey: "idem-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	replay, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: alice.ID,
		Scope:          "RELATIONSHIP",
		Summary:        "other",
		IdempotencyKey: "idem-1",
	})
	if err != nil || replay.ID != created.ID {
		t.Fatalf("idempotent %d %v", replay.ID, err)
	}
	_, err = testEnv.store.CreateMemoryCandidate(ctx, 2, MemoryCreate{
		RelationshipID: alice.ID,
		Scope:          "RELATIONSHIP",
		Summary:        "cross",
	})
	if err != ErrNotFound {
		t.Fatalf("cross-owner create %v", err)
	}
	confirmed, err := testEnv.store.ConfirmMemory(ctx, 1, created.ID, nil)
	if err != nil || confirmed.Status != "ACCEPTED" {
		t.Fatalf("confirm %+v %v", confirmed, err)
	}
	listed, err := testEnv.store.ListMemories(ctx, 2, alice.ID, false)
	if err != nil || len(listed) != 0 {
		t.Fatalf("cross-owner list %d %v", len(listed), err)
	}

	hash, err := auth.Hash("test-pass-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice', $1, 'USER', 'ACTIVE', 'alice')
ON CONFLICT (id) DO NOTHING`, hash); err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	_, err = testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{
		RelationshipID: alice.ID,
		Scope:          "RELATIONSHIP",
		Summary:        "late",
	})
	if err != ErrNotFound {
		t.Fatalf("late writer %v", err)
	}
	gate, err := testEnv.store.OutboundCheck(ctx, 1)
	if err != nil || gate.Allow {
		t.Fatalf("outbound %+v %v", gate, err)
	}
}

func TestG8ConsentOutboundCheckpoint(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	hash, err := auth.Hash("test-pass-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice', $1, 'USER', 'ACTIVE', 'alice')
ON CONFLICT (id) DO NOTHING`, hash); err != nil {
		t.Fatal(err)
	}
	gate, err := testEnv.store.OutboundCheck(ctx, 1)
	if err != nil || gate.Allow {
		t.Fatalf("empty consents %+v %v", gate, err)
	}
	for _, typ := range requiredConsents {
		if _, err := testEnv.store.RecordConsent(ctx, 1, typ, "2026-08", true); err != nil {
			t.Fatal(err)
		}
	}
	gate, err = testEnv.store.OutboundCheck(ctx, 1)
	if err != nil || !gate.Allow {
		t.Fatalf("granted %+v %v", gate, err)
	}
	if _, err := testEnv.store.RecordConsent(ctx, 1, "THIRD_PARTY_MODEL_PROCESSING", "2026-08", false); err != nil {
		t.Fatal(err)
	}
	gate, err = testEnv.store.OutboundCheck(ctx, 1)
	if err != nil || gate.Allow || len(gate.Categories) != 0 {
		t.Fatalf("withdrawn %+v %v", gate, err)
	}
}

func TestG8ExportConsumeOnce(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	exp, err := testEnv.store.CreateExport(ctx, 1, "tok-fixture-1")
	if err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.CompleteExport(ctx, 1, exp.ID, `{"conversations":[]}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	dl, err := testEnv.store.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-1")
	if err != nil || dl.Payload == "" {
		t.Fatalf("consume %v %+v", err, dl)
	}
	_, err = testEnv.store.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-1")
	if err != ErrNotFound {
		t.Fatalf("second consume %v", err)
	}
}
