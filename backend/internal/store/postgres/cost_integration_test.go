//go:build integration

package postgres

import (
	"context"
	"fmt"
	"sync"
	"testing"

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
	// 8000 input and 512 output at 0.001/0.002 is 9024 micro-USD, not the ceiling.
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "9024")
}

func TestCostGlobalMonthlyCapSerializesConcurrentOwners(t *testing.T) {
	resetFixtures(t)
	first := costClaim(t, 1, 10, "cost-owner-1")
	second := costClaim(t, 2, 20, "cost-owner-2")
	// One chat estimate is 9024 micro-USD. The month holds exactly one.
	testEnv.store.UseCostLimits(1000000, 9024)
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
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "9024")
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
			want := "0:0:0"
			if disposition == "UNKNOWN" {
				expireClaim(t, c)
				if _, err := testEnv.store.RecoverExpiredGeneration(context.Background(), c.OwnerID, c.JobID); err != nil {
					t.Fatal(err)
				}
				want = "0:0:9024"
			} else {
				err := testEnv.store.RecordAttemptOutcome(context.Background(), companion.AttemptOutcome{OwnerID: c.OwnerID, JobID: c.JobID, AttemptID: p.AttemptID, ClaimToken: c.Token, ClaimFence: c.Fence, Status: companion.AttemptFailed, Billing: companion.BillingNotSent})
				if err != nil {
					t.Fatal(err)
				}
			}
			costAssertSQL(t, "SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget", want)
		})
	}
}

func TestCostExtractionUsesSameCapAndClosesOnJobCancel(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	c := costClaim(t, 1, 10, "cost-chat-hold")
	// 8000 input and 512 output price to 9024 micro-USD and fill this month.
	store.UseCostLimits(1000000, 9024)
	if _, err := prepareCost(c, "synthetic-go-model"); err != nil {
		t.Fatal(err)
	}
	// The shared month cap now applies to the only live extractor. The chat
	// reservation above already holds the whole monthly cap.
	useSTExtractRoute(t, store)
	sourceID := openSTExtractSource(t, store, sourceChat, "extract-card", sourceMessage, sourceCandidate, "费用来源")
	jobs := stExtractJobIDs(t, store, 1)
	if len(jobs) != 1 {
		t.Fatalf("ST extract jobs %v, want 1", jobs)
	}
	extract := claimSTExtract(t, store, jobs[0])
	if extract.RefID != sourceID {
		t.Fatalf("extract ref %d, want source %d", extract.RefID, sourceID)
	}
	store.UseCostLimits(1000000, 9024)
	if _, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, extract.JobID, sourceID, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128); err == nil {
		t.Fatal("extraction bypassed the chat reservation")
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.memory_extract_attempt", "0")
	// 512 output tokens alone cost 1,024 micro-USD. Including this request's
	// 128 input tokens costs 1,152, so a 1,100 ceiling must refuse it.
	store.UseCostLimits(1100, 2000000)
	if _, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, extract.JobID, sourceID, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128); err == nil {
		t.Fatal("extraction input tokens were omitted from the ceiling check")
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.memory_extract_attempt", "0")
	store.UseCostLimits(1000000, 2000000)
	prep, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, extract.JobID, sourceID, extract.Token, extract.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CompleteJob(ctx, 1, extract.JobID, extract.Token, extract.Fence, "CANCELLED", "synthetic"); err != nil {
		t.Fatal(err)
	}
	costAssertSQL(t, fmt.Sprintf("SELECT status || ':' || coalesce(actual_usd::text, 'null') || ':' || round(reserved_usd*1000000)::bigint FROM vc.model_cost_reservation WHERE provider_attempt_id='memory-extract:%d'", prep.AttemptID), "UNKNOWN:null:1152")
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation WHERE status='HELD' AND purpose='LEGACY_CHAT'", "1")
}
