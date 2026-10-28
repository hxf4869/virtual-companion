//go:build integration

package postgres

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestNotificationCrossOwnerSameKey(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	const eventID = "w10-t3-shared"
	const target = "owner@example.test"
	first := seedNotification(t, 1, 10, eventID, "greeting for owner 1", "EMAIL", target, true)
	second := seedNotification(t, 2, 20, eventID, "greeting for owner 2", "EMAIL", target, true)
	if first == second {
		t.Fatalf("owners shared a delivery id %d", first)
	}
	var n int
	superRow(t, `
		SELECT count(*) FROM vc.notification_delivery
		 WHERE event_id = $1 AND channel = 'EMAIL' AND configured_target = $2`,
		[]any{eventID, target}, &n)
	if n != 2 {
		t.Fatalf("cross-owner deliveries = %d", n)
	}
	again, err := testEnv.store.CreateNotificationDeliveries(ctx, 1, eventID)
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 1 || again[0].ID != first {
		t.Fatalf("repeat create = %+v", again)
	}
}

func TestNotificationOnlyEnabledChannel(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	conv := seedFollowUp(t, 1, 10, "w10-t3-one", "greeting one")
	putChannel(t, 1, 10, "EMAIL", "owner@example.test", "", true, false)
	putChannel(t, 1, 10, "FEISHU", "group-w10", "", false, false)
	recordPush(t, 1, true)
	createInbox(t, 1, "w10-t3-one", conv)
	got, err := testEnv.store.CreateNotificationDeliveries(ctx, 1, "w10-t3-one")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Channel != "EMAIL" || got[0].Target != "owner@example.test" {
		t.Fatalf("deliveries = %+v", got)
	}
}

func TestNotificationScheduleLeavesFollowUpTrigger(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	id := seedNotification(t, 1, 10, "w10-t3-quiet", "quiet greeting", "EMAIL", "owner@example.test", true)
	start, end, zone := "00:00", "23:00", "UTC"
	if _, err := testEnv.store.PutProactivePolicy(ctx, 1, 10, ProactivePolicyWrite{
		Enabled: true, QuietHoursStart: &start, QuietHoursEnd: &end, QuietHoursTimezone: &zone,
		DailyLimit: 5, AllowedModes: []string{"COMPANION"},
	}); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	row, err := testEnv.store.LoadNotificationDelivery(ctx, 1, id, now)
	if err != nil {
		t.Fatal(err)
	}
	decision := DecideNotificationSend(now, row)
	if decision.Action != NotificationDefer || decision.NextAttempt == nil {
		t.Fatalf("decision = %+v", decision)
	}
	if err := testEnv.store.ScheduleNotificationDelivery(ctx, 1, id, decision.AttemptCount, *decision.NextAttempt); err != nil {
		t.Fatal(err)
	}
	var status string
	var trigger *time.Time
	superRow(t, `
		SELECT status, trigger_at FROM vc.follow_up
		 WHERE owner_user_id = 1 AND event_id = 'w10-t3-quiet'`, nil, &status, &trigger)
	if status != "BODY_READY" || trigger != nil {
		t.Fatalf("follow-up status=%s trigger=%v", status, trigger)
	}
	var deliveryStatus string
	var attempts int
	var next *time.Time
	superRow(t, `
		SELECT status, attempt_count, next_attempt_at FROM vc.notification_delivery
		 WHERE owner_user_id = 1 AND id = $1`, []any{id}, &deliveryStatus, &attempts, &next)
	if deliveryStatus != "pending" || attempts != 0 || next == nil || !next.Equal(*decision.NextAttempt) {
		t.Fatalf("delivery status=%s attempts=%d next=%v", deliveryStatus, attempts, next)
	}
}

func TestNotificationOutcomeDoesNotAckInbox(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	id := seedNotification(t, 1, 10, "w10-t3-ack", "ack greeting", "EMAIL", "owner@example.test", true)
	status, err := testEnv.store.RecordNotificationOutcome(ctx, 1, id, "accepted", "", "n-ack-1")
	if err != nil {
		t.Fatal(err)
	}
	if status != "accepted" {
		t.Fatalf("status = %s", status)
	}
	var delivered bool
	var body string
	var follow string
	superRow(t, `
		SELECT st_delivered, body FROM vc.inbox_event
		 WHERE owner_user_id = 1 AND event_id = 'w10-t3-ack'`, nil, &delivered, &body)
	superRow(t, `SELECT status FROM vc.follow_up WHERE owner_user_id = 1 AND event_id = 'w10-t3-ack'`, nil, &follow)
	if delivered || body != "ack greeting" || follow != "BODY_READY" {
		t.Fatalf("delivered=%v body=%s follow=%s", delivered, body, follow)
	}
	failed := seedNotification(t, 1, 10, "w10-t3-fail", "fail greeting", "EMAIL", "owner@example.test", true)
	if _, err := testEnv.store.RecordNotificationOutcome(ctx, 1, failed, "failed", "SMTP_REJECTED", ""); err != nil {
		t.Fatal(err)
	}
	var still string
	superRow(t, `SELECT body FROM vc.inbox_event WHERE owner_user_id = 1 AND event_id = 'w10-t3-fail'`, nil, &still)
	if still != "fail greeting" {
		t.Fatalf("failure removed the inbox body %q", still)
	}
}

