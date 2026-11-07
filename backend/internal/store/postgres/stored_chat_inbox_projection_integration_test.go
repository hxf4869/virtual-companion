//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type projectedInboxSTBridge struct {
	reads, deliveries int
	afterRead         func(context.Context)
}

func (b *projectedInboxSTBridge) Read(ctx context.Context, _ int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
	b.reads++
	if b.afterRead != nil {
		b.afterRead(ctx)
	}
	return []stsource.Snapshot{{ChatIdentity: queries[0].ChatIdentity, State: "PRESENT", Location: "chats/synthetic.jsonl"}}, nil
}

func (b *projectedInboxSTBridge) DeliverInbox(_ context.Context, req stsource.InboxDeliveryRequest) (stsource.InboxDeliveryResult, error) {
	b.deliveries++
	return stsource.InboxDeliveryResult{
		Acked: true,
		Readback: &stsource.InboxReadback{
			EventID: req.Event.EventID, MessageID: sourceMessage, MessageRevision: 1,
		},
	}, nil
}

func TestStoredChatSX7InboxProjectionGo(t *testing.T) {
	for _, name := range []string{"with legacy bridge", "without legacy bridge"} {
		t.Run(name, func(t *testing.T) {
			chat, event := storedInboxFixture(t)
			s, ctx := testEnv.store, t.Context()
			bridge := &projectedInboxSTBridge{}
			s.UseSTSourceReader(nil)
			if name == "with legacy bridge" {
				s.UseSTSourceReader(bridge)
			}

			if err := s.ProjectInbox(ctx); err != nil {
				t.Fatal(err)
			}
			if bridge.reads != 0 || bridge.deliveries != 0 {
				t.Errorf("Go projection called legacy bridge: %d reads, %d deliveries", bridge.reads, bridge.deliveries)
			}
			assertProjectedInbox(t, chat, event, "", chat.Revision+1)
		})
	}
}

func TestStoredChatSX7InboxProjectionLostAck(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	s.UseSTSourceReader(nil)

	claim, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
	if err != nil || !saved.Saved || saved.Readback == nil {
		t.Fatalf("initial committed delivery failed: %v", err)
	}

	// The saved message is durable, but the worker dies before acknowledging it.
	if err := s.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	pending, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || pending.STDelivered {
		t.Fatalf("the worker took over an active lease: %v", err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event SET lease_expires_at=clock_timestamp()-interval '1 second'
 WHERE owner_user_id=1 AND event_id=$1`, event.EventID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := s.ProjectInbox(ctx); err != nil {
			t.Fatal(err)
		}
		assertProjectedInbox(t, chat, event, saved.Readback.MessageID, saved.Readback.ChatRevision)
	}
}

func TestStoredChatSX7InboxProjectionInvalidated(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	s.UseSTSourceReader(nil)
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event SET link_status='invalidated'
 WHERE owner_user_id=1 AND event_id=$1`, event.EventID); err != nil {
		t.Fatal(err)
	}
	if err := s.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	page, err := s.ListStoredMessages(ctx, 1, chat.ChatID, ChatMessageQuery{})
	if err != nil || len(page.Items) != 0 || page.Revision != chat.Revision {
		t.Fatalf("projection changed the chat for an invalidated event: %v", err)
	}
	if _, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60); err != nil {
		t.Fatalf("projection claimed an invalidated event: %v", err)
	}
}

func TestStoredChatSX7InboxProjectionFrozen(t *testing.T) {
	_, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	bridge := &projectedInboxSTBridge{}
	s.UseSTSourceReader(bridge)
	if err := IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='FROZEN' WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}

	if err := s.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	if bridge.reads != 0 || bridge.deliveries != 0 {
		t.Errorf("frozen projection called legacy bridge: %d reads, %d deliveries", bridge.reads, bridge.deliveries)
	}
	pending, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || pending.STDelivered || pending.MessageID != nil {
		t.Fatalf("frozen projection acknowledged a delivery: %v", err)
	}

	if err := IsolationSuperExec(ctx, `DELETE FROM vc.chat_authority WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	if err := s.ProjectInbox(ctx); err != nil {
		t.Fatal(err)
	}
	acked, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || !acked.STDelivered || acked.MessageID == nil || *acked.MessageID != sourceMessage ||
		bridge.reads != 1 || bridge.deliveries != 1 {
		t.Fatalf("legacy projection did not resume and acknowledge: %v", err)
	}
}

func TestStoredChatSX7InboxProjectionAuthorityUnavailable(t *testing.T) {
	storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	bridge := &projectedInboxSTBridge{}
	s.UseSTSourceReader(bridge)
	if err := IsolationSuperExec(ctx, `REVOKE SELECT ON vc.chat_authority FROM vc_api,vc_worker`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := IsolationSuperExec(context.Background(), `GRANT SELECT ON vc.chat_authority TO vc_api,vc_worker`); err != nil {
			t.Error(err)
		}
	})

	if err := s.ProjectInbox(ctx); !errors.Is(err, errStore) {
		t.Errorf("expected authority query error, got %v", err)
	}
	if bridge.reads != 0 || bridge.deliveries != 0 {
		t.Errorf("projection called legacy bridge after query failure: %d reads, %d deliveries", bridge.reads, bridge.deliveries)
	}
}

func TestStoredChatSX7InboxProjectionChangesDuringLegacyRead(t *testing.T) {
	for _, mode := range []string{"FROZEN", "ST"} {
		t.Run(mode, func(t *testing.T) {
			_, event := storedInboxFixture(t)
			s, ctx := testEnv.store, t.Context()
			if err := IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=1`); err != nil {
				t.Fatal(err)
			}
			bridge := &projectedInboxSTBridge{afterRead: func(ctx context.Context) {
				if err := IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority=$1,epoch=epoch+1 WHERE owner_user_id=1`, mode); err != nil {
					t.Fatal(err)
				}
			}}
			s.UseSTSourceReader(bridge)

			if err := s.ProjectInbox(ctx); err != nil {
				t.Fatal(err)
			}
			if bridge.reads != 1 || bridge.deliveries != 0 {
				t.Errorf("expected one legacy read and no delivery: %d reads, %d deliveries", bridge.reads, bridge.deliveries)
			}
			pending, err := s.GetInboxEvent(ctx, 1, event.EventID)
			if err != nil || pending.STDelivered || pending.MessageID != nil {
				t.Fatalf("projection acknowledged after the authority froze: %v", err)
			}

		})
	}
}

func assertProjectedInbox(t *testing.T, chat StoredChat, event InboxEvent, wantMessageID string, wantRevision int64) {
	t.Helper()
	s, ctx := testEnv.store, t.Context()
	page, err := s.ListStoredMessages(ctx, 1, chat.ChatID, ChatMessageQuery{})
	if err != nil || len(page.Items) != 1 || page.Revision != wantRevision {
		t.Fatalf("projection must append exactly once: got %d messages at revision %d, err %v", len(page.Items), page.Revision, err)
	}
	messageID := page.Items[0].MessageID
	if wantMessageID != "" && wantMessageID != messageID {
		t.Fatal("projection replaced the committed message")
	}
	acked, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || !acked.STDelivered || acked.MessageID == nil || *acked.MessageID != messageID {
		t.Fatalf("projection did not acknowledge the committed Go message: %v", err)
	}
}
