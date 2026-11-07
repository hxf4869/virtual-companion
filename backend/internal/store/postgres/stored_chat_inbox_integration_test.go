//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func storedInboxFixture(t *testing.T) (StoredChat, InboxEvent) {
	t.Helper()
	event := seedBodyInbox(t)
	s, ctx := testEnv.store, t.Context()
	cipher, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	s.UseCipher(cipher)
	t.Cleanup(func() { s.UseCipher(nil) })
	if _, err = psqlSuper(`INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
 VALUES(1,'sx-inbox-one','fixture','USER','ACTIVE','synthetic'),(2,'sx-inbox-two','fixture','USER','ACTIVE','synthetic')
 ON CONFLICT(id) DO UPDATE SET status='ACTIVE';
 INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2),(2,'GO',2);`); err != nil {
		t.Fatal(err)
	}
	header, _ := s.encodeChatJSON(ChatData{})
	metadata, _ := s.encodeChatJSON(ChatData{})
	var chat StoredChat
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var id, character string
		if err := tx.QueryRow(ctx, `SELECT c.st_chat_identity,r.st_character_ref FROM vc.conversation c JOIN vc.relationship r
 ON(c.owner_user_id,c.relationship_id)=(r.owner_user_id,r.id) WHERE c.owner_user_id=1 AND c.id=$1`, event.ConversationID).Scan(&id, &character); err != nil {
			return err
		}
		var err error
		chat, err = s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.insert_stored_chat(1,$1,'SINGLE',$2,$3,$4,NULL,$1,'synthetic',$5,$6)`,
			id, event.ConversationID, event.RelationshipID, character, header, metadata), 2)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return chat, event
}

func TestStoredChatSX5InboxDedupeAndDeletion(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	claim, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	var results [2]stsource.InboxDeliveryResult
	var failures [2]error
	var group sync.WaitGroup
	for i := range results {
		group.Go(func() {
			results[i], failures[i] = s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
		})
	}
	group.Wait()
	if failures[0] != nil || failures[1] != nil {
		t.Fatalf("delivery errors: %v / %v", failures[0], failures[1])
	}
	saves := 0
	for _, result := range results {
		if result.Saved {
			saves++
		}
		if !result.Associated || !result.Acked || result.Readback == nil || result.LinkStatus != "present" {
			t.Fatal("delivery returned no durable readback")
		}
	}
	if saves != 1 || results[0].Readback.MessageID != results[1].Readback.MessageID {
		t.Fatal("concurrent inbox delivery duplicated the event")
	}
	readback := results[0].Readback
	if _, err = s.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, readback.MessageID, readback.MessageRevision); err != nil {
		t.Fatal(err)
	}
	message, err := s.GetStoredMessage(ctx, 1, chat.ChatID, readback.MessageID)
	if err != nil || len(message.Candidates) != 1 || asChatData(asChatData(message.Data["extra"])["vc_source"])["inbox_event_id"] != event.EventID {
		t.Fatal("readback did not bind the persisted event source")
	}
	target, _ := json.Marshal(ChatData{"messageId": readback.MessageID})
	_, err = s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, ChatOperationsRequest{RequestID: chatUUID(), AuthorityEpoch: 2,
		Operations: []ChatOperation{{Kind: "delete", Target: target, Preconditions: json.RawMessage(`{"messageRevision":"1"}`), Payload: json.RawMessage("null")}}})
	if err != nil {
		t.Fatal(err)
	}
	claim, err = s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	removed, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
	if err != nil || removed.Saved || removed.Acked || removed.LinkStatus != "removed" {
		t.Fatalf("removed event was redelivered: %v", err)
	}
	page, err := s.ListStoredMessages(ctx, 1, chat.ChatID, ChatMessageQuery{})
	if err != nil || len(page.Items) != 0 {
		t.Fatal("removed inbox message reappeared")
	}
	if _, err = s.DeliverStoredInbox(ctx, 2, chat.ChatID, event.EventID, claim.LeaseToken); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign inbox result: %v", err)
	}
}

func TestStoredChatSX5InboxLeaseAndBranch(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	if _, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, "synthetic-missing"); !errors.Is(err, ErrInboxLeaseRejected) {
		t.Fatalf("missing lease: %v", err)
	}
	claim, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event SET branch='synthetic-other-branch' WHERE owner_user_id=1 AND event_id=$1`, event.EventID); err != nil {
		t.Fatal(err)
	}
	result, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
	if err != nil || result.Saved || result.LinkStatus != "invalidated" {
		t.Fatalf("old branch delivery: %v", err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.inbox_event SET branch=$2,lease_expires_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=1 AND event_id=$1`, event.EventID, chat.BranchRoot); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken); !errors.Is(err, ErrInboxLeaseRejected) {
		t.Fatalf("expired lease: %v", err)
	}
	page, err := s.ListStoredMessages(ctx, 1, chat.ChatID, ChatMessageQuery{})
	if err != nil || len(page.Items) != 0 || page.Revision != chat.Revision {
		t.Fatal("refused delivery changed chat state")
	}
}

func TestStoredChatSX5BindingCompatibleWithForeignKeyLock(t *testing.T) {
	_ = storedChatFixture(t)
	ctx := t.Context()
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT 1 FROM vc.vc_user WHERE id=1 FOR KEY SHARE`); err != nil {
		t.Fatal(err)
	}
	bounded, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	character := "synthetic-binding-lock"
	_, err = testEnv.store.CreateStoredChat(bounded, 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "SINGLE", CharacterRef: &character, Mode: "COMPANION"})
	if err != nil {
		t.Fatalf("binding upgraded owner lock against a foreign-key reader: %v", err)
	}
}