func TestNotificationLoadOmitsCredentialAndDeletionSkipsList(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	conv := seedFollowUp(t, 1, 10, "w10-t3-load", "load greeting")
	putChannel(t, 1, 10, "EMAIL", "owner@example.test", "enc2:default:1:w10plantedsmtp", true, false)
	recordPush(t, 1, true)
	createInbox(t, 1, "w10-t3-load", conv)
	created, err := testEnv.store.CreateNotificationDeliveries(ctx, 1, "w10-t3-load")
	if err != nil {
		t.Fatal(err)
	}
	var def string
	superRow(t, `SELECT pg_get_functiondef('vc.load_notification_delivery(bigint,bigint,timestamptz)'::regprocedure)`, nil, &def)
	if strings.Contains(def, "credential") {
		t.Fatal("load function reads a credential")
	}
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	row, err := testEnv.store.LoadNotificationDelivery(ctx, 1, created[0].ID, now)
	if err != nil {
		t.Fatal(err)
	}
	if row.ConfiguredTarget != "owner@example.test" || row.Body == nil || *row.Body != "load greeting" || row.STDelivered {
		t.Fatalf("loaded = %+v", row)
	}
	due, err := testEnv.store.ListDueNotificationDeliveries(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if !containsDue(due, 1, created[0].ID) {
		t.Fatalf("due = %+v", due)
	}
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
		VALUES (1, '0000000000000000000000000000000000000000000000000000000000000001', 'REQUESTED')`); err != nil {
		t.Fatal(err)
	}
	due, err = testEnv.store.ListDueNotificationDeliveries(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	if containsDue(due, 1, created[0].ID) {
		t.Fatal("deletion intent stayed in the due list")
	}
	var pending string
	superRow(t, `SELECT status FROM vc.notification_delivery WHERE owner_user_id = 1 AND id = $1`, []any{created[0].ID}, &pending)
	if pending != "pending" {
		t.Fatalf("deletion rewrote the delivery to %s", pending)
	}
}

func seedNotification(t *testing.T, owner, relationship int64, eventID, greeting, channel, target string, enabled bool) int64 {
	t.Helper()
	conv := seedFollowUp(t, owner, relationship, eventID, greeting)
	putChannel(t, owner, relationship, channel, target, "", enabled, false)
	recordPush(t, owner, true)
	createInbox(t, owner, eventID, conv)
	got, err := testEnv.store.CreateNotificationDeliveries(context.Background(), owner, eventID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("deliveries = %+v", got)
	}
	return got[0].ID
}

func seedFollowUp(t *testing.T, owner, relationship int64, eventID, greeting string) int64 {
	t.Helper()
	ctx := context.Background()
	conv, err := testEnv.store.CreateConversation(ctx, owner, relationship, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.follow_up(
			owner_user_id, id, relationship_id, body, status, normalization_status,
			event_id, deliverable, greeting_body, generation_outcome)
		VALUES ($1, nextval('vc.follow_up_id_seq'), $2, $3, 'BODY_READY', 'none',
			$4, 'DELIVERABLE', $5, 'BODY_READY')`,
		owner, relationship, "topic "+eventID, eventID, greeting); err != nil {
		t.Fatal(err)
	}
	return conv
}

func putChannel(t *testing.T, owner, relationship int64, channel, target, credential string, enabled, preview bool) {
	t.Helper()
	var cred any
	if credential != "" {
		cred = credential
	}
	err := testEnv.store.WithOwner(context.Background(), owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.put_notification_channel($1,$2,$3,$4,$5,$6,$7)`,
			owner, channel, enabled, target, cred, preview, []int64{relationship})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

func recordPush(t *testing.T, owner int64, granted bool) {
	t.Helper()
	if _, err := testEnv.store.RecordConsent(context.Background(), owner, "PUSH_NOTIFICATION", "w10-t3", granted); err != nil {
		t.Fatal(err)
	}
}

func createInbox(t *testing.T, owner int64, eventID string, conversationID int64) {
	t.Helper()
	err := testEnv.store.WithOwner(context.Background(), owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		return tx.QueryRow(ctx, `SELECT vc.create_inbox_event($1,$2,$3,$4,$5,$6)`,
			owner, eventID, conversationID, "main", int64(1), nil).Scan(&id)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func containsDue(rows []NotificationDue, owner, id int64) bool {
	for _, row := range rows {
		if row.OwnerID == owner && row.ID == id {
			return true
		}
	}
	return false
}

func superRow(t *testing.T, query string, args []any, dest ...any) {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.QueryRow(ctx, query, args...).Scan(dest...); err != nil {
		t.Fatal(err)
	}
}
