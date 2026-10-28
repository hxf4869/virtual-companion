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

func meterIdentity(t *testing.T) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(), `
INSERT INTO vc.vc_user(id, display_name) VALUES (910077, 'w11 meter admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'w11-meter-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (910077, 'w11-meter-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', role = 'ADMIN';`); err != nil {
		t.Fatal(err)
	}
}

func usageReason(err error) string {
	var usage *ModelUsageError
	if errors.As(err, &usage) {
		return usage.Reason
	}
	return ""
}

func TestModelUsageFourPurposesShareOneMonth(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	// Four 10/10 estimates are 30 micro-USD each. The month holds exactly four.
	store.UseCostLimits(1_000_000, 120)
	ctx := context.Background()
	if _, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-shared",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeToolTurn, AttemptID: "tool-shared",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	}); err != nil {
		t.Fatal(err)
	}
	err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if err := store.reserveModelCostPurpose(ctx, tx, 1, 88001, "memory-extract:shared", "prov-a", "model-a", PurposeMemoryExtraction, 10, 10, store.maxReservedCost); err != nil {
			return err
		}
		return store.reserveModelCostPurpose(ctx, tx, 1, 88002, "follow-up:88002", "prov-a", "model-a", PurposeBackgroundGreetings, 10, 10, store.maxReservedCost)
	})
	if err != nil {
		t.Fatal(err)
	}
	costAssertSQL(t, "SELECT string_agg(purpose, ',' ORDER BY purpose) FROM vc.model_cost_reservation",
		"BACKGROUND_GREETINGS,FOREGROUND_CHAT,MEMORY_EXTRACTION_DEDUP_SUMMARY,TOOL_TURN")
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "120")
	_, err = store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-over",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if usageReason(err) != ModelUsageOverLimit {
		t.Fatalf("fifth hold %v", err)
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation", "4")
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "120")
}

func TestModelUsageConcurrentReserveCannotExceedCap(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	// One 10/10 estimate is 30 micro-USD and fills this month.
	store.UseCostLimits(1_000_000, 30)
	ctx := context.Background()
	var wg sync.WaitGroup
	var mu sync.Mutex
	var ok, denied int
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			attempt := "fg-race-0"
			if n == 1 {
				attempt = "fg-race-1"
			}
			_, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
				Owner: 1, Purpose: PurposeForegroundChat, AttemptID: attempt,
				ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
			})
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				ok++
				return
			}
			if usageReason(err) != ModelUsageOverLimit {
				t.Errorf("race error %v", err)
				return
			}
			denied++
		}(i)
	}
	wg.Wait()
	if ok != 1 || denied != 1 {
		t.Fatalf("ok=%d denied=%d", ok, denied)
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation", "1")
	costAssertSQL(t, "SELECT round(sum(reserved_usd)*1000000)::bigint FROM vc.month_cost_budget", "30")
}

func TestModelUsageTimeoutIsNotZero(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	store.UseCostLimits(1_000_000, 4_000_000)
	ctx := context.Background()
	held, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-timeout",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err := store.CancelModelUsage(ctx, 1, held.ReservationID, "UNKNOWN")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != "UNKNOWN" || cancelled.ReservedUSD != "0.000030" || cancelled.ActualUSD != nil {
		t.Fatalf("cancel %+v", cancelled)
	}
	costAssertSQL(t, "SELECT status || ':' || coalesce(actual_usd::text, 'null') || ':' || round(reserved_usd*1000000)::bigint FROM vc.model_cost_reservation", "UNKNOWN:null:30")
	costAssertSQL(t, "SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget", "0:0:30")
}

func TestModelUsageSecondSendHasItsOwnReservation(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	store.UseCostLimits(1_000_000, 4_000_000)
	ctx := context.Background()
	first, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-send-1",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SettleModelUsage(ctx, 1, first.ReservationID, 10, 4); err != nil {
		t.Fatal(err)
	}
	second, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-send-2",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if err != nil || second.ReservationID == first.ReservationID {
		t.Fatalf("second %+v %v", second, err)
	}
	_, err = store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-send-1",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if usageReason(err) != ModelUsageAttemptReused {
		t.Fatalf("reused settled attempt %v", err)
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation", "2")
}

