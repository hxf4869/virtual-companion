//go:build integration

package postgres

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

func TestG10AttemptIntentOutcomeFinalizeAndRecovery(t *testing.T) {
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
		ConversationID: conv, IdempotencyKey: "idem-g10-1",
		UserContent: "fixture-user-line", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.Status != "QUEUED" || view.JobID == 0 || !view.Created {
		t.Fatalf("%+v", view)
	}
	replay, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: conv, IdempotencyKey: "idem-g10-1",
		UserContent: "fixture-user-line", Mode: "LISTEN", MaxOutstanding: 4,
	})
	if err != nil || replay.ID != view.ID || replay.Created {
		t.Fatalf("idempotent %+v %v", replay, err)
	}

	foreign, err := store.StartTurn(ctx, 2, StartTurn{
		ConversationID: conv, IdempotencyKey: "x", UserContent: "x", MaxOutstanding: 4,
	})
	if err == nil || foreign.ID != 0 {
		t.Fatalf("cross-owner start %v %+v", err, foreign)
	}

	claims, err := store.ClaimJobs(ctx, 30*time.Second, 60*time.Second, 30*time.Second, 8)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 1 || claims[0].Kind != "GENERATION" || claims[0].RefID != view.ID {
		t.Fatalf("%+v", claims)
	}
	c := claims[0]
	st, err := store.PromoteClaimedGeneration(ctx, c.OwnerID, c.RefID, c.JobID, c.Token, c.Fence)
	if err != nil || st != "IN_PROGRESS" {
		t.Fatalf("promote %s %v", st, err)
	}

	prep, err := store.PrepareAttempt(ctx, turn.PrepareAttempt{
		OwnerID: c.OwnerID, TurnID: itoa(c.RefID), JobID: c.JobID,
		ClaimToken: c.Token, ClaimFence: c.Fence,
		Budget: companion.TurnBudget{MaxInputTokens: 8000, MaxOutputTokens: 128, MaxAttempts: 2, MaxResponseBytes: 1024,
			ConnectTimeout: time.Second, FirstTokenTimeout: time.Second, TotalTimeout: 5 * time.Second},
		Categories:    []turn.DataCategory{turn.CategoryMessage},
		PromptVersion: "companion-chat-go-v1", ConsentVersion: "OK",
		ProviderID: "openai-compatible", SupplierName: "openai-compatible",
	})
	if err != nil {
		t.Fatal(err)
	}

	stale := c
	stale.Token = "stale-token"
	if err := store.RecordAttemptOutcome(ctx, companion.AttemptOutcome{
		OwnerID: stale.OwnerID, TurnID: itoa(c.RefID), AttemptID: prep.AttemptID,
		JobID: stale.JobID, ClaimToken: stale.Token, ClaimFence: stale.Fence,
		Status: companion.AttemptSucceeded, Billing: companion.BillingUsageReported,
		Usage: companion.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
	}); err == nil {
		t.Fatal("stale token must not write outcome")
	}

	if err := store.RecordAttemptOutcome(ctx, companion.AttemptOutcome{
		OwnerID: c.OwnerID, TurnID: itoa(c.RefID), AttemptID: prep.AttemptID,
		JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		Status: companion.AttemptSucceeded, Billing: companion.BillingUsageReported,
		Usage: companion.Usage{InputTokens: 2, OutputTokens: 3, TotalTokens: 5},
	}); err != nil {
		t.Fatal(err)
	}

	if err := store.FinalizeGeneration(ctx, turn.FinalizeCommand{
		OwnerID: c.OwnerID, TurnID: itoa(c.RefID), AttemptID: prep.AttemptID,
		JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		Text: "fixture-assistant-line",
	}); err != nil {
		t.Fatal(err)
	}
	snap, err := store.GenerationSnapshot(ctx, 1, view.ID)
	if err != nil || snap.Status != "COMPLETED" || snap.AssistantContent != "fixture-assistant-line" {
		t.Fatalf("snapshot %+v %v", snap, err)
	}
	if _, err := store.GenerationSnapshot(ctx, 2, view.ID); err == nil {
		t.Fatal("cross-owner snapshot")
	}
}

