//go:build integration

package postgres

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/hxf4869/virtual-companion/internal/turn"
)

func auditConversation(t *testing.T, incognito bool) int64 {
	t.Helper()
	resetFixtures(t)
	installSyntheticCipher(t)
	id, err := testEnv.store.CreateConversation(context.Background(), 1, 10, incognito)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// Two recovery loops can retain the same expired listing across a requeue
// and a fresh claim. The stale listing must not revoke the replacement lease.
func TestAuditLifecycleRecoveryKeepsReplacementClaim(t *testing.T) {
	conv := auditConversation(t, false)
	ctx, store := context.Background(), testEnv.store
	view := mustStart(t, store, conv, "audit-recovery")
	old := mustClaimOne(t, store, view.ID)
	expireClaim(t, old)
	stale, err := store.ListExpiredGenerationJobs(ctx, 8)
	if err != nil || len(stale) != 1 {
		t.Fatalf("expired listing count=%d err=%v", len(stale), err)
	}
	if action, err := store.RecoverExpiredGeneration(ctx, 1, view.JobID); err != nil || action != "REQUEUE_NO_INTENT" {
		t.Fatalf("first recovery action=%s err=%v", action, err)
	}
	fresh := mustClaimOne(t, store, view.ID)
	if action, err := store.RecoverExpiredGeneration(ctx, stale[0].OwnerID, stale[0].JobID); err != nil || action != "LEASE_ACTIVE" {
		t.Fatalf("stale recovery action=%s err=%v", action, err)
	}
	if status, err := store.PromoteClaimedGeneration(ctx, 1, view.ID, fresh.JobID, fresh.Token, fresh.Fence); err != nil || status != "IN_PROGRESS" {
		t.Fatalf("replacement claim lost: status=%s err=%v", status, err)
	}
}

func TestAuditLifecycleEnrollmentCannotReplaceActiveFactor(t *testing.T) {
	resetFixtures(t)
	installSyntheticCipher(t)
	ctx, store := context.Background(), testEnv.store
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.identity_account
		(id, username, password_hash, role, status, display_name)
		VALUES (1, 'alice', 'synthetic-password', 'USER', 'ACTIVE', 'alice')`); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	challenges := make([]AuthChallenge, 2)
	keys := make([]string, 2)
	for i := range challenges {
		var err error
		challenges[i], err = store.CreateAuthChallenge(ctx, 1, AuthChallengeTOTPEnroll, now.Add(5*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		setup, err := store.AuthenticatorSetup(ctx, challenges[i].ID, now)
		if err != nil {
			t.Fatal(err)
		}
		keys[i] = setup.ManualKey
	}
	complete := func(i int) (AuthenticatedSession, bool, error) {
		code, err := totp.GenerateCode(keys[i], now)
		if err != nil {
			t.Fatal(err)
		}
		return store.CompleteAuthChallenge(ctx, AuthCompleteInput{
			ChallengeID: challenges[i].ID, Mode: AuthChallengeTOTPEnroll,
			Method: AuthMethodTOTP, Code: code, Now: now,
			SessionExpiresAt: now.Add(time.Hour),
		})
	}
	first, ok, err := complete(0)
	if err != nil || !ok {
		t.Fatalf("first enrollment ok=%v err=%v", ok, err)
	}
	if _, ok, err := complete(1); ok || !errors.Is(err, ErrAuthChallengeUnavailable) {
		t.Fatalf("old enrollment challenge ok=%v err=%v", ok, err)
	}
	var cipher string
	if err := superPool(t, ctx).QueryRow(ctx, `SELECT totp_secret_ciphertext
		FROM vc.identity_account WHERE id=1`).Scan(&cipher); err != nil {
		t.Fatal(err)
	}
	secret, err := store.cipher.Decrypt(cipher)
	if err != nil || secret != keys[0] {
		t.Fatal("old enrollment replaced the active factor")
	}
	// The first enrollment's recovery codes must also remain usable.
	challenge, err := store.CreateAuthChallenge(ctx, 1, AuthChallengeTOTPVerify, now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.CompleteAuthChallenge(ctx, AuthCompleteInput{
		ChallengeID: challenge.ID, Mode: AuthChallengeTOTPVerify,
		Method: AuthMethodRecoveryCode, Code: first.RecoveryCodes[0], Now: now,
		SessionExpiresAt: now.Add(time.Hour),
	}); err != nil || !ok {
		t.Fatalf("first recovery code ok=%v err=%v", ok, err)
	}
}

func TestAuditLifecyclePasswordChangeRevokesPendingChallenge(t *testing.T) {
	resetFixtures(t)
	armTOTPAccount(t, 1, "alice")
	ctx, store := context.Background(), testEnv.store
	now := time.Now().UTC()
	old, err := store.CreateAuthChallenge(ctx, 1, AuthChallengeTOTPVerify, now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if err := store.ChangePasswordHash(ctx, 1, "changed-synthetic-password"); err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(totpFixtureSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := store.CompleteAuthChallenge(ctx, AuthCompleteInput{
		ChallengeID: old.ID, Mode: AuthChallengeTOTPVerify,
		Method: AuthMethodTOTP, Code: code, Now: now,
		SessionExpiresAt: now.Add(time.Hour),
	}); ok || !errors.Is(err, ErrAuthChallengeUnavailable) {
		t.Fatalf("pre-change challenge ok=%v err=%v", ok, err)
	}
	if n := accountSessionCount(t, 1); n != 0 {
		t.Fatalf("old challenge created %d sessions", n)
	}
	if _, ok, err := completeTOTPVerify(t, store, 1, code, now); err != nil || !ok {
		t.Fatalf("fresh post-change challenge ok=%v err=%v", ok, err)
	}
}

func TestAuditLifecycleDeleteConversationPreservesExport(t *testing.T) {
	conv := auditConversation(t, false)
	ctx, store := context.Background(), testEnv.store
	view := mustStart(t, store, conv, "audit-delete-export")
	// The two independent sequences can naturally produce the same ref_id.
	if err := IsolationSuperExec(ctx, `SELECT setval('vc.export_request_id_seq', $1, false)`, view.ID); err != nil {
		t.Fatal(err)
	}
	exp, err := store.CreateExport(ctx, 1, "audit-synthetic-download-token")
	if err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteConversation(ctx, 1, conv); err != nil {
		t.Fatal(err)
	}
	claims, err := store.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 8, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 1 || claims[0].Kind != "DATA_EXPORT" || claims[0].RefID != exp.ID {
		t.Fatalf("unrelated export is no longer claimable: count=%d", len(claims))
	}
}

func TestAuditLifecycleEndConversationReleasesCapacity(t *testing.T) {
	for _, active := range []bool{false, true} {
		name := "queued"
		if active {
			name = "claimed-incognito"
		}
		t.Run(name, func(t *testing.T) {
			conv := auditConversation(t, active)
			ctx, store := context.Background(), testEnv.store
			view := mustStart(t, store, conv, "audit-end")
			if active {
				claim := mustClaimOne(t, store, view.ID)
				if _, err := store.PromoteClaimedGeneration(ctx, 1, view.ID, claim.JobID, claim.Token, claim.Fence); err != nil {
					t.Fatal(err)
				}
			}
			end, err := store.EndConversation(ctx, 1, conv)
			if err != nil || !end.OK || end.IncognitoCleared != active {
				t.Fatalf("end=%+v err=%v", end, err)
			}
			snap, err := store.GenerationSnapshot(ctx, 1, view.ID)
			if err != nil || snap.Status != "CANCELLED" {
				t.Fatalf("generation status=%s err=%v", snap.Status, err)
			}
			var status string
			if err := superPool(t, ctx).QueryRow(ctx, `SELECT status FROM vc.work_item
				WHERE owner_user_id=1 AND id=$1`, view.JobID).Scan(&status); err != nil || status != "CANCELLED" {
				t.Fatalf("job status=%s err=%v", status, err)
			}
			if _, err := store.StartTurn(ctx, 1, StartTurn{
				ConversationID: conv, IdempotencyKey: "after-end", UserContent: "fixture",
				MaxOutstanding: 1,
			}); err != nil {
				t.Fatalf("ended generation still consumes capacity: %v", err)
			}
		})
	}
}

// Finalization needs a succeeded, settled attempt. Seed that external-call
// fact without calling a provider, then use the actual store finalizer.
func auditFinalize(t *testing.T, view GenerationView, content string) {
	t.Helper()
	ctx, store := context.Background(), testEnv.store
	claim := mustClaimOne(t, store, view.ID)
	var attemptID int64
	if err := superPool(t, ctx).QueryRow(ctx, `INSERT INTO vc.attempt_intent
		(owner_user_id,id,work_item_id,generation_id,provider_attempt_id,
		 provider_id,supplier_name,status,claim_token_hash,claim_fence_hash,
		 attempt_no,attempt_started_at,terminal_at,billing_disposition)
		VALUES (1,nextval('vc.attempt_intent_id_seq'),$1,$2,gen_random_uuid()::text,
		 'openai-compatible','openai-compatible','SUCCEEDED',repeat('0',64),repeat('1',64),
		 1,clock_timestamp(),clock_timestamp(),'USAGE_REPORTED') RETURNING id`,
		view.JobID, view.ID).Scan(&attemptID); err != nil {
		t.Fatal(err)
	}
	if err := store.FinalizeGeneration(ctx, turn.FinalizeCommand{
		OwnerID: 1, TurnID: itoa(view.ID), AttemptID: itoa(attemptID), JobID: claim.JobID,
		ClaimToken: claim.Token, ClaimFence: claim.Fence, Text: content,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestAuditLifecycleRegenerationLinksAssistantAndBackfillsLegacy(t *testing.T) {
	conv := auditConversation(t, false)
	ctx, store := context.Background(), testEnv.store
	first := mustStart(t, store, conv, "audit-version-1")
	auditFinalize(t, first, "old answer")
	snap, err := store.GenerationSnapshot(ctx, 1, first.ID)
	if err != nil || snap.SourceMessageID == nil {
		t.Fatalf("source message missing: %v", err)
	}
	second, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: conv, IdempotencyKey: "audit-version-2",
		SourceMessageID: snap.SourceMessageID, MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	auditFinalize(t, second, "selected answer")
	checkHistory := func() {
		t.Helper()
		visible, err := store.ListRecentMessages(ctx, 1, conv, nil, 50)
		if err != nil {
			t.Fatal(err)
		}
		model, err := store.ListRecentModelMessages(ctx, 1, conv, nil, 50)
		if err != nil {
			t.Fatal(err)
		}
		for name, rows := range map[string][]Message{"history": visible, "model": model} {
			contents := messageContents(rows)
			if len(rows) != 2 || contents["old answer"] || !contents["selected answer"] {
				t.Fatalf("%s retained an unselected answer (rows=%d)", name, len(rows))
			}
		}
	}
	checkHistory()
	// Replay the actual upgrade over the persisted legacy shape, rather than
	// testing a hand-copied backfill query. No user data or other tests run here.
	root, err := findRepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join(root, "backend/internal/migrate/sql/V136__audit_auth_and_generation_lifecycle.sql"))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := superPool(t, ctx).Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE vc.message SET generation_id=NULL
		WHERE owner_user_id=1 AND conversation_id=$1 AND role='assistant'`, conv); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("legacy assistant backfill: %v", err)
	}
	var linked int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.message m JOIN vc.generation g
		ON g.owner_user_id=m.owner_user_id AND g.id=m.generation_id
		WHERE m.owner_user_id=1 AND m.conversation_id=$1 AND m.id=g.assistant_message_id`, conv).Scan(&linked); err != nil || linked != 2 {
		t.Fatalf("legacy linked responses=%d err=%v", linked, err)
	}
	// Rollback also restores any definitions replaced by later migrations.
}

func TestAuditLifecycleSQLGuards(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "infra/db/tests/173_audit_auth_generation_lifecycle.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := psqlSuper(string(raw)); err != nil {
		t.Fatal(err)
	}
}