func TestModelUsageNoPriceMakesNoProviderCall(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	store.UseCostLimits(1_000_000, 4_000_000)
	providerCalls := 0
	_, err := store.ReserveModelUsage(context.Background(), ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-no-price",
		ProviderID: "prov-a", ModelID: "missing-price", InputTokens: 10, OutputTokens: 10,
	})
	if err == nil {
		providerCalls++
	}
	if providerCalls != 0 || usageReason(err) != ModelUsageNoPrice {
		t.Fatalf("calls=%d err=%v", providerCalls, err)
	}
	costAssertSQL(t, "SELECT count(*) FROM vc.model_cost_reservation WHERE provider_attempt_id='fg-no-price'", "0")
}

func TestModelUsageSettleIsIdempotent(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	store.UseCostLimits(1_000_000, 4_000_000)
	ctx := context.Background()
	held, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeToolTurn, AttemptID: "tool-settle",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 1000, OutputTokens: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := store.SettleModelUsage(ctx, 1, held.ReservationID, 1000, 1000)
	if err != nil || first.Idempotent || first.ActualUSD != "0.003000" {
		t.Fatalf("first %+v %v", first, err)
	}
	second, err := store.SettleModelUsage(ctx, 1, held.ReservationID, 5000, 5000)
	if err != nil || !second.Idempotent || second.ActualUSD != first.ActualUSD || second.InputTokens != 1000 || second.OutputTokens != 1000 {
		t.Fatalf("second %+v %v", second, err)
	}
	costAssertSQL(t, "SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint FROM vc.month_cost_budget", "3000:0")
}

func TestModelUsageSummaryDoesNotDoubleCountGenerationUsage(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	store := testEnv.store
	store.UseCostLimits(1_000_000, 4_000_000)
	ctx := context.Background()
	held, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-linked",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 1000, OutputTokens: 1000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SettleModelUsage(ctx, 1, held.ReservationID, 1000, 1000); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
DO $$
DECLARE v_gen1 bigint; v_gen2 bigint;
BEGIN
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (1, 22400, 10, 'meter');
    PERFORM vc.set_owner_context(1, 'meter', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|' || 1 || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'meter',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT generation_id INTO v_gen1 FROM vc.receive_generation(1, 22400, 'meter-key-1', 'user', 'hello');
    SELECT generation_id INTO v_gen2 FROM vc.receive_generation(1, 22400, 'meter-key-2', 'user', 'world');
    INSERT INTO vc.generation_usage(owner_user_id, id, generation_id, provider_ref, input_tokens, output_tokens, actual_cost, currency)
    VALUES (1, 22401, v_gen1, 'fg-linked', 10, 10, 9.990000, 'USD'),
           (1, 22402, v_gen2, 'legacy-only', 20, 20, 1.250000, 'USD');
END $$;`); err != nil {
		t.Fatal(err)
	}
	before, err := psqlSuper(`SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget`)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.RecordLocalEmbeddingCall(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordLocalEmbeddingCall(ctx, 1); err != nil {
		t.Fatal(err)
	}
	after, err := psqlSuper(`SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget`)
	if err != nil || after != before {
		t.Fatalf("embedding moved the month budget %q -> %q (%v)", before, after, err)
	}
	rows, err := store.AdminModelUsageSummary(ctx, 910077, time.Now().UTC().Add(-time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 7 {
		t.Fatalf("purposes %d", len(rows))
	}
	byPurpose := map[string]ModelUsagePurposeRow{}
	for _, row := range rows {
		byPurpose[row.Purpose] = row
	}
	fg := byPurpose[PurposeForegroundChat]
	if fg.Calls != 1 || fg.ActualUSD == nil || *fg.ActualUSD != "0.003000" {
		t.Fatalf("foreground %+v", fg)
	}
	legacy := byPurpose["LEGACY_GENERATION"]
	if legacy.Calls != 1 || legacy.ActualUSD == nil || *legacy.ActualUSD != "1.250000" {
		t.Fatalf("legacy %+v", legacy)
	}
	emb := byPurpose[PurposeEmbedding]
	if emb.Calls != 2 || emb.ActualUSD != nil || emb.EstimatedUSD != nil || emb.UnsettledUSD != nil {
		t.Fatalf("embedding %+v", emb)
	}
	for _, row := range rows {
		for _, money := range []*string{row.ActualUSD, row.EstimatedUSD, row.UnsettledUSD} {
			if money != nil && *money == "9.990000" {
				t.Fatalf("linked generation_usage was counted again: %+v", row)
			}
		}
	}
}
