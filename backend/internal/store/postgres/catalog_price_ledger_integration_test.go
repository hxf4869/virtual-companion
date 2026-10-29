//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
)

// Catalog prices are per million tokens. The ledger stores USD per 1K tokens,
// so 1.5 / 3 per million become 0.0015 / 0.003 per 1K. A 1000/1000 hold is
// (1000*0.0015 + 1000*0.003) / 1000 = 0.004500.
func TestCatalogPriceSyncsLedgerAndReservation(t *testing.T) {
	store := resetCatalogFixtures(t)
	store.UseCostLimits(1_000_000, 100_000_000)
	t.Cleanup(func() {
		store.UseCostLimits(1_000_000, 1_000_000_000)
		if _, err := psqlSuper(`
DELETE FROM vc.model_cost_reservation WHERE provider_id IN ('priced', 'legacy');
DELETE FROM vc.model_unit_price WHERE provider_id IN ('priced', 'legacy');
UPDATE vc.month_cost_budget b SET
    reserved_usd = coalesce((SELECT sum(reserved_usd) FROM vc.model_cost_reservation r
                              WHERE r.month_start = b.month_start AND r.status = 'HELD'), 0),
    settled_usd = coalesce((SELECT sum(actual_usd) FROM vc.model_cost_reservation r
                             WHERE r.month_start = b.month_start AND r.status = 'SETTLED'), 0);
DELETE FROM vc.provider_model WHERE provider_id IN ('priced', 'legacy');
DELETE FROM vc.provider_deployment WHERE provider_id IN ('priced', 'legacy');
DELETE FROM vc.provider_config WHERE provider_id IN ('priced', 'legacy');
DELETE FROM vc.identity_account WHERE id = 3;
DELETE FROM vc.vc_user WHERE id = 3;
`); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	ctx := context.Background()
	const admin = int64(7)
	if err := IsolationSuperExec(ctx, `
INSERT INTO vc.vc_user(id, display_name) VALUES (3, 'other owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (3, 'priced-other', 'hash', 'USER', 'ACTIVE', 'other')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', role = 'USER';`); err != nil {
		t.Fatal(err)
	}

	usd := func(in, out float64) *ModelPricing {
		return &ModelPricing{Currency: strPtr("USD"), InputPerMillionTokens: f64Ptr(in), OutputPerMillionTokens: f64Ptr(out)}
	}
	save := func(state, providerState string, price *ModelPricing, models ...ProviderModel) {
		t.Helper()
		if len(models) == 0 {
			model := catalogModel("chat", "chat", intPtr(32768))
			model.State = state
			model.Pricing = price
			models = []ProviderModel{model}
		}
		if _, err := store.SaveProviderConfig(ctx, admin, SaveProvider{
			ProviderID: "priced", DisplayName: "Priced", Protocol: ProtocolOpenAIChat,
			BaseURL: "https://priced.example/v1", Credential: "priced-key",
			State: providerState, Models: models,
		}); err != nil {
			t.Fatal(err)
		}
	}
	status := func(profile string) string {
		t.Helper()
		configs, err := store.ListProviderConfigs(ctx, admin)
		if err != nil {
			t.Fatal(err)
		}
		for _, cfg := range configs {
			if cfg.ProviderID != "priced" {
				continue
			}
			for _, model := range cfg.Models {
				if model.ProfileKey == profile {
					return model.LedgerPrice
				}
			}
		}
		t.Fatalf("profile %s missing", profile)
		return ""
	}
	reserve := func(owner int64, attempt string) (ModelUsageHold, error) {
		return store.ReserveModelUsage(ctx, ModelUsageReserve{
			Owner: owner, Purpose: PurposeForegroundChat, AttemptID: attempt,
			ProviderID: "priced", ModelID: "chat", InputTokens: 1000, OutputTokens: 1000,
		})
	}

	save(ProviderEnabled, ProviderEnabled, usd(1.5, 3))
	if status("chat") != LedgerPriceActive {
		t.Fatalf("usd save ledgerPrice=%s", status("chat"))
	}
	if got := ledgerSnapshot(t, "priced", "chat"); got != "1:0.0015:0.003:true" {
		t.Fatalf("first ledger row %s", got)
	}
	held, err := reserve(1, "priced-v1")
	if err != nil || held.ReservedUSD != "0.004500" {
		t.Fatalf("first hold %+v err=%v", held, err)
	}
	if got := reservationPrice(t, "priced-v1"); got != "1:0.0015:0.003" {
		t.Fatalf("first reservation price %s", got)
	}

	save(ProviderEnabled, ProviderEnabled, usd(1.5, 3))
	if got := ledgerSnapshot(t, "priced", "chat"); got != "1:0.0015:0.003:true" {
		t.Fatalf("same price must not bump version, got %s", got)
	}

	save(ProviderEnabled, ProviderEnabled, usd(3, 6))
	if status("chat") != LedgerPriceActive {
		t.Fatalf("repriced ledgerPrice=%s", status("chat"))
	}
	if got := ledgerSnapshot(t, "priced", "chat"); got != "1:0.0015:0.003:true,2:0.003:0.006:true" {
		t.Fatalf("versioned ledger %s", got)
	}
	repriced, err := reserve(1, "priced-v2")
	if err != nil || repriced.ReservedUSD != "0.009000" {
		t.Fatalf("repriced hold %+v err=%v", repriced, err)
	}
	if got := reservationPrice(t, "priced-v2"); got != "2:0.003:0.006" {
		t.Fatalf("new reservation price %s", got)
	}
	if got := reservationPrice(t, "priced-v1"); got != "1:0.0015:0.003" {
		t.Fatalf("old reservation must keep the frozen price, got %s", got)
	}

	other, err := reserve(3, "priced-other")
	if err != nil || other.ReservedUSD != "0.009000" {
		t.Fatalf("other owner hold %+v err=%v", other, err)
	}
	if _, err := store.SettleModelUsage(ctx, 3, held.ReservationID, 1000, 1000); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner settle err=%v", err)
	}
	if got := reservationStatus(t, "priced-v1"); got != "HELD" {
		t.Fatalf("owner hold after cross-owner settle %s", got)
	}

	save(ProviderEnabled, ProviderEnabled, &ModelPricing{
		Currency: strPtr("CNY"), InputPerMillionTokens: f64Ptr(1), OutputPerMillionTokens: f64Ptr(1),
	})
	if status("chat") != LedgerPriceUnsupportedCurrency {
		t.Fatalf("cny ledgerPrice=%s", status("chat"))
	}
	if _, err := reserve(1, "priced-cny"); usageReason(err) != ModelUsageNoPrice {
		t.Fatalf("cny reserve err=%v", err)
	}
	if got := activeLedgerCount(t, "priced", "chat"); got != "0" {
		t.Fatalf("cny left %s active prices", got)
	}

	save(ProviderEnabled, ProviderEnabled, &ModelPricing{})
	if status("chat") != LedgerPriceMissing {
		t.Fatalf("empty ledgerPrice=%s", status("chat"))
	}
	if _, err := reserve(1, "priced-empty"); usageReason(err) != ModelUsageNoPrice {
		t.Fatalf("empty reserve err=%v", err)
	}
	if got := activeLedgerCount(t, "priced", "chat"); got != "0" {
		t.Fatalf("empty price left %s active prices", got)
	}

	save(ProviderEnabled, ProviderEnabled, usd(0, 0))
	if status("chat") != LedgerPriceActive {
		t.Fatalf("explicit zero ledgerPrice=%s", status("chat"))
	}
	zero, err := reserve(1, "priced-zero")
	if err != nil || zero.ReservedUSD != "0.000000" {
		t.Fatalf("zero hold %+v err=%v", zero, err)
	}

	save(ProviderEnabled, ProviderEnabled, usd(1.5, 3))
	if _, err := reserve(1, "priced-again"); err != nil {
		t.Fatal(err)
	}
	save(ProviderDisabled, ProviderDisabled, usd(1.5, 3))
	if status("chat") != LedgerPriceMissing {
		t.Fatalf("disabled ledgerPrice=%s", status("chat"))
	}
	if _, err := reserve(1, "priced-disabled"); usageReason(err) != ModelUsageNoPrice {
		t.Fatalf("disabled reserve err=%v", err)
	}
	if got := activeLedgerCount(t, "priced", "chat"); got != "0" {
		t.Fatalf("disabled model left %s active prices", got)
	}
	if got := reservationPrice(t, "priced-v1"); got != "1:0.0015:0.003" {
		t.Fatalf("clearing the ledger rewrote a held price: %s", got)
	}

	otherModel := catalogModel("other", "other", intPtr(32768))
	save(ProviderEnabled, ProviderEnabled, nil, otherModel)
	if got := activeLedgerCount(t, "priced", "chat"); got != "0" {
		t.Fatalf("removed model left %s active prices", got)
	}
	if status("other") != LedgerPriceMissing {
		t.Fatalf("replacement ledgerPrice=%s", status("other"))
	}

	left := catalogModel("shared", "shared", intPtr(32768))
	left.Pricing = usd(1, 2)
	right := catalogModel("shared-b", "shared", intPtr(32768))
	right.Pricing = usd(9, 9)
	save(ProviderEnabled, ProviderEnabled, nil, left, right)
	if status("shared") == LedgerPriceActive || status("shared-b") == LedgerPriceActive {
		t.Fatalf("disagreeing profiles shared=%s shared-b=%s", status("shared"), status("shared-b"))
	}
	if _, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "priced-shared",
		ProviderID: "priced", ModelID: "shared", InputTokens: 1000, OutputTokens: 1000,
	}); usageReason(err) != ModelUsageNoPrice {
		t.Fatalf("disagreeing model ids must stay NO_PRICE, err=%v", err)
	}
}

