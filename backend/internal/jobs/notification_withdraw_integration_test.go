//go:build integration

package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/notify"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestNotificationWithdrawAfterLoadDoesNotSend(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	cipher, err := postgres.NewDefaultFieldCipher("ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=")
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(cipher)
	t.Cleanup(func() { store.UseCipher(nil) })
	id := seedW16Delivery(t, store, "fu-w16e-revoke")
	sender := &countSender{}
	revoked := false
	wrapped := &revokeAfterLoad{
		notificationStore: store,
		once: func() {
			if revoked {
				return
			}
			revoked = true
			if _, err := store.RecordConsent(ctx, 1, "PUSH_NOTIFICATION", "w16e-revoke", false); err != nil {
				t.Errorf("withdraw: %v", err)
			}
		},
	}
	if err := RunNotificationDeliveries(ctx, wrapped, sender, safety.New(), time.Now(), nil, MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.n != 0 {
		t.Fatalf("sent %d after withdrawal", sender.n)
	}
	status := w16Count(t, `SELECT status || ':' || coalesce(stopped_reason, '') FROM vc.notification_delivery WHERE owner_user_id = 1 AND id = `+itoa(id))
	if status != "stopped:consent_withdrawn" {
		t.Fatalf("delivery %s", status)
	}
}

func TestNotificationSendClaimsBeforeSender(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	cipher, err := postgres.NewDefaultFieldCipher("ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=")
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(cipher)
	t.Cleanup(func() { store.UseCipher(nil) })
	id := seedW16Delivery(t, store, "fu-w16e-send")
	sender := &countSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(ctx, store, sender, safety.New(), time.Now(), nil, MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.n != 1 {
		t.Fatalf("sends %d", sender.n)
	}
	if got := w16Count(t, `SELECT status FROM vc.notification_delivery WHERE owner_user_id = 1 AND id = `+itoa(id)); got != "accepted" {
		t.Fatalf("status %s", got)
	}
}

func seedW16Delivery(t *testing.T, store *postgres.Store, eventID string) int64 {
	t.Helper()
	ctx := context.Background()
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.follow_up(
			owner_user_id, id, relationship_id, body, status, normalization_status,
			event_id, deliverable, greeting_body, generation_outcome)
		VALUES (1, nextval('vc.follow_up_id_seq'), 10, 'topic', 'BODY_READY', 'none',
			$1, 'DELIVERABLE', '下周见', 'BODY_READY')`, eventID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.PutNotificationChannel(ctx, 1, postgres.NotificationChannelInput{
		Channel: "EMAIL", Enabled: true, ConfiguredTarget: "owner@example.test",
		PreviewBody: false, RelationshipIDs: []int64{10},
		CredentialMode: "set", CredentialPlain: "mailer\nplanted-pass",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordConsent(ctx, 1, "PUSH_NOTIFICATION", "w16e", true); err != nil {
		t.Fatal(err)
	}
	rev := int64(1)
	if _, err := store.CreateInboxEvent(ctx, 1, conv, eventID, "main", &rev, nil); err != nil {
		t.Fatal(err)
	}
	got, err := store.CreateNotificationDeliveries(ctx, 1, eventID)
	if err != nil || len(got) != 1 {
		t.Fatalf("deliveries %+v %v", got, err)
	}
	return got[0].ID
}

type revokeAfterLoad struct {
	notificationStore
	once func()
}

func (r *revokeAfterLoad) LoadNotificationDelivery(ctx context.Context, owner, id int64, now time.Time) (postgres.NotificationDelivery, error) {
	row, err := r.notificationStore.LoadNotificationDelivery(ctx, owner, id, now)
	if r.once != nil {
		r.once()
		r.once = nil
	}
	return row, err
}

type countSender struct {
	n    int
	kind string
}

func (s *countSender) Send(context.Context, notify.Request) (notify.Result, error) {
	s.n++
	kind := s.kind
	if kind == "" {
		kind = notify.KindAccepted
	}
	return notify.Result{Kind: kind, Correlation: "w16e-test"}, nil
}
