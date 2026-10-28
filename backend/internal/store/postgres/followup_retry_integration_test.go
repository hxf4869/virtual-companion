//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestFollowUpHoldRequeuesAfterBinding(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	now := dueShanghai(2026, time.November, 2, 16, 0)
	runFollowUpDue(t, now)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	got := readHold(t, row.ID)
	if got.status != "SCHEDULED" || got.live != 1 || got.deferrals != 0 {
		t.Fatalf("first queue = %+v", got)
	}
	assertHoldEvent(t, got, "2026-11-02", "15:04")
	if got.trigger == nil || !got.trigger.Equal(dueInstant(15, 4)) {
		t.Fatalf("trigger = %v", got.trigger)
	}

	err := IsolationSuperExec(context.Background(), `
		INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
		VALUES (1, nextval('vc.work_item_id_seq'), 'FOLLOW_UP', $1, 'PENDING')`, row.ID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("second live job err = %v", err)
	}

	ctx := context.Background()
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
		Outcome: "NOT_GENERATED", Reason: "UNBOUND", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	held := readHold(t, row.ID)
	wantUntil := now.Add(6 * time.Hour)
	if held.status != "DEFERRED" || held.deferrals != 1 || held.deferred == nil || !held.deferred.Equal(wantUntil) || held.greeting != nil || held.outcome == nil || *held.outcome != "NOT_GENERATED" || held.reason == nil || *held.reason != "UNBOUND" {
		t.Fatalf("unbound hold = %+v", held)
	}
	assertHoldEvent(t, held, "2026-11-02", "15:04")
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
		Outcome: "NOT_GENERATED", Reason: "UNBOUND", Now: now.Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	replay := readHold(t, row.ID)
	if replay.deferrals != 1 || replay.deferred == nil || !replay.deferred.Equal(wantUntil) || replay.status != "DEFERRED" {
		t.Fatalf("replay moved the hold = %+v", replay)
	}

	failLiveFollowUps(t, row.ID)
	afterFail := readHold(t, row.ID)
	if afterFail.live != 0 || afterFail.failed != 1 {
		t.Fatalf("failed job still live = %+v", afterFail)
	}
	if _, err := testEnv.store.PutProactivePolicy(ctx, 1, b.RelationshipID, ProactivePolicyWrite{
		Enabled: false, DailyLimit: 3, AllowedModes: []string{"COMPANION"},
	}); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, wantUntil)
	closed := readHold(t, row.ID)
	if closed.status != "DEFERRED" || closed.deferrals != 1 || closed.live != 0 || closed.deferred == nil || !closed.deferred.Equal(wantUntil) {
		t.Fatalf("closed policy changed the wait = %+v", closed)
	}
	assertHoldEvent(t, closed, "2026-11-02", "15:04")

	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	runFollowUpDue(t, wantUntil)
	requeued := readHold(t, row.ID)
	if requeued.status != "SCHEDULED" || requeued.live != 1 || requeued.deferrals != 1 || requeued.deferred != nil || requeued.trigger == nil || !requeued.trigger.Equal(dueInstant(15, 4)) {
		t.Fatalf("requeue = %+v", requeued)
	}
	assertHoldEvent(t, requeued, "2026-11-02", "15:04")
	runFollowUpDue(t, wantUntil)
	again := readHold(t, row.ID)
	if again.live != 1 || again.status != "SCHEDULED" || again.deferrals != 1 {
		t.Fatalf("second pass = %+v", again)
	}

	greeting := "下周见"
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
		Outcome: "BODY_READY", Reason: "BODY_READY", Greeting: &greeting,
		ProviderID: "greet-prov", ModelID: "greet-model", Protocol: ProtocolOpenAIChat,
		ProviderRevision: int64Ptr(4), BindingRevision: int64Ptr(9),
		Now: wantUntil,
	}); err != nil {
		t.Fatal(err)
	}
	other := "另一句"
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
		Outcome: "BODY_READY", Reason: "BODY_READY", Greeting: &other, Now: wantUntil,
	}); err != nil {
		t.Fatal(err)
	}
	saved := readHold(t, row.ID)
	if saved.status != "BODY_READY" || saved.greeting == nil || *saved.greeting != "下周见" || saved.eventID != row.EventID {
		t.Fatalf("saved greeting = %+v", saved)
	}
	assertHoldEvent(t, saved, "2026-11-02", "15:04")

	if err := IsolationSuperExec(ctx, `INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k) VALUES ('greet-prov', 'greet-model', 1, 0.001, 0.002) ON CONFLICT (provider_id, model_id, price_version) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	attempt := "follow-up-retry:" + row.EventID
	first, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, row.ID, attempt, "greet-prov", "greet-model", 10, 16)
	if err != nil || first != "HELD" {
		t.Fatalf("first hold = %s %v", first, err)
	}
	second, err := testEnv.store.PrepareFollowUpModelCall(ctx, 1, row.ID, attempt, "greet-prov", "greet-model", 10, 16)
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
}

func TestFollowUpHoldCapBecomesSilent(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	at := dueShanghai(2026, time.November, 2, 16, 0)
	runFollowUpDue(t, at)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	delays := []time.Duration{6 * time.Hour, 12 * time.Hour, 24 * time.Hour}
	ctx := context.Background()
	for i, delay := range delays {
		if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
			Outcome: "NOT_GENERATED", Reason: "NO_PRICE", Now: at,
		}); err != nil {
			t.Fatal(err)
		}
		got := readHold(t, row.ID)
		if got.status != "DEFERRED" || got.deferrals != i+1 || got.deferred == nil || !got.deferred.Equal(at.Add(delay)) || got.greeting != nil || got.reason == nil || *got.reason != "NO_PRICE" {
			t.Fatalf("wait %d = %+v", i+1, got)
		}
		assertHoldEvent(t, got, "2026-11-02", "15:04")
		failLiveFollowUps(t, row.ID)
		at = at.Add(delay)
		runFollowUpDue(t, at)
		queued := readHold(t, row.ID)
		if queued.status != "SCHEDULED" || queued.live != 1 || queued.deferrals != i+1 || queued.deferred != nil || queued.trigger == nil || !queued.trigger.Equal(dueInstant(15, 4)) {
			t.Fatalf("requeue %d = %+v", i+1, queued)
		}
		assertHoldEvent(t, queued, "2026-11-02", "15:04")
	}
	if err := testEnv.store.FinishFollowUpGeneration(ctx, 1, row.ID, FollowUpGenerationFinish{
		Outcome: "NOT_GENERATED", Reason: "NO_PRICE", Now: at,
	}); err != nil {
		t.Fatal(err)
	}
	silent := readHold(t, row.ID)
	if silent.status != "SILENT" || silent.deferrals != 3 || silent.deferred != nil || silent.greeting != nil || silent.reason == nil || *silent.reason != "NO_PRICE" || silent.outcome == nil || *silent.outcome != "NOT_GENERATED" {
		t.Fatalf("silent = %+v", silent)
	}
	assertHoldEvent(t, silent, "2026-11-02", "15:04")
	failLiveFollowUps(t, row.ID)
	runFollowUpDue(t, at.Add(48*time.Hour))
	left := readHold(t, row.ID)
	if left.status != "SILENT" || left.live != 0 || left.deferrals != 3 || left.deferred != nil {
		t.Fatalf("silent was queued again = %+v", left)
	}
	assertHoldEvent(t, left, "2026-11-02", "15:04")
}

type holdSnap struct {
	status, date, clock, zone, eventID string
	outcome, reason, greeting          *string
	trigger, deferred                  *time.Time
	deferrals, live, failed            int
}

func readHold(t *testing.T, id int64) holdSnap {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var got holdSnap
	var date, clock, zone *string
	err = conn.QueryRow(ctx, `
		SELECT f.status, to_char(f.event_date, 'YYYY-MM-DD'), f.event_time, f.event_timezone,
		       f.trigger_at, f.deferred_until, f.greeting_body, f.generation_outcome,
		       f.generation_reason, f.generation_deferrals, f.event_id,
		       (SELECT count(*)::int FROM vc.work_item w
		         WHERE w.owner_user_id = f.owner_user_id AND w.kind = 'FOLLOW_UP'
		           AND w.ref_id = f.id AND w.status IN ('PENDING', 'CLAIMED')),
		       (SELECT count(*)::int FROM vc.work_item w
		         WHERE w.owner_user_id = f.owner_user_id AND w.kind = 'FOLLOW_UP'
		           AND w.ref_id = f.id AND w.status = 'FAILED')
		  FROM vc.follow_up f
		 WHERE f.owner_user_id = 1 AND f.id = $1`, id).Scan(
		&got.status, &date, &clock, &zone, &got.trigger, &got.deferred, &got.greeting,
		&got.outcome, &got.reason, &got.deferrals, &got.eventID, &got.live, &got.failed)
	if err != nil {
		t.Fatal(err)
	}
	if date != nil {
		got.date = *date
	}
	if clock != nil {
		got.clock = *clock
	}
	if zone != nil {
		got.zone = *zone
	}
	return got
}

func assertHoldEvent(t *testing.T, got holdSnap, date, clock string) {
	t.Helper()
	if got.date != date || got.clock != clock || got.zone != "Asia/Shanghai" {
		t.Fatalf("event = %s %s %s", got.date, got.clock, got.zone)
	}
}

func failLiveFollowUps(t *testing.T, id int64) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(), `
		UPDATE vc.work_item
		   SET status = 'FAILED'
		 WHERE owner_user_id = 1 AND kind = 'FOLLOW_UP' AND ref_id = $1
		   AND status IN ('PENDING', 'CLAIMED')`, id); err != nil {
		t.Fatal(err)
	}
}
