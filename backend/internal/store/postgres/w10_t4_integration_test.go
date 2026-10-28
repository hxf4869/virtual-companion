//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
)

func TestNotificationLoadUsesItsOwnLimitAndConversation(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	id := seedNotification(t, 1, 10, "w10-t4-limit", "w10 limit greeting", "EMAIL", "owner@example.test", true)
	row, err := testEnv.store.LoadNotificationDelivery(ctx, 1, id, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if row.DailyLimit != DefaultNotificationDailyLimit || row.ConversationID == 0 {
		t.Fatalf("limit=%d conversation=%d", row.DailyLimit, row.ConversationID)
	}
}

func TestNotificationCredentialRoundTripStaysOutOfExport(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	cipher, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseCipher(cipher)
	t.Cleanup(func() {
		testEnv.store.UseCipher(nil)
		testEnv.store.UseSTDataClient(nil)
	})
	installRightsEngine(t, testEnv.store)
	testEnv.store.UseSTDataClient(&testSTData{})
	const secret = "w10t4plantedsecret"
	id := seedNotification(t, 1, 10, "w10-t4-secret", "w10 export greeting", "EMAIL", "owner@example.test", true)
	if _, err := testEnv.store.PutNotificationChannel(ctx, 1, NotificationChannelInput{
		Channel: "EMAIL", Enabled: true, ConfiguredTarget: "owner@example.test",
		PreviewBody: false, RelationshipIDs: []int64{10},
		CredentialMode: "set", CredentialPlain: "mailer\n" + secret,
	}); err != nil {
		t.Fatal(err)
	}
	plain, err := testEnv.store.LoadNotificationCredential(ctx, 1, "EMAIL", "owner@example.test")
	if err != nil || plain != "mailer\n"+secret {
		t.Fatalf("plain=%q err=%v", plain, err)
	}
	if row, err := testEnv.store.LoadNotificationDelivery(ctx, 1, id, time.Now()); err != nil || row.DailyLimit != DefaultNotificationDailyLimit {
		t.Fatalf("loaded=%+v err=%v", row, err)
	}
	exported, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(exported)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if strings.Contains(text, secret) || strings.Contains(text, "credential") {
		t.Fatal("export included a credential")
	}
	counts := map[string]int{}
	for _, domain := range exported.Domains {
		counts[domain.System] = domain.Records
	}
	if counts["INBOX"] < 1 || counts["NOTIFICATION_CHANNELS"] < 1 || counts["NOTIFICATION_DELIVERIES"] < 1 {
		t.Fatalf("domains=%+v", exported.Domains)
	}
}

func TestNotificationClearWaitsForDeletionIntent(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	seedNotification(t, 1, 10, "w10-t4-clear", "w10 clear greeting", "EMAIL", "owner@example.test", true)
	done, err := testEnv.store.ClearNotificationDomain(ctx, 1)
	if err != nil || done {
		t.Fatalf("clear without intent done=%v err=%v", done, err)
	}
	var status string
	superRow(t, `SELECT status FROM vc.notification_delivery WHERE owner_user_id=1 AND event_id='w10-t4-clear'`, nil, &status)
	if status != "pending" {
		t.Fatalf("status=%s", status)
	}
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
		VALUES (1, '0000000000000000000000000000000000000000000000000000000000000001', 'REQUESTED')`); err != nil {
		t.Fatal(err)
	}
	done, err = testEnv.store.ClearNotificationDomain(ctx, 1)
	if err != nil || !done {
		t.Fatalf("clear notification done=%v err=%v", done, err)
	}
	var deliveries, channels, inbox int
	superRow(t, `SELECT count(*) FROM vc.notification_delivery WHERE owner_user_id=1`, nil, &deliveries)
	superRow(t, `SELECT count(*) FROM vc.notification_channel WHERE owner_user_id=1`, nil, &channels)
	superRow(t, `SELECT count(*) FROM vc.inbox_event WHERE owner_user_id=1 AND event_id='w10-t4-clear'`, nil, &inbox)
	if deliveries != 0 || channels != 0 || inbox != 1 {
		t.Fatalf("deliveries=%d channels=%d inbox=%d", deliveries, channels, inbox)
	}
	done, err = testEnv.store.ClearInboxDomain(ctx, 1)
	if err != nil || !done {
		t.Fatalf("clear inbox done=%v err=%v", done, err)
	}
	superRow(t, `SELECT count(*) FROM vc.inbox_event WHERE owner_user_id=1`, nil, &inbox)
	if inbox != 0 {
		t.Fatalf("inbox left=%d", inbox)
	}
}

func TestPushWithdrawalStopsUnsentDeliveries(t *testing.T) {
	resetFixtures(t)
	seedNotification(t, 1, 10, "w10-t4-consent", "w10 consent greeting", "EMAIL", "owner@example.test", true)
	if _, err := testEnv.store.RecordConsent(context.Background(), 1, "PUSH_NOTIFICATION", "w10-t4", false); err != nil {
		t.Fatal(err)
	}
	var status, reason string
	superRow(t, `
		SELECT status, stopped_reason FROM vc.notification_delivery
		 WHERE owner_user_id=1 AND event_id='w10-t4-consent'`, nil, &status, &reason)
	if status != "stopped" || reason != "consent_withdrawn" {
		t.Fatalf("status=%s reason=%s", status, reason)
	}
}

func TestReconcileChangesInboxLinkWithoutRedelivery(t *testing.T) {
	binding, snapshot, unavailable := sourceFixture(t)
	ctx := context.Background()
	const eventID = "w10-t4-link"
	seedFollowUp(t, 1, binding.RelationshipID, eventID, "w10 link greeting")
	if _, err := testEnv.store.CreateInboxEvent(ctx, 1, binding.ConversationID, eventID, "", nil, nil); err != nil {
		t.Fatal(err)
	}
	putChannel(t, 1, binding.RelationshipID, "EMAIL", "owner@example.test", "", true, false)
	recordPush(t, 1, true)
	if _, err := testEnv.store.CreateNotificationDeliveries(ctx, 1, eventID); err != nil {
		t.Fatal(err)
	}
	var before int
	superRow(t, `SELECT count(*) FROM vc.notification_delivery WHERE owner_user_id=1 AND event_id=$1`, []any{eventID}, &before)
	snapshot.Messages[0].InboxEventID = eventID
	claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, eventID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.AckInboxEvent(ctx, 1, eventID, claim.LeaseToken, sourceMessage, 1); err != nil {
		t.Fatal(err)
	}
	*unavailable = true
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	event, err := testEnv.store.GetInboxEvent(ctx, 1, eventID)
	if err != nil || event.LinkStatus != "present" {
		t.Fatalf("unavailable link=%s err=%v", event.LinkStatus, err)
	}
	*unavailable = false
	snapshot.Revision = 2
	snapshot.NotModified = false
	snapshot.Messages = []stsource.Message{}
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	event, err = testEnv.store.GetInboxEvent(ctx, 1, eventID)
	if err != nil || event.LinkStatus != "removed" {
		t.Fatalf("removed link=%s err=%v", event.LinkStatus, err)
	}
	var after int
	superRow(t, `SELECT count(*) FROM vc.notification_delivery WHERE owner_user_id=1 AND event_id=$1`, []any{eventID}, &after)
	if after != before || before != 1 {
		t.Fatalf("deliveries before=%d after=%d", before, after)
	}
}
