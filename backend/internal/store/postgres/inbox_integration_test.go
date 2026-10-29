//go:build integration

package postgres

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestInboxConcurrentClaimLetsOneWriter(t *testing.T) {
	event := seedBodyInbox(t)
	ctx := context.Background()
	start := make(chan struct{})
	var wg sync.WaitGroup
	type result struct {
		claim InboxClaim
		err   error
	}
	out := make([]result, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, event.EventID, 30)
			out[i] = result{claim, err}
		}(i)
	}
	close(start)
	wg.Wait()
	wins := 0
	for _, item := range out {
		if item.err == nil {
			wins++
			if item.claim.LeaseToken == "" || item.claim.LeaseExpiresAt.IsZero() {
				t.Fatalf("claim = %+v", item.claim)
			}
			continue
		}
		if !errors.Is(item.err, ErrInboxLeaseHeld) {
			t.Fatalf("loser = %v", item.err)
		}
	}
	if wins != 1 {
		t.Fatalf("wins = %d", wins)
	}
}

func TestInboxExpiredLeaseStopsAck(t *testing.T) {
	event := seedBodyInbox(t)
	ctx := context.Background()
	claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, event.EventID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE owner_user_id = 1 AND event_id = $1`, event.EventID); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, "01234567-89ab-4def-8abc-0123456789ab", 1); !errors.Is(err, ErrInboxLeaseRejected) {
		t.Fatalf("expired ack = %v", err)
	}
	row, err := testEnv.store.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.STDelivered || row.MessageID != nil {
		t.Fatalf("expired ack wrote the link: %+v", row)
	}
}

func TestInboxAckKeepsLinkPresent(t *testing.T) {
	event := seedBodyInbox(t)
	ctx := context.Background()
	claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, event.EventID, 30)
	if err != nil {
		t.Fatal(err)
	}
	messageID := "01234567-89ab-4def-8abc-0123456789ab"
	acked, err := testEnv.store.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, messageID, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !acked.STDelivered || acked.LinkStatus != "present" || acked.ReadAt != nil || acked.MessageID == nil || *acked.MessageID != messageID || acked.MessageRevision == nil || *acked.MessageRevision != 2 {
		t.Fatalf("ack = %+v", acked)
	}
	if _, err := testEnv.store.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, messageID, 2); !errors.Is(err, ErrInboxLeaseRejected) {
		t.Fatalf("second ack = %v", err)
	}
	again, err := testEnv.store.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil {
		t.Fatal(err)
	}
	if again.LinkStatus != "present" || !again.STDelivered {
		t.Fatalf("link changed after rejected ack: %+v", again)
	}
	if _, err := testEnv.store.GetInboxEvent(ctx, 2, event.EventID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross owner = %v", err)
	}
}

func TestInboxRemovedDoesNotCreateDelivery(t *testing.T) {
	event := seedBodyInbox(t)
	ctx := context.Background()
	claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, event.EventID, 30)
	if err != nil {
		t.Fatal(err)
	}
	messageID := "01234567-89ab-4def-8abc-0123456789ab"
	if _, err := testEnv.store.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, messageID, 2); err != nil {
		t.Fatal(err)
	}
	before := inboxDeliveryCount(t, 1, event.EventID)
	branch := ""
	if event.Branch != nil {
		branch = *event.Branch
	}
	updated, err := testEnv.store.ApplyInboxLink(ctx, 1, event.EventID, stsource.Snapshot{
		State: "PRESENT", BranchRoot: branch, Revision: 3,
		Messages: []stsource.Message{{MessageID: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", InboxEventID: "fu-other", Revision: 1, Role: "assistant"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.LinkStatus != "removed" || !updated.STDelivered || updated.MessageID == nil || *updated.MessageID != messageID {
		t.Fatalf("removed = %+v", updated)
	}
	if got := inboxDeliveryCount(t, 1, event.EventID); got != before {
		t.Fatalf("deliveries %d -> %d", before, got)
	}
	invalid, err := testEnv.store.ApplyInboxLink(ctx, 1, event.EventID, stsource.Snapshot{
		State: "PRESENT", BranchRoot: "other-branch", Revision: 4,
		Messages: []stsource.Message{{MessageID: messageID, InboxEventID: "fu-other", Revision: 1, Role: "assistant"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if invalid.LinkStatus != "invalidated" {
		t.Fatalf("invalidated = %+v", invalid)
	}
	if got := inboxDeliveryCount(t, 1, event.EventID); got != before {
		t.Fatalf("invalidated created deliveries %d -> %d", before, got)
	}
}

func TestInboxWaitingHostStoresIntentWithoutBody(t *testing.T) {
	event := seedWaitingInbox(t)
	if event.Intent != "WAITING_HOST" || event.Body != nil || event.STDelivered || event.LinkStatus != "present" {
		t.Fatalf("waiting = %+v", event)
	}
	ctx := context.Background()
	claim, err := testEnv.store.ClaimInboxEvent(ctx, 1, event.EventID, 30)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, "01234567-89ab-4def-8abc-0123456789ab", 1); !errors.Is(err, ErrInvalid) {
		t.Fatalf("waiting ack = %v", err)
	}
	row, err := testEnv.store.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil {
		t.Fatal(err)
	}
	if row.STDelivered || row.MessageID != nil || row.Body != nil {
		t.Fatalf("waiting host gained a message: %+v", row)
	}
	read, err := testEnv.store.MarkInboxRead(ctx, 1, event.EventID)
	if err != nil {
		t.Fatal(err)
	}
	if read.ReadAt == nil || read.STDelivered {
		t.Fatalf("read = %+v", read)
	}
}

func seedBodyInbox(t *testing.T) InboxEvent {
	t.Helper()
	return seedInbox(t, "BODY_READY", "BODY_READY", strPtr("下周见"))
}

func seedWaitingInbox(t *testing.T) InboxEvent {
	t.Helper()
	return seedInbox(t, "WAITING_HOST", "WAITING_HOST", nil)
}

func seedInbox(t *testing.T, outcome, reason string, greeting *string) InboxEvent {
	t.Helper()
	b, snapshots := stMemoryFixture(t)
	mem, _ := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if err := testEnv.store.FinishFollowUpGeneration(context.Background(), 1, row.ID, FollowUpGenerationFinish{
		Outcome: outcome, Reason: reason, Greeting: greeting,
	}); err != nil {
		t.Fatal(err)
	}
	event, err := testEnv.store.CreateInboxEvent(context.Background(), 1, b.ConversationID, row.EventID, b.ChatIdentity, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if event.EventID != row.EventID || event.ConversationID != b.ConversationID || !event.Persisted {
		t.Fatalf("created = %+v", event)
	}
	return event
}

func inboxDeliveryCount(t *testing.T, owner int64, eventID string) int {
	t.Helper()
	var n int
	err := testEnv.store.WithOwner(context.Background(), owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.notification_delivery WHERE owner_user_id = $1 AND event_id = $2`, owner, eventID).Scan(&n)
	})
	if err != nil {
		t.Fatal(err)
	}
	return n
}
