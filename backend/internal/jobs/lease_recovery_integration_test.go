//go:build integration

package jobs

import (
	"context"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMain(m *testing.M) {
	if err := postgres.StartIsolation(); err != nil {
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
	code := m.Run()
	postgres.StopIsolation()
	os.Exit(code)
}

const (
	w16Chat     = "11111111-1111-4111-8111-111111111111"
	w16Greeting = "下周见"
)

func TestFollowUpExpiredLeaseReclaimsOnceWithoutSecondDelivery(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	followID := w16SeedDeliveredFollowUp(t)
	jobID := w16ClaimedFollowUp(t, followID, 0)
	if err := store.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	if got := w16Count(t, `SELECT count(*) FROM vc.inbox_event WHERE owner_user_id = 1 AND event_id = 'fu-w16-crash'`); got != "1" {
		t.Fatalf("inbox before crash = %s", got)
	}
	if err := postgres.IsolationSuperExec(ctx, `
		UPDATE vc.work_item
		   SET lease_expires_at = clock_timestamp() - interval '1 minute'
		 WHERE owner_user_id = 1 AND id = $1 AND status = 'CLAIMED'`, jobID); err != nil {
		t.Fatal(err)
	}

	loop := w16Loop(store)
	var providerCalls atomic.Int32
	loop.UseProviderFactory(func(modelprovider.Route) (companion.Provider, error) {
		providerCalls.Add(1)
		return nil, errors.New("provider must not run")
	})
	if err := loop.RecoverOnce(ctx); err != nil {
		t.Fatal(err)
	}
	status, attempts, token := w16Job(t, jobID)
	if status != "PENDING" || attempts != "1" || token != "" {
		t.Fatalf("after recover status=%s attempts=%s token=%q", status, attempts, token)
	}
	if got := loop.ClaimOnce(ctx); got != 1 {
		t.Fatalf("reclaim count %d", got)
	}
	w16WaitJob(t, jobID, "DONE")
	if providerCalls.Load() != 0 {
		t.Fatalf("provider calls %d", providerCalls.Load())
	}
	if got := w16Count(t, `SELECT greeting_body FROM vc.follow_up WHERE owner_user_id = 1 AND id = `+followID); got != w16Greeting {
		t.Fatalf("greeting %q", got)
	}
	if err := store.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	if got := w16Count(t, `SELECT count(*) FROM vc.inbox_event WHERE owner_user_id = 1 AND event_id = 'fu-w16-crash'`); got != "1" {
		t.Fatalf("inbox after second projection = %s", got)
	}
	if got := w16Count(t, `SELECT count(*) FROM vc.inbox_event WHERE owner_user_id = 1 AND body = '`+w16Greeting+`'`); got != "1" {
		t.Fatalf("delivered bodies = %s", got)
	}
}

func TestFollowUpExpiredLeaseDeadLettersAndStopsRequeue(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
		VALUES (1, 91016, 10, 'RELATIONSHIP', '复查', 'ACCEPTED');
		INSERT INTO vc.follow_up(
			owner_user_id, relationship_id, memory_item_id, body, status, normalization_status,
			time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
		VALUES (
			1, 10, 91016, '复查', 'SCHEDULED', 'explicit_date',
			'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
			clock_timestamp() - interval '1 hour', 'fu-w16-exhaust', 'st:`+w16Chat+`')`); err != nil {
		t.Fatal(err)
	}
	followID := w16Count(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'fu-w16-exhaust'`)
	jobID := w16ClaimedFollowUp(t, followID, 2)
	if err := postgres.IsolationSuperExec(ctx, `
		UPDATE vc.work_item
		   SET lease_expires_at = clock_timestamp() - interval '1 minute'
		 WHERE owner_user_id = 1 AND id = $1`, jobID); err != nil {
		t.Fatal(err)
	}
	if err := w16Loop(store).RecoverOnce(ctx); err != nil {
		t.Fatal(err)
	}
	status, attempts, code := w16JobCode(t, jobID)
	if status != "DEAD_LETTERED" || attempts != "3" || code != "FOLLOW_UP_LEASE_EXHAUSTED" {
		t.Fatalf("job status=%s attempts=%s code=%s", status, attempts, code)
	}
	row := w16Count(t, `SELECT status || ':' || coalesce(generation_reason, '') || ':' || coalesce(trigger_at::text, '') || ':' || coalesce(deferred_until::text, '') FROM vc.follow_up WHERE event_id = 'fu-w16-exhaust'`)
	if row != "SILENT:LEASE_EXHAUSTED::" {
		t.Fatalf("follow-up %s", row)
	}
	due, err := store.ListDueFollowUps(ctx, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range due {
		if item.ID != 0 && w16Count(t, `SELECT event_id FROM vc.follow_up WHERE id = `+itoa(item.ID)) == "fu-w16-exhaust" {
			t.Fatal("exhausted follow-up is still due")
		}
	}
	if got := w16Count(t, `SELECT count(*) FROM vc.work_item WHERE owner_user_id = 1 AND kind = 'FOLLOW_UP' AND status IN ('PENDING', 'CLAIMED')`); got != "0" {
		t.Fatalf("live follow-up jobs %s", got)
	}
}

func TestExpiredHoldBecomesUnknownAndLateSettleStaysUnsettled(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	store.UseCostLimits(1_000_000, 4_000_000)
	aged, err := store.ReserveModelUsage(ctx, postgres.ModelUsageReserve{
		Owner: 1, Purpose: postgres.PurposeForegroundChat, AttemptID: "fg-w16-aged",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	young, err := store.ReserveModelUsage(ctx, postgres.ModelUsageReserve{
		Owner: 2, Purpose: postgres.PurposeToolTurn, AttemptID: "tool-w16-young",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.IsolationSuperExec(ctx, `
		UPDATE vc.model_cost_reservation
		   SET created_at = clock_timestamp() - interval '2 hours'
		 WHERE id = $1`, aged.ReservationID); err != nil {
		t.Fatal(err)
	}
	if err := w16Loop(store).RecoverOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := w16Count(t, `SELECT status || ':' || coalesce(actual_usd::text, 'null') FROM vc.model_cost_reservation WHERE id = `+itoa(aged.ReservationID)); got != "UNKNOWN:null" {
		t.Fatalf("aged %s", got)
	}
	if got := w16Count(t, `SELECT status FROM vc.model_cost_reservation WHERE id = `+itoa(young.ReservationID)); got != "HELD" {
		t.Fatalf("young %s", got)
	}
	if got := w16Count(t, `SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget`); got != "0:30:30" {
		t.Fatalf("month %s", got)
	}
	late, err := store.SettleModelUsage(ctx, 1, aged.ReservationID, 10, 4)
	if err != nil {
		t.Fatal(err)
	}
	if late.Status != "UNKNOWN" || !late.Idempotent || late.ActualUSD != "" {
		t.Fatalf("late %+v", late)
	}
	if got := w16Count(t, `SELECT round(settled_usd*1000000)::bigint || ':' || round(reserved_usd*1000000)::bigint || ':' || round(unsettled_usd*1000000)::bigint FROM vc.month_cost_budget`); got != "0:30:30" {
		t.Fatalf("month after late settle %s", got)
	}
	if _, err := store.SettleModelUsage(ctx, 2, aged.ReservationID, 10, 4); !errors.Is(err, postgres.ErrNotFound) {
		t.Fatalf("cross-owner settle %v", err)
	}
	_, err = store.ReserveModelUsage(ctx, postgres.ModelUsageReserve{
		Owner: 1, Purpose: postgres.PurposeForegroundChat, AttemptID: "fg-w16-aged",
		ProviderID: "prov-a", ModelID: "model-a", InputTokens: 10, OutputTokens: 10,
	})
	var usage *postgres.ModelUsageError
	if !errors.As(err, &usage) || usage.Reason != postgres.ModelUsageAttemptReused {
		t.Fatalf("reused unknown attempt %v", err)
	}
	if got := w16Count(t, `SELECT coalesce(vc.go_settle_held_model_cost('fg-w16-aged', 'USAGE_REPORTED', 10, 4)::text, 'null')`); got != "null" {
		t.Fatalf("worker late settle %q", got)
	}
	if got := w16Count(t, `SELECT status || ':' || coalesce(actual_usd::text, 'null') || ':' || round(reserved_usd*1000000)::bigint FROM vc.model_cost_reservation WHERE id = `+itoa(aged.ReservationID)); got != "UNKNOWN:null:30" {
		t.Fatalf("aged after worker settle %s", got)
	}
	if got := w16Count(t, `SELECT status || ':' || round(reserved_usd*1000000)::bigint FROM vc.model_cost_reservation WHERE id = `+itoa(young.ReservationID)); got != "HELD:30" {
		t.Fatalf("young after sweep %s", got)
	}
}

func w16Loop(store *postgres.Store) *Loop {
	policy := testLoopPolicy(1)
	policy.DefaultLease = 6 * time.Minute
	policy.GenerationLease = 270 * time.Second
	policy.ExportLease = 10 * time.Minute
	policy.HoldReservationMaxAge = HoldReservationMaxAge(240 * time.Second)
	loop := NewLoop(nil, policy, testTurnBudget())
	loop.BindStore(store)
	return loop
}

func w16Reset(t *testing.T) {
	t.Helper()
	postgres.IsolationStore().UseCostLimits(1_000_000, 1_000_000_000)
	if err := postgres.IsolationSuperExec(context.Background(), `
		TRUNCATE vc.notification_delivery, vc.notification_channel, vc.inbox_event,
		         vc.follow_up, vc.work_item, vc.model_cost_reservation, vc.month_cost_budget,
		         vc.conversation, vc.relationship, vc.identity_account, vc.account_deletion_intent,
		         vc.vc_user CASCADE;
		INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
		VALUES ('prov-a', 'model-a', 1, 0.001, 0.002)
		ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
		   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
		       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
		       active = true;
		INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
		INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
		VALUES (1, 'w16-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
		       (2, 'w16-other', 'synthetic', 'USER', 'ACTIVE', 'other');
		INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
		VALUES (1, 10, 'persona-a', true), (2, 20, 'persona-b', true);
		INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
		VALUES (1, 501, 10, 'w16', '`+w16Chat+`', 'COMPANION', 'PRESENT', false);
	`); err != nil {
		t.Fatal(err)
	}
}

func w16SeedDeliveredFollowUp(t *testing.T) string {
	t.Helper()
	if err := postgres.IsolationSuperExec(context.Background(), `
		INSERT INTO vc.follow_up(
			owner_user_id, relationship_id, body, status, normalization_status,
			event_id, deliverable, greeting_body, generation_outcome, generation_reason, source_ref)
		VALUES (
			1, 10, '复查', 'BODY_READY', 'explicit_date',
			'fu-w16-crash', 'DELIVERABLE', '`+w16Greeting+`', 'BODY_READY', 'BODY_READY',
			'st:`+w16Chat+`')`); err != nil {
		t.Fatal(err)
	}
	return w16Count(t, `SELECT id::text FROM vc.follow_up WHERE owner_user_id = 1 AND event_id = 'fu-w16-crash'`)
}

func w16ClaimedFollowUp(t *testing.T, followID string, attempts int) string {
	t.Helper()
	if err := postgres.IsolationSuperExec(context.Background(), `
		INSERT INTO vc.work_item(
			owner_user_id, id, kind, ref_id, status, claim_token, claim_fence,
			claimed_at, lease_expires_at, attempt_count)
		VALUES (
			1, nextval('vc.work_item_id_seq'), 'FOLLOW_UP', `+followID+`, 'CLAIMED',
			'crash-token', 'crash-fence', clock_timestamp(),
			clock_timestamp() + interval '5 minutes', `+itoa(int64(attempts))+`)`); err != nil {
		t.Fatal(err)
	}
	return w16Count(t, `SELECT id::text FROM vc.work_item WHERE owner_user_id = 1 AND kind = 'FOLLOW_UP' AND ref_id = `+followID)
}

func w16Job(t *testing.T, jobID string) (status, attempts, token string) {
	t.Helper()
	status = w16Count(t, `SELECT status FROM vc.work_item WHERE id = `+jobID)
	attempts = w16Count(t, `SELECT attempt_count::text FROM vc.work_item WHERE id = `+jobID)
	token = w16Count(t, `SELECT coalesce(claim_token, '') FROM vc.work_item WHERE id = `+jobID)
	return status, attempts, token
}

func w16JobCode(t *testing.T, jobID string) (status, attempts, code string) {
	t.Helper()
	status, attempts, _ = w16Job(t, jobID)
	code = w16Count(t, `SELECT coalesce(last_error_code, '') FROM vc.work_item WHERE id = `+jobID)
	return status, attempts, code
}

func w16WaitJob(t *testing.T, jobID, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	var status string
	for time.Now().Before(deadline) {
		status = w16Count(t, `SELECT status FROM vc.work_item WHERE id = `+jobID)
		if status == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("job %s status %s, want %s", jobID, status, want)
}

func w16Count(t *testing.T, sql string) string {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, postgres.IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var out string
	if err := pool.QueryRow(ctx, sql).Scan(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