func TestG12PrepareAttemptRechecksCurrentOutboundGate(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	grantOutboundConsents(t, store, 1)

	claim := func(key string) JobClaim {
		view := mustStart(t, store, conv, key)
		c := mustClaimOne(t, store, view.ID)
		if _, err := store.PromoteClaimedGeneration(ctx, c.OwnerID, c.RefID, c.JobID, c.Token, c.Fence); err != nil {
			t.Fatal(err)
		}
		return c
	}
	prepare := func(c JobClaim) error {
		_, err := store.PrepareAttempt(ctx, turn.PrepareAttempt{
			OwnerID: c.OwnerID, TurnID: itoa(c.RefID), JobID: c.JobID,
			ClaimToken: c.Token, ClaimFence: c.Fence,
			Budget: companion.TurnBudget{MaxAttempts: 1, MaxInputTokens: 8, MaxOutputTokens: 4,
				MaxResponseBytes: 64, ConnectTimeout: time.Second,
				FirstTokenTimeout: time.Second, TotalTimeout: time.Second},
			Categories: []turn.DataCategory{turn.CategoryMessage},
			ProviderID: "openai-compatible", SupplierName: "openai-compatible",
		})
		return err
	}

	consentClaim := claim("gate-consent")
	if _, err := store.RecordConsent(ctx, 1, "THIRD_PARTY_MODEL_PROCESSING", "2026-08", false); err != nil {
		t.Fatal(err)
	}
	if err := prepare(consentClaim); !errors.Is(err, turn.ErrOutboundDenied) {
		t.Fatalf("withdrawn consent error %v", err)
	}
	grantOutboundConsents(t, store, 1)

	providerClaim := claim("gate-provider")
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.provider_deployment SET admission_state = 'DISABLED'
		  WHERE provider_id = 'openai-compatible'`); err != nil {
		t.Fatal(err)
	}
	if err := prepare(providerClaim); !errors.Is(err, turn.ErrOutboundDenied) {
		t.Fatalf("disabled provider error %v", err)
	}

	count, err := psqlSuper(`SELECT count(*) FROM vc.attempt_intent`)
	if err != nil {
		t.Fatal(err)
	}
	if count != "0" {
		t.Fatalf("denied prepare created %s attempt rows", count)
	}
	privileges, err := psqlSuper(`
SELECT has_function_privilege(
           'vc_runtime_login',
           'vc.go_create_model_attempt(bigint,bigint,bigint,text,text,text,text,text,text[],text,text,text,text,text,bigint,bigint)',
           'EXECUTE')::text
       || ',' ||
       has_function_privilege(
           'vc_runtime_login',
           'vc.go_prepare_model_attempt(bigint,bigint,bigint,text,text,text,text,text,text[],text,text,text,text,text,bigint,bigint)',
           'EXECUTE')::text`)
	if err != nil {
		t.Fatal(err)
	}
	if privileges != "false,true" {
		t.Fatalf("attempt function privileges %s", privileges)
	}
}

func TestG10CrashRecoveryMatrix(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	grantOutboundConsents(t, store, 1)

	t.Run("no-intent-requeues", func(t *testing.T) {
		view := mustStart(t, store, conv, "rec-a")
		c := mustClaimOne(t, store, view.ID)
		expireClaim(t, c)
		action, err := store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if err != nil || action != "REQUEUE_NO_INTENT" {
			t.Fatalf("%s %v", action, err)
		}
		action2, err := store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if err != nil {
			t.Fatal(err)
		}
		if action2 != "REQUEUE_NO_INTENT" && action2 != "IDEMPOTENT_TERMINAL" {
			got, gerr := store.GetGeneration(ctx, 1, view.ID)
			if gerr != nil {
				t.Fatal(gerr)
			}
			if got.Status == "FAILED_FINAL" {
				t.Fatalf("requeue must not fail generation, recover=%s status=%s", action2, got.Status)
			}
		}
	})

	t.Run("created-intent-outcome-unknown", func(t *testing.T) {
		view := mustStart(t, store, conv, "rec-b")
		c := mustClaimOne(t, store, view.ID)
		_, err := store.PromoteClaimedGeneration(ctx, c.OwnerID, c.RefID, c.JobID, c.Token, c.Fence)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := store.PrepareAttempt(ctx, turn.PrepareAttempt{
			OwnerID: c.OwnerID, TurnID: itoa(c.RefID), JobID: c.JobID,
			ClaimToken: c.Token, ClaimFence: c.Fence,
			Budget: companion.TurnBudget{MaxAttempts: 2, MaxInputTokens: 8, MaxOutputTokens: 4, MaxResponseBytes: 64,
				ConnectTimeout: time.Second, FirstTokenTimeout: time.Second, TotalTimeout: time.Second},
			ProviderID: "openai-compatible", SupplierName: "openai-compatible",
		}); err != nil {
			t.Fatal(err)
		}
		expireClaim(t, c)
		action, err := store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if err != nil || action != "OUTCOME_UNKNOWN" {
			t.Fatalf("%s %v", action, err)
		}
		got, err := store.GetGeneration(ctx, 1, view.ID)
		if err != nil || got.Status != "FAILED_FINAL" {
			t.Fatalf("%+v %v", got, err)
		}
		action2, err := store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if err != nil || action2 != "IDEMPOTENT_TERMINAL" {
			t.Fatalf("repeat %s %v", action2, err)
		}
	})

	t.Run("succeeded-unfinalized-candidate-lost", func(t *testing.T) {
		view := mustStart(t, store, conv, "rec-c")
		c := mustClaimOne(t, store, view.ID)
		if _, err := store.PromoteClaimedGeneration(ctx, c.OwnerID, c.RefID, c.JobID, c.Token, c.Fence); err != nil {
			t.Fatal(err)
		}
		prep, err := store.PrepareAttempt(ctx, turn.PrepareAttempt{
			OwnerID: c.OwnerID, TurnID: itoa(c.RefID), JobID: c.JobID,
			ClaimToken: c.Token, ClaimFence: c.Fence,
			Budget: companion.TurnBudget{MaxAttempts: 2, MaxInputTokens: 8, MaxOutputTokens: 4, MaxResponseBytes: 64,
				ConnectTimeout: time.Second, FirstTokenTimeout: time.Second, TotalTimeout: time.Second},
			ProviderID: "openai-compatible", SupplierName: "openai-compatible",
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := store.RecordAttemptOutcome(ctx, companion.AttemptOutcome{
			OwnerID: c.OwnerID, TurnID: itoa(c.RefID), AttemptID: prep.AttemptID,
			JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
			Status: companion.AttemptSucceeded, Billing: companion.BillingUsageReported,
			Usage: companion.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
		}); err != nil {
			t.Fatal(err)
		}
		expireClaim(t, c)
		action, err := store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if err != nil || action != "CANDIDATE_LOST_AFTER_ATTEMPT" {
			t.Fatalf("%s %v", action, err)
		}
		snap, err := store.GenerationSnapshot(ctx, 1, view.ID)
		if err != nil || snap.Status != "FAILED_FINAL" || snap.AssistantContent != "" {
			t.Fatalf("%+v %v", snap, err)
		}
	})
}

func TestG10CancelBeforeClaim(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	rel, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, rel.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.StartTurn(ctx, 1, StartTurn{
		ConversationID: conv, IdempotencyKey: "cancel-1", UserContent: "fixture-user-line", MaxOutstanding: 4,
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err := store.CancelTurn(ctx, 1, view.ID)
	if err != nil || got.Status != "CANCELLED" {
		t.Fatalf("%+v %v", got, err)
	}
	claims, err := store.ClaimJobs(ctx, 30*time.Second, 60*time.Second, 30*time.Second, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range claims {
		if c.RefID == view.ID {
			t.Fatal("cancelled job claimed")
		}
	}
}

func isoRestKeyForStore() string {
	return "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="
}

func grantOutboundConsents(t *testing.T, store *Store, owner int64) {
	t.Helper()
	for _, typ := range []string{
		"SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE",
		"THIRD_PARTY_MODEL_PROCESSING", "SENSITIVE_DATA_PROCESSING",
	} {
		if _, err := store.RecordConsent(context.Background(), owner, typ, "2026-08", true); err != nil {
			t.Fatal(err)
		}
	}
}

func mustStart(t *testing.T, store *Store, conv int64, key string) GenerationView {
	t.Helper()
	view, err := store.StartTurn(context.Background(), 1, StartTurn{
		ConversationID: conv, IdempotencyKey: key, UserContent: "fixture-user-line", MaxOutstanding: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func mustClaimOne(t *testing.T, store *Store, genID int64) JobClaim {
	t.Helper()
	claims, err := store.ClaimJobs(context.Background(), 30*time.Second, 60*time.Second, 30*time.Second, 16)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range claims {
		if c.RefID == genID {
			return c
		}
	}
	t.Fatalf("no claim for generation")
	return JobClaim{}
}

func expireClaim(t *testing.T, c JobClaim) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(),
		`UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 second'
		  WHERE owner_user_id = $1 AND id = $2`, c.OwnerID, c.JobID); err != nil {
		t.Fatal(err)
	}
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
