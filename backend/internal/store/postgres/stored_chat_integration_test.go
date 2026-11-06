//go:build integration

package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func storedChatFixture(t *testing.T) StoredChat {
	t.Helper()
	resetFixtures(t)
	cipher, err := NewDefaultFieldCipher(isoRestKeyForStore())
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseCipher(cipher)
	t.Cleanup(func() { testEnv.store.UseCipher(nil) })
	if _, err := psqlSuper(`INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES(1,'sx-one','fixture','USER','ACTIVE','synthetic'),(2,'sx-two','fixture','USER','ACTIVE','synthetic')
 ON CONFLICT(id) DO UPDATE SET status='ACTIVE';
 INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2),(2,'GO',2);`); err != nil {
		t.Fatal(err)
	}
	group := "synthetic-group"
	c, err := testEnv.store.CreateStoredChat(context.Background(), 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group, Title: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}
func expectChatCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *ChatError
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("error=%v want %s", err, code)
	}
}
func TestStoredChatAuthorityReceiptsAndRollback(t *testing.T) {
	c := storedChatFixture(t)
	ctx := context.Background()
	s := testEnv.store
	group := "synthetic"
	in := ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "GROUP", GroupRef: &group}
	first, err := s.CreateStoredChat(ctx, 1, in)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.CreateStoredChat(ctx, 1, in)
	if err != nil || again.ChatID != first.ChatID {
		t.Fatalf("replay: %v", err)
	}
	in.RequestID = strings.ToUpper(in.RequestID)
	again, err = s.CreateStoredChat(ctx, 1, in)
	if err != nil || again.ChatID != first.ChatID {
		t.Fatalf("UUID canonical replay: %v", err)
	}
	in.Title = "different"
	_, err = s.CreateStoredChat(ctx, 1, in)
	expectChatCode(t, err, "IDEMPOTENCY_KEY_REUSED")
	in.AuthorityEpoch = 1
	_, err = s.CreateStoredChat(ctx, 1, in)
	expectChatCode(t, err, "CHAT_AUTHORITY_CHANGED")
	in.AuthorityEpoch = 2
	in.Title = ""
	if _, err = psqlSuper(`UPDATE vc.chat_receipt SET expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateStoredChat(ctx, 1, in)
	expectChatCode(t, err, "OPERATION_RESULT_EXPIRED")
	if _, err = psqlSuper(`UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateStoredChat(ctx, 1, in)
	expectChatCode(t, err, "CHAT_AUTHORITY_CHANGED")
	if _, err = psqlSuper(`UPDATE vc.chat_authority SET authority='GO' WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	request := chatUUID()
	faultMessage, faultCandidate := chatUUID(), chatUUID()
	fault := errors.New("synthetic transaction fault")
	injected := false
	_, err = s.storedChatWrite(ctx, 1, "test rollback", request, 2, ChatData{}, func(ctx context.Context, tx pgx.Tx, op string, epoch int64) (chatWriteResult, error) {
		if err := s.insertStoredMessage(ctx, tx, 1, c.ChatID, StoredMessage{MessageID: faultMessage, Revision: 1, Position: "1", SelectedCandidateID: faultCandidate, Data: ChatData{}, Candidates: []StoredCandidate{{CandidateID: faultCandidate, SourceRevision: 1, SourceGeneration: 1, Data: ChatData{"mes": "synthetic rollback"}}}}, []byte{1}); err != nil {
			return chatWriteResult{}, err
		}
		if err := storeChatChange(ctx, tx, 1, c.ChatID, ChatChange{OperationID: op, Revision: 2}); err != nil {
			return chatWriteResult{}, err
		}
		injected = true
		return chatWriteResult{}, fault
	})
	if err == nil {
		t.Fatal("injected failure succeeded")
	}
	if !injected {
		t.Fatalf("transaction failed before injection: %v", err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var title string
		var count int
		if err := tx.QueryRow(ctx, `SELECT title FROM vc.stored_chat WHERE owner_user_id=1 AND chat_id=$1`, c.ChatID).Scan(&title); err != nil {
			return err
		}
		if title != c.Title {
			t.Fatal("data did not roll back")
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.stored_message WHERE owner_user_id=1 AND message_id=$1`, faultMessage).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("raw message survived rollback")
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.chat_change WHERE owner_user_id=1 AND chat_id=$1 AND revision=2`, c.ChatID).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("outbox did not roll back")
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.chat_receipt WHERE owner_user_id=1 AND request_id=$1`, request).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("receipt survived rollback")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestStoredMessageCandidateStorageAndIsolation(t *testing.T) {
	c := storedChatFixture(t)
	ctx := context.Background()
	s := testEnv.store
	mid, cid := chatUUID(), chatUUID()
	m := StoredMessage{MessageID: mid, Revision: 1, Position: "1", SelectedCandidateID: cid, Data: ChatData{"unknown": ChatData{"kept": true}}, Candidates: []StoredCandidate{
		{CandidateID: cid, SourceRevision: 7, SourceGeneration: 3, Data: ChatData{"mes": "synthetic first", "variables": ChatData{"state": "kept"}}},
		{CandidateID: chatUUID(), SourceRevision: 2, SourceGeneration: 1, Data: ChatData{"mes": "synthetic alternate", "extension": 42}},
	}}
	digest, _ := chatDigest(m)
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return s.insertStoredMessage(ctx, tx, 1, c.ChatID, m, digest)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var encrypted bool
		if err := tx.QueryRow(ctx, `SELECT data_cipher LIKE 'enc2:%' FROM vc.stored_message WHERE owner_user_id=1 AND chat_id=$1 AND message_id=$2`, c.ChatID, mid).Scan(&encrypted); err != nil {
			return err
		}
		if !encrypted {
			t.Fatal("raw message is not encrypted")
		}
		got, err := s.loadStoredMessage(ctx, tx, 1, c.ChatID, mid)
		if err != nil {
			return err
		}
		if got.CandidateCount != 2 || got.Candidates[0].SourceRevision != 7 || got.Candidates[0].SourceGeneration != 3 || got.Candidates[1].Data["mes"] != "synthetic alternate" || got.Data["unknown"] == nil {
			t.Fatal("lost candidate identity or unknown data")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.WithOwner(ctx, 2, func(ctx context.Context, tx pgx.Tx) error {
		_, err := s.loadStoredMessage(ctx, tx, 2, c.ChatID, mid)
		if !errors.Is(err, ErrNotFound) {
			t.Fatalf("foreign read=%v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestStoredChatExistingRightsEntrypoints(t *testing.T) {
	group := storedChatFixture(t)
	ctx := context.Background()
	s := testEnv.store
	if _, err := s.UpdateIncognitoPref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	card := "synthetic-card"
	in := ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "SINGLE", CharacterRef: &card, Mode: "COMPANION"}
	c, err := s.CreateStoredChat(ctx, 1, in)
	if err != nil {
		t.Fatal(err)
	}
	if c.ConversationID == nil || c.RelationshipID == nil {
		t.Fatal("SINGLE has no binding")
	}
	if end, err := s.EndConversation(ctx, 1, *c.ConversationID); err != nil || !end.IncognitoCleared {
		t.Fatalf("incognito end: %v", err)
	}
	if _, err = s.CreateStoredChat(ctx, 1, in); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ended incognito replay: %v", err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var leaked bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_receipt WHERE owner_user_id=1 AND chat_id=$1 AND result_cipher IS NOT NULL)`, c.ChatID).Scan(&leaked); err != nil {
			return err
		}
		if leaked {
			t.Fatal("incognito end retained receipt body")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	preview, err := s.PreviewChatWipe(ctx, 1)
	if err != nil || preview.ConversationCount != 2 {
		t.Fatalf("wipe preview=%+v err=%v", preview, err)
	}
	wipe, err := s.WipeAllChats(ctx, 1)
	if err != nil || wipe.ConversationsDeleted != 2 {
		t.Fatalf("wipe=%+v err=%v", wipe, err)
	}
	if err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var count int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.stored_chat WHERE owner_user_id=1`).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("wipe retained group chat")
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.chat_receipt WHERE owner_user_id=1 AND chat_id=$1 AND result_cipher IS NOT NULL`, group.ChatID).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			t.Fatal("wipe retained receipt body")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
