//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestDeletionIntentBlocksUsageAndFollowUp(t *testing.T) {
	resetFixtures(t)
	meterIdentity(t)
	ctx := context.Background()
	store := testEnv.store
	store.UseCostLimits(1_000_000, 1_000_000_000)
	if err := IsolationSuperExec(ctx, `DELETE FROM vc.local_embedding_call WHERE owner_user_id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutProactivePolicy(ctx, 1, 10, ProactivePolicyWrite{
		Enabled: true, DailyLimit: 3, RecentInteractionMinutes: 0,
		AllowedModes: []string{"COMPANION"}, OfflineCapable: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
		VALUES (1, 93016, 10, 'RELATIONSHIP', '复查', 'ACCEPTED');
		INSERT INTO vc.follow_up(
			owner_user_id, relationship_id, memory_item_id, body, status, normalization_status,
			time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
		VALUES (
			1, 10, 93016, '复查', 'SCHEDULED', 'explicit_date',
			'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
			clock_timestamp() - interval '1 hour', 'fu-w16e-del',
			'st:11111111-1111-4111-8111-111111111111')`); err != nil {
		t.Fatal(err)
	}
	followID := superInt(t, `SELECT id FROM vc.follow_up WHERE owner_user_id = 1 AND event_id = 'fu-w16e-del'`)
	if _, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-w16e-open",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordLocalEmbeddingCall(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `DELETE FROM vc.local_embedding_call WHERE owner_user_id = 1`); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
		VALUES (1, '0000000000000000000000000000000000000000000000000000000000000d01', 'REQUESTED')`); err != nil {
		t.Fatal(err)
	}
	before := superInt(t, `SELECT count(*) FROM vc.model_cost_reservation WHERE owner_user_id = 1`)
	_, err := store.ReserveModelUsage(ctx, ModelUsageReserve{
		Owner: 1, Purpose: PurposeForegroundChat, AttemptID: "fg-w16e-deleting",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("reserve during deletion = %v", err)
	}
	if got := superInt(t, `SELECT count(*) FROM vc.model_cost_reservation WHERE owner_user_id = 1`); got != before {
		t.Fatalf("reservations %d, want %d", got, before)
	}
	if err := store.RecordLocalEmbeddingCall(ctx, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("embedding during deletion = %v", err)
	}
	if got := superInt(t, `SELECT count(*) FROM vc.local_embedding_call WHERE owner_user_id = 1`); got != 0 {
		t.Fatalf("embedding rows %d", got)
	}
	_, err = store.ApplyFollowUpDue(ctx, 1, int64(followID), FollowUpDueDecision{Action: FollowUpDueEnqueue})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("enqueue during deletion = %v", err)
	}
	if got := superInt(t, `SELECT count(*) FROM vc.work_item WHERE owner_user_id = 1 AND kind = 'FOLLOW_UP' AND ref_id = $1`, followID); got != 0 {
		t.Fatalf("follow-up jobs %d", got)
	}
	greeting := "下周见"
	if err := store.FinishFollowUpGeneration(ctx, 1, int64(followID), FollowUpGenerationFinish{
		Outcome: "BODY_READY", Reason: "BODY_READY", Greeting: &greeting,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("finish during deletion = %v", err)
	}
	if got := superText(t, `SELECT coalesce(greeting_body, '') FROM vc.follow_up WHERE owner_user_id = 1 AND id = $1`, followID); got != "" {
		t.Fatalf("greeting stored during deletion %q", got)
	}
	until := time.Now().Add(time.Hour).UTC()
	if _, err := store.ApplyFollowUpDue(ctx, 1, int64(followID), FollowUpDueDecision{
		Action: FollowUpDueDefer, DeferredUntil: &until,
	}); err != nil {
		t.Fatalf("defer during deletion = %v", err)
	}
}

func superInt(t *testing.T, sql string, args ...any) int {
	t.Helper()
	ctx := context.Background()
	db, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	var n int
	if err := db.QueryRow(ctx, sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func superText(t *testing.T, sql string, args ...any) string {
	t.Helper()
	ctx := context.Background()
	db, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	var out string
	if err := db.QueryRow(ctx, sql, args...).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}