func TestCatalogPriceBackfillIsIdempotent(t *testing.T) {
	resetCatalogFixtures(t)
	t.Cleanup(func() {
		if _, err := psqlSuper(`
DELETE FROM vc.model_unit_price WHERE provider_id = 'legacy';
DELETE FROM vc.provider_model WHERE provider_id = 'legacy';
DELETE FROM vc.provider_deployment WHERE provider_id = 'legacy';
DELETE FROM vc.provider_config WHERE provider_id = 'legacy';
`); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	if err := IsolationSuperExec(context.Background(), `
INSERT INTO vc.provider_config(provider_id, display_name, protocol, base_url, state, updated_by, revision)
VALUES ('legacy', 'Legacy', 'OPENAI_CHAT_COMPLETIONS', 'https://legacy.example/v1', 'DISABLED', 7, 1);
INSERT INTO vc.provider_model(
    provider_id, profile_key, model_id, display_name, context_window_tokens,
    max_output_tokens, priority, state, pricing, updated_by)
VALUES
    ('legacy', 'chat', 'chat', 'Chat', 32768, 2048, 1, 'ENABLED',
     '{"currency":"USD","inputPerMillionTokens":2,"outputPerMillionTokens":4}'::jsonb, 7),
    ('legacy', 'cny', 'cny', 'CNY', 32768, 2048, 2, 'ENABLED',
     '{"currency":"CNY","inputPerMillionTokens":2,"outputPerMillionTokens":4}'::jsonb, 7),
    ('legacy', 'off', 'off', 'Off', 32768, 2048, 3, 'DISABLED',
     '{"currency":"USD","inputPerMillionTokens":2,"outputPerMillionTokens":4}'::jsonb, 7),
    ('legacy', 'bare', 'bare', 'Bare', 32768, 2048, 4, 'ENABLED', '{}'::jsonb, 7);
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('legacy', 'bare', 1, 0.010, 0.020, true);
`); err != nil {
		t.Fatal(err)
	}
	backfill := func() {
		t.Helper()
		if _, err := psqlSuper(`SELECT vc.sync_provider_model_ledger('legacy', false)`); err != nil {
			t.Fatal(err)
		}
	}
	backfill()
	if got := ledgerSnapshot(t, "legacy", "chat"); got != "1:0.002:0.004:true" {
		t.Fatalf("backfill chat %s", got)
	}
	if got := ledgerSnapshot(t, "legacy", "cny"); got != "" {
		t.Fatalf("backfill wrote a non-USD price %s", got)
	}
	if got := ledgerSnapshot(t, "legacy", "off"); got != "" {
		t.Fatalf("backfill activated a disabled model %s", got)
	}
	if got := ledgerSnapshot(t, "legacy", "bare"); got != "1:0.010:0.020:true" && got != "1:0.01:0.02:true" {
		t.Fatalf("backfill changed a hand-written price for an unpriced model %s", got)
	}
	backfill()
	if got := ledgerSnapshot(t, "legacy", "chat"); got != "1:0.002:0.004:true" {
		t.Fatalf("second backfill %s", got)
	}
	if err := IsolationSuperExec(context.Background(), `
UPDATE vc.provider_model
   SET pricing = '{"currency":"USD","inputPerMillionTokens":8,"outputPerMillionTokens":8}'::jsonb
 WHERE provider_id = 'legacy' AND profile_key = 'chat'`); err != nil {
		t.Fatal(err)
	}
	backfill()
	if got := ledgerSnapshot(t, "legacy", "chat"); got != "1:0.002:0.004:true,2:0.008:0.008:true" {
		t.Fatalf("changed catalog price %s", got)
	}
	backfill()
	if got := ledgerSnapshot(t, "legacy", "chat"); got != "1:0.002:0.004:true,2:0.008:0.008:true" {
		t.Fatalf("repeat after change %s", got)
	}
}

func ledgerSnapshot(t *testing.T, provider, model string) string {
	t.Helper()
	got, err := psqlSuper(`
SELECT coalesce(string_agg(
         price_version::text || ':' || input_usd_per_1k::text || ':' ||
         output_usd_per_1k::text || ':' || active::text, ',' ORDER BY price_version), '')
  FROM vc.model_unit_price
 WHERE provider_id = '` + provider + `' AND model_id = '` + model + `'`)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func activeLedgerCount(t *testing.T, provider, model string) string {
	t.Helper()
	got, err := psqlSuper(`
SELECT count(*)::text FROM vc.model_unit_price
 WHERE provider_id = '` + provider + `' AND model_id = '` + model + `'
   AND active AND effective_from <= clock_timestamp()`)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func reservationPrice(t *testing.T, attempt string) string {
	t.Helper()
	got, err := psqlSuper(`
SELECT price_version::text || ':' || input_usd_per_1k::text || ':' || output_usd_per_1k::text
  FROM vc.model_cost_reservation WHERE provider_attempt_id = '` + attempt + `'`)
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func reservationStatus(t *testing.T, attempt string) string {
	t.Helper()
	got, err := psqlSuper(`
SELECT status FROM vc.model_cost_reservation WHERE provider_attempt_id = '` + attempt + `'`)
	if err != nil {
		t.Fatal(err)
	}
	return got
}
