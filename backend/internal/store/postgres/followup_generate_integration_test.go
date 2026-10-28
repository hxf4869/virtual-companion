//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestFollowUpGenerationStore(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	mem, _ := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	ready := followForMemory(t, b.RelationshipID, mem.ID)
	if ready.Status != "SCHEDULED" || ready.EventID == "" {
		t.Fatalf("scheduled follow-up = %+v", ready)
	}
	if _, err := testEnv.store.PutProactivePolicy(ctx, 1, b.RelationshipID, ProactivePolicyWrite{
		Enabled: true, DailyLimit: 1, AllowedModes: []string{"COMPANION"}, OfflineCapable: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.relationship SET companion_name = '小南' WHERE owner_user_id = 1 AND id = $1`, b.RelationshipID); err != nil {
		t.Fatal(err)
	}
	loaded, err := testEnv.store.LoadFollowUpGeneration(ctx, 1, ready.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.SourceValid || !loaded.PolicyEnabled || !loaded.OfflineCapable || loaded.CompanionName == nil || *loaded.CompanionName != "小南" {
		t.Fatalf("load = %+v", loaded)
	}
	if loaded.EventID != ready.EventID || loaded.Body == "" {
		t.Fatalf("load lost the topic: %+v", loaded)
	}
	phrase := "blocked phrase"
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, ready.ID, FollowUpGenerationFinish{
		Outcome: "BLOCKED", Reason: "output-ai-identity-human-claim", Greeting: &phrase,
	}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("blocked body err = %v", err)
	}
	afterReject, err := testEnv.store.LoadFollowUpGeneration(ctx, 1, ready.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterReject.Greeting != nil || afterReject.Status != "SCHEDULED" || afterReject.Body != loaded.Body {
		t.Fatalf("rejected block changed the row: %+v", afterReject)
	}
	greeting := "下周见"
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, ready.ID, FollowUpGenerationFinish{
		Outcome: "BODY_READY", Reason: "BODY_READY", Greeting: &greeting,
		ProviderID: "greet-prov", ModelID: "greet-model", Protocol: ProtocolOpenAIChat,
		ProviderRevision: int64Ptr(4), BindingRevision: int64Ptr(9),
		Params: []byte(`{"temperature":0.5}`),
	}); err != nil {
		t.Fatal(err)
	}
	other := "另一句"
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, ready.ID, FollowUpGenerationFinish{
		Outcome: "BODY_READY", Reason: "BODY_READY", Greeting: &other,
	}); err != nil {
		t.Fatal(err)
	}
	saved, err := testEnv.store.LoadFollowUpGeneration(ctx, 1, ready.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Status != "BODY_READY" || saved.Deliverable != "DELIVERABLE" || saved.Greeting == nil || *saved.Greeting != "下周见" || saved.EventID != ready.EventID || saved.Body != loaded.Body {
		t.Fatalf("saved greeting = %+v", saved)
	}
	listed := followForMemory(t, b.RelationshipID, mem.ID)
	if listed.Body != loaded.Body || listed.EventID != ready.EventID || listed.Status != "BODY_READY" || listed.Deliverable != "DELIVERABLE" {
		t.Fatalf("list row = %+v", listed)
	}
	if _, err := testEnv.store.LoadFollowUpGeneration(ctx, 2, ready.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner load = %v", err)
	}

	if err := IsolationSuperExec(ctx, `INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k) VALUES ('greet-prov', 'greet-model', 1, 0.001, 0.002) ON CONFLICT (provider_id, model_id, price_version) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	attempt := "follow-up-it:" + ready.EventID
	first, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, ready.ID, attempt, "greet-prov", "greet-model", 10, 16)
	if err != nil || first != "HELD" {
		t.Fatalf("first hold = %s %v", first, err)
	}
	second, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, ready.ID, attempt, "greet-prov", "greet-model", 10, 16)
	if err != nil || second != "REUSED_HELD" {
		t.Fatalf("second hold = %s %v", second, err)
	}
	var count int
	var reserved string
	db, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	if err := db.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(reserved_usd), 0)::text FROM vc.model_cost_reservation WHERE provider_attempt_id = $1`, attempt).Scan(&count, &reserved); err != nil {
		t.Fatal(err)
	}
	if count != 1 || reserved != "0.000042" {
		t.Fatalf("reservation count=%d reserved=%s", count, reserved)
	}
	if _, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, ready.ID, attempt+"-missing", "greet-prov", "missing-model", 10, 16); !errors.Is(err, ErrFollowUpNoPrice) {
		t.Fatalf("missing price = %v", err)
	}
	var missing int
	if err := db.QueryRow(ctx, `SELECT count(*)::int FROM vc.model_cost_reservation WHERE provider_attempt_id = $1`, attempt+"-missing").Scan(&missing); err != nil {
		t.Fatal(err)
	}
	if missing != 0 {
		t.Fatalf("missing price reservations = %d", missing)
	}
	testEnv.store.UseCostLimits(0, 1_000_000_000)
	t.Cleanup(func() { testEnv.store.UseCostLimits(1_000_000, 1_000_000_000) })
	if _, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, ready.ID, attempt+"-budget", "greet-prov", "greet-model", 10, 16); !errors.Is(err, ErrFollowUpBudget) {
		t.Fatalf("budget = %v", err)
	}
	if _, err := testEnv.store.FollowUpProviderCredential(ctx, "missing-prov", 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing credential = %v", err)
	}
}
