//go:build integration

package postgres

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

func costClaim(t *testing.T, owner, rel int64, key string) JobClaim {
	t.Helper()
	store := testEnv.store
	grantOutboundConsents(t, store, owner)
	conv, err := store.CreateConversation(context.Background(), owner, rel, false)
	if err != nil {
		t.Fatal(err)
	}
	view, err := store.StartTurn(context.Background(), owner, StartTurn{ConversationID: conv, IdempotencyKey: key, UserContent: "synthetic", MaxOutstanding: 8})
	if err != nil {
		t.Fatal(err)
	}
	return mustClaimOne(t, store, view.ID)
}

func prepareCost(c JobClaim, model string) (turn.PreparedAttempt, error) {
	return testEnv.store.PrepareAttempt(context.Background(), turn.PrepareAttempt{
		OwnerID: c.OwnerID, TurnID: itoa(c.RefID), JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		ProviderID: "openai-compatible", SupplierName: "synthetic", ModelID: model,
		Categories: []turn.DataCategory{turn.CategoryMessage},
		Budget:     companion.TurnBudget{MaxReservedCost: 1_000_000, MaxInputTokens: 8000, MaxOutputTokens: 512, MaxAttempts: 1},
	})
}

func costAssertSQL(t *testing.T, sql, want string) {
	t.Helper()
	got, err := psqlSuper(sql)
	if err != nil || got != want {
		t.Fatalf("cost state got=%q want=%q err=%v", got, want, err)
	}
}

func TestCostAdmissionFailsClosedBeforeAttemptReturns(t *testing.T) {
	resetFixtures(t)
	c := costClaim(t, 1, 10, "cost-denial")
	testEnv.store.UseCostLimits(0, 1000000)
	if _, err := prepareCost(c, "synthetic-go-model"); err == nil {
		t.Fatal("unset ceiling allowed model call")
	}
	testEnv.store.UseCostLimits(1000000, 0)
	if _, err := prepareCost(c, "synthetic-go-model"); err == nil {
		t.Fatal("unset monthly cap allowed model call")
	}
	testEnv.store.UseCostLimits(1000000, 1000000)
	if _, err := prepareCost(c, "unpriced-model"); err == nil {
		t.Fatal("unknown price allowed model call")
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.attempt_intent", "0")
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation", "0")
	if _, err := prepareCost(c, "synthetic-go-model"); err != nil {
		t.Fatal(err)
	}
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "1000000")
}

func TestCostGlobalMonthlyCapSerializesConcurrentOwners(t *testing.T) {
	resetFixtures(t)
	first := costClaim(t, 1, 10, "cost-owner-1")
	second := costClaim(t, 2, 20, "cost-owner-2")
	testEnv.store.UseCostLimits(1000000, 1000000)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, claim := range []JobClaim{first, second} {
		wg.Add(1)
		go func(c JobClaim) { defer wg.Done(); _, err := prepareCost(c, "synthetic-go-model"); results <- err }(claim)
	}
	wg.Wait()
	close(results)
	allowed := 0
	for err := range results {
		if err == nil {
			allowed++
		}
	}
	if allowed != 1 {
		t.Fatalf("allowed %d calls with only one reservation of budget", allowed)
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.attempt_intent", "1")
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "1000000")
}

