//go:build integration

package jobs

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// A process that exits after the row is marked sending, and before the
// channel outcome is recorded, must not leave the row sending. Recovery
// records unknown: the peer may already have the message, so the row is
// not put back to pending and the sender is not called again. A sending
// row still inside the channel timeout stays sending. Another owner's
// rows are not rewritten except by that same age rule on their own ids.
func TestNotificationSendingCrashBecomesUnknownWithoutResend(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	cipher, err := postgres.NewDefaultFieldCipher("ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=")
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(cipher)
	t.Cleanup(func() { store.UseCipher(nil) })
	if err := postgres.IsolationSuperExec(ctx, `DELETE FROM vc.proactive_policy WHERE owner_user_id IN (1, 2)`); err != nil {
		t.Fatal(err)
	}

	stale := claimSendingDelivery(t, store, 1, 10, "fu-w16e-stale", "stale@example.test")
	fresh := claimSendingDelivery(t, store, 1, 10, "fu-w16e-fresh", "stale@example.test")
	otherStale := claimSendingDelivery(t, store, 2, 20, "fu-w16e-other-stale", "other@example.test")
	otherFresh := claimSendingDelivery(t, store, 2, 20, "fu-w16e-other-fresh", "other@example.test")
	ageSending(t, 1, stale)
	ageSending(t, 2, otherStale)

	sender := &countSender{}
	var buf bytes.Buffer
	loop := w16Loop(store)
	loop.log = slog.New(slog.NewTextHandler(&buf, nil))
	loop.UseNotification(sender, MaxNotificationAttempts)
	if err := loop.RecoverOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if got := deliveryState(t, 1, stale); got != "unknown:1::true:1" {
		t.Fatalf("stale %s", got)
	}
	if got := deliveryState(t, 1, fresh); got != "sending:0::true:1" {
		t.Fatalf("fresh %s", got)
	}
	if got := deliveryState(t, 2, otherStale); got != "unknown:1::true:2" {
		t.Fatalf("other stale %s", got)
	}
	if got := deliveryState(t, 2, otherFresh); got != "sending:0::true:2" {
		t.Fatalf("other fresh %s", got)
	}
	if sender.n != 0 {
		t.Fatalf("sender calls %d", sender.n)
	}
	logText := buf.String()
	if !strings.Contains(logText, "decision_code=NOTIFICATION_SENDING_UNKNOWN") {
		t.Fatalf("log %s", logText)
	}
	if strings.Contains(logText, "下周见") || strings.Contains(logText, "planted-pass") || strings.Contains(logText, "stale@example.test") || strings.Contains(logText, "other@example.test") {
		t.Fatalf("log leaked %s", logText)
	}
	if err := store.ScheduleNotificationDelivery(ctx, 1, stale, 1, time.Now().Add(time.Hour)); err == nil {
		t.Fatal("unknown was scheduled back to pending")
	}
	if got := deliveryState(t, 1, stale); got != "unknown:1::true:1" {
		t.Fatalf("after schedule %s", got)
	}
	own, err := store.ListNotificationDeliveries(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(own) != 2 {
		t.Fatalf("owner 1 rows %d", len(own))
	}
	for _, row := range own {
		if row.EventID == "fu-w16e-other-stale" || row.EventID == "fu-w16e-other-fresh" {
			t.Fatalf("owner 1 saw %s", row.EventID)
		}
	}
	other, err := store.ListNotificationDeliveries(ctx, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(other) != 2 {
		t.Fatalf("owner 2 rows %d", len(other))
	}
	for _, row := range other {
		if row.EventID == "fu-w16e-stale" || row.EventID == "fu-w16e-fresh" {
			t.Fatalf("owner 2 saw %s", row.EventID)
		}
	}
	if err := loop.RecoverOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if sender.n != 0 {
		t.Fatalf("sender calls after second recover %d", sender.n)
	}
	if got := deliveryState(t, 1, stale); got != "unknown:1::true:1" {
		t.Fatalf("second recover %s", got)
	}
	if got := deliveryState(t, 1, fresh); got != "sending:0::true:1" {
		t.Fatalf("fresh after second recover %s", got)
	}
}

func claimSendingDelivery(t *testing.T, store *postgres.Store, owner, relationship int64, eventID, target string) int64 {
	t.Helper()
	ctx := context.Background()
	conv, err := store.CreateConversation(ctx, owner, relationship, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.follow_up(
			owner_user_id, id, relationship_id, body, status, normalization_status,
			event_id, deliverable, greeting_body, generation_outcome)
		VALUES ($1, nextval('vc.follow_up_id_seq'), $2, 'topic', 'BODY_READY', 'none',
			$3, 'DELIVERABLE', '下周见', 'BODY_READY')`, owner, relationship, eventID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutNotificationChannel(ctx, owner, postgres.NotificationChannelInput{
		Channel: "EMAIL", Enabled: true, ConfiguredTarget: target,
		PreviewBody: false, RelationshipIDs: []int64{relationship},
		CredentialMode: "set", CredentialPlain: "mailer\nplanted-pass",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordConsent(ctx, owner, "PUSH_NOTIFICATION", "w16e-sending", true); err != nil {
		t.Fatal(err)
	}
	rev := int64(1)
	if _, err := store.CreateInboxEvent(ctx, owner, conv, eventID, "main", &rev, nil); err != nil {
		t.Fatal(err)
	}
	got, err := store.CreateNotificationDeliveries(ctx, owner, eventID)
	if err != nil || len(got) != 1 {
		t.Fatalf("deliveries %+v %v", got, err)
	}
	decision, err := store.ClaimNotificationSend(ctx, owner, got[0].ID, time.Now())
	if err != nil || decision.Action != postgres.NotificationSend {
		t.Fatalf("claim %s %+v %v", eventID, decision, err)
	}
	if status := deliveryState(t, owner, got[0].ID); status != "sending:0::true:"+itoa(owner) {
		t.Fatalf("claimed %s %s", eventID, status)
	}
	return got[0].ID
}

func ageSending(t *testing.T, owner, id int64) {
	t.Helper()
	if err := postgres.IsolationSuperExec(context.Background(), `
		UPDATE vc.notification_delivery
		   SET updated_at = clock_timestamp() - interval '2 minutes'
		 WHERE owner_user_id = $1 AND id = $2 AND status = 'sending'`, owner, id); err != nil {
		t.Fatal(err)
	}
	if got := deliveryState(t, owner, id); got != "sending:0::true:"+itoa(owner) {
		t.Fatalf("aged %s", got)
	}
}

func deliveryState(t *testing.T, owner, id int64) string {
	t.Helper()
	return w16Count(t, `SELECT status || ':' || attempt_count::text || ':' || coalesce(failure_code, '') || ':' || (next_attempt_at IS NULL)::text || ':' || owner_user_id::text FROM vc.notification_delivery WHERE owner_user_id = `+itoa(owner)+` AND id = `+itoa(id))
}
