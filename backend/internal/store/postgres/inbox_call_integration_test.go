//go:build integration

package postgres

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/proactive"
)

func TestProactiveInboxCallRetainsD2NotificationOnExpiry(t *testing.T) {
	binding, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	store := testEnv.store
	at := time.Date(2026, 11, 2, 10, 0, 0, 0, time.UTC)
	topic := "周末旅行路线还没聊完，回头接着说"
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, topic, at)
	if _, err := store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	if err := store.ObserveCompanionUserText(ctx, 1, binding.RelationshipID, ref, topic, at); err != nil {
		t.Fatal(err)
	}
	plan := proactive.Plan{
		Trigger:  proactive.Trigger{Key: "call", Kind: proactive.KindCall, Cluster: "topic"},
		TopicRef: ref,
		SendAt:   at.Add(3 * time.Hour),
		ArmedAt:  at,
	}
	const opening = "合成来电开场"
	if err := store.SaveProactivePlan(ctx, 1, binding.RelationshipID, plan, opening, at); err != nil {
		t.Fatal(err)
	}
	eventID, delivered, err := store.DeliverDueProactive(ctx, 1, binding.RelationshipID, plan.SendAt, FollowUpGenerationFinish{}, nil, true)
	if err != nil || !delivered || eventID == "" {
		t.Fatalf("file call: delivered=%v err=%v", delivered, err)
	}
	event, err := store.GetInboxEvent(ctx, 1, eventID)
	if err != nil || event.Call == nil || event.Call.State != "RINGING" || event.Call.ExpiresAt.IsZero() || event.STDelivered || event.ReadAt != nil {
		t.Fatalf("ringing call: %+v err=%v", event, err)
	}
	putChannel(t, 1, binding.RelationshipID, "EMAIL", "owner@example.test", "", true, false)
	putChannel(t, 1, binding.RelationshipID, "FEISHU", "group-call", "", true, false)
	recordPush(t, 1, true)

	deliveries, err := store.CreateNotificationDeliveries(ctx, 1, eventID)
	if err != nil || len(deliveries) != 2 || deliveries[0].Channel != "EMAIL" || deliveries[1].Channel != "FEISHU" {
		t.Fatalf("ringing call channel deliveries: %v err=%v", deliveries, err)
	}
	for _, delivery := range deliveries {
		row, err := store.LoadNotificationDelivery(ctx, 1, delivery.ID, at)
		if err != nil || row.EventID != eventID || row.Status != "pending" || row.Preview {
			t.Fatalf("protected call delivery: event=%s status=%s preview=%v err=%v", row.EventID, row.Status, row.Preview, err)
		}
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event
		SET call_expires_at=clock_timestamp()-interval '1 second'
		WHERE owner_user_id=1 AND event_id=$1`, eventID); err != nil {
		t.Fatal(err)
	}
	event, err = store.GetInboxEvent(ctx, 1, eventID)
	if err != nil || event.Call == nil || event.Call.State != "MISSED" || event.Body == nil || *event.Body != opening {
		t.Fatalf("expired voicemail: %+v err=%v", event, err)
	}
	event, applied, err := store.RespondInboxCall(ctx, 1, eventID, "ANSWER", "01234567-89ab-4def-8abc-0123456789ab")
	if err != nil || applied || event.Call == nil || event.Call.State != "MISSED" || event.ReadAt != nil {
		t.Fatalf("late response: applied=%v event=%+v err=%v", applied, event, err)
	}
	if got, err := store.CreateNotificationDeliveries(ctx, 1, eventID); err != nil || !slices.Equal(got, deliveries) {
		t.Fatalf("missed call channel deliveries changed: before=%v after=%v err=%v", deliveries, got, err)
	}
	if got, err := store.ListNotificationDeliveries(ctx, 1); err != nil || len(got) != len(deliveries) {
		t.Fatalf("persisted delivery count=%d err=%v", len(got), err)
	}
}