func TestCostOutcomeUsesFrozenPriceAndOriginalMonth(t *testing.T) {
	resetFixtures(t)
	c := costClaim(t, 1, 10, "cost-settle")
	p, err := prepareCost(c, "synthetic-go-model")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(context.Background(), `
UPDATE vc.model_unit_price SET input_usd_per_1k=100,output_usd_per_1k=100;
UPDATE vc.model_cost_reservation SET month_start=DATE '2025-12-01';
UPDATE vc.month_cost_budget SET month_start=DATE '2025-12-01';`); err != nil {
		t.Fatal(err)
	}
	err = testEnv.store.RecordAttemptOutcome(context.Background(), companion.AttemptOutcome{
		OwnerID: c.OwnerID, JobID: c.JobID, AttemptID: p.AttemptID, TurnID: itoa(c.RefID), ClaimToken: c.Token, ClaimFence: c.Fence,
		Status: companion.AttemptSucceeded, Billing: companion.BillingUsageReported,
		Usage: companion.Usage{InputTokens: 1000, OutputTokens: 1000, TotalTokens: 2000},
	})
	if err != nil {
		t.Fatal(err)
	}
	costAssertSQL(t, "SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint FROM vc.month_cost_budget WHERE month_start=DATE '2025-12-01'", "3000:0")
	costAssertSQL(t, "SELECT actual_cost FROM vc.attempt_intent WHERE id="+p.AttemptID, "3000")
}

func TestCostUnknownRecoveryAndUnsentOutcome(t *testing.T) {
	for _, disposition := range []string{"UNKNOWN", "NOT_SENT"} {
		t.Run(disposition, func(t *testing.T) {
			resetFixtures(t)
			c := costClaim(t, 1, 10, "cost-terminal-"+disposition)
			p, err := prepareCost(c, "synthetic-go-model")
			if err != nil {
				t.Fatal(err)
			}
			want := "0:0"
			if disposition == "UNKNOWN" {
				expireClaim(t, c)
				if _, err := testEnv.store.RecoverExpiredGeneration(context.Background(), c.OwnerID, c.JobID); err != nil {
					t.Fatal(err)
				}
				want = "1000000:0"
			} else {
				err := testEnv.store.RecordAttemptOutcome(context.Background(), companion.AttemptOutcome{OwnerID: c.OwnerID, JobID: c.JobID, AttemptID: p.AttemptID, ClaimToken: c.Token, ClaimFence: c.Fence, Status: companion.AttemptFailed, Billing: companion.BillingNotSent})
				if err != nil {
					t.Fatal(err)
				}
			}
			costAssertSQL(t, "SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint FROM vc.month_cost_budget", want)
		})
	}
}

func TestCostExtractionUsesSameCapAndClosesOnJobCancel(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	c := costClaim(t, 1, 10, "cost-chat-hold")
	if _, err := prepareCost(c, "synthetic-go-model"); err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	gen, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	job, err := store.EnqueueMemoryExtract(ctx, 1, gen)
	if err != nil {
		t.Fatal(err)
	}
	claims, err := store.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 8, 8)
	if err != nil {
		t.Fatal(err)
	}
	var extract JobClaim
	for _, claim := range claims {
		if claim.Kind == "MEMORY_EXTRACT" && claim.JobID == job {
			extract = claim
		}
	}
	if extract.JobID == 0 {
		t.Fatal("missing extract claim")
	}
	store.UseCostLimits(1000000, 1000000)
	if _, err := store.PrepareMemoryExtractAttempt(ctx, 1, job, gen, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128); err == nil {
		t.Fatal("extraction bypassed the chat reservation")
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.memory_extract_attempt", "0")
	// 512 output tokens alone cost 1,024 micro-USD. Including this request's
	// 128 input tokens costs 1,152, so a 1,100 ceiling must refuse it.
	store.UseCostLimits(1100, 2000000)
	if _, err := store.PrepareMemoryExtractAttempt(ctx, 1, job, gen, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128); err == nil {
		t.Fatal("extraction input tokens were omitted from the ceiling check")
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.memory_extract_attempt", "0")
	store.UseCostLimits(1000000, 2000000)
	prep, err := store.PrepareMemoryExtractAttempt(ctx, 1, job, gen, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteJob(ctx, 1, job, extract.Token, extract.Fence, "CANCELLED", "synthetic"); err != nil {
		t.Fatal(err)
	}
	costAssertSQL(t, fmt.Sprintf("SELECT status || ':' || round(actual_usd*1000000)::bigint FROM vc.model_cost_reservation WHERE provider_attempt_id='memory-extract:%d'", prep.AttemptID), "SETTLED:1000000")
}
