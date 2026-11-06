//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestStoredChatSX5EqualCountCandidateDeletionClearsReceipts(t *testing.T) {
	c := storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	appendRequest := sx5AppendRequest(c, ChatData{"mes": "synthetic selected", "swipes": []any{"synthetic selected", "synthetic removed"}, "swipe_id": 0})
	appended := sx5Append(t, c, appendRequest)
	message := appended.Changed[0]
	removed := message.Candidates[1].CandidateID
	added := chatUUID()
	_, err := s.ApplyStoredChatOperations(ctx, 1, c.ChatID, ChatOperationsRequest{RequestID: chatUUID(), AuthorityEpoch: c.AuthorityEpoch,
		Operations: []ChatOperation{
			sx5Operation(t, "addSwipe", ChatData{"messageId": message.MessageID}, ChatData{"messageRevision": "1"},
				ChatData{"candidate": ChatData{"candidateId": added, "data": ChatData{"mes": "synthetic replacement"}}}),
			sx5Operation(t, "removeSwipe", ChatData{"messageId": message.MessageID, "candidateId": removed},
				ChatData{"messageRevision": "1", "selectedCandidateId": message.SelectedCandidateID}, ChatData{"replacementCandidateId": nil}),
		}})
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.GetStoredMessage(ctx, 1, c.ChatID, message.MessageID)
	if err != nil || len(current.Candidates) != 2 || candidateIndex(current, removed) >= 0 || candidateIndex(current, added) < 0 {
		t.Fatal("same-size candidate replacement did not occur")
	}
	_, err = s.AppendStoredMessages(ctx, 1, c.ChatID, appendRequest)
	expectChatCode(t, err, "OPERATION_RESULT_EXPIRED")
}

func TestStoredChatSX5SourceRevocationIsSynchronous(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	var sourceID, generation, revision int64
	var sourceRef, messageID, candidateID, text string
	fixture, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close(ctx)
	if err = fixture.QueryRow(ctx, `SELECT s.id,s.message_id::text,s.candidate_id::text,s.source_revision,s.source_generation,s.source_ref,s.content_cipher
 FROM vc.st_message_source s JOIN vc.memory_evidence e ON(e.owner_user_id,e.source_ref)=(s.owner_user_id,s.source_ref)
 WHERE s.owner_user_id=1 AND s.conversation_id=$1 AND s.present LIMIT 1`, event.ConversationID).
		Scan(&sourceID, &messageID, &candidateID, &revision, &generation, &sourceRef, &text); err != nil {
		t.Fatal(err)
	}
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		m := StoredMessage{MessageID: messageID, Revision: 1, Position: "1", SelectedCandidateID: candidateID, Data: ChatData{"is_user": true},
			Candidates: []StoredCandidate{{CandidateID: candidateID, SourceRevision: revision, SourceGeneration: generation, settled: true, everSelected: true,
				Data: ChatData{"mes": text, "extra": ChatData{}}}}}
		if err := s.insertStoredMessage(ctx, tx, 1, chat.ChatID, m, []byte{1}); err != nil {
			return err
		}
		chat.MessageCount = 1
		return s.persistStoredChat(ctx, tx, 1, chat, 1, false, false, false)
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.EditStoredMessage(ctx, 1, chat.ChatID, messageID, ChatMessageEditRequest{RequestID: chatUUID(), AuthorityEpoch: 2, BaseRevision: 1,
		CandidateID: &candidateID, Changes: []ChatFieldChange{{Path: []string{"mes"}, Before: ChatFieldValue{Exists: true, Value: text}, After: ChatFieldValue{Exists: true, Value: "synthetic changed evidence"}}}})
	if err != nil {
		t.Fatal(err)
	}
	var present, hasBody bool
	var actualGeneration int64
	if err := fixture.QueryRow(ctx, `SELECT present,content_cipher<>'',source_generation FROM vc.st_message_source WHERE owner_user_id=1 AND id=$1`, sourceID).
		Scan(&present, &hasBody, &actualGeneration); err != nil {
		t.Fatal(err)
	}
	if present || hasBody || actualGeneration != generation+1 {
		t.Fatal("ACK preceded source revocation/body erasure")
	}
	var stale int
	if err := fixture.QueryRow(ctx, `SELECT count(*) FROM vc.memory_item m JOIN vc.memory_evidence e ON(e.owner_user_id,e.memory_item_id)=(m.owner_user_id,m.id)
 WHERE m.owner_user_id=1 AND e.source_ref=$1 AND m.source_invalidated_at IS NULL`, sourceRef).Scan(&stale); err != nil {
		t.Fatal(err)
	}
	if stale != 0 {
		t.Fatal("ACK preceded dependent-memory invalidation")
	}
}

func TestStoredChatSX5ForkPreservesIncognitoRights(t *testing.T) {
	_ = storedChatFixture(t)
	s, ctx := testEnv.store, t.Context()
	character := "synthetic-private-fork"
	parent, err := s.CreateStoredChat(ctx, 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "SINGLE", CharacterRef: &character, Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.conversation SET incognito=true WHERE owner_user_id=1 AND id=$1`, *parent.ConversationID); err != nil {
		t.Fatal(err)
	}
	write := sx5Append(t, parent, sx5AppendRequest(parent, ChatData{"mes": "synthetic private input", "is_user": true}))
	in := ChatForkRequest{RequestID: chatUUID(), AuthorityEpoch: 2, ParentRevision: write.Revision, ThroughID: write.Changed[0].MessageID}
	fork, err := s.ForkStoredChat(ctx, 1, parent.ChatID, in)
	if err != nil {
		t.Fatal(err)
	}
	if fork.Chat.ConversationID == nil || fork.Chat.RelationshipID == nil || *fork.Chat.RelationshipID != *parent.RelationshipID ||
		*fork.Chat.ConversationID == *parent.ConversationID || fork.Chat.BranchRoot != parent.BranchRoot {
		t.Fatal("fork lost its instance or branch rights boundary")
	}
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var incognito bool
		var root string
		if err := tx.QueryRow(ctx, `SELECT incognito,st_branch_root FROM vc.conversation WHERE owner_user_id=1 AND id=$1`, *fork.Chat.ConversationID).Scan(&incognito, &root); err != nil {
			return err
		}
		if !incognito || root != parent.BranchRoot {
			t.Fatal("fork exposed an incognito conversation as normal")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EndConversation(ctx, 1, *fork.Chat.ConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetStoredChat(ctx, 1, fork.Chat.ChatID); !errors.Is(err, ErrNotFound) {
		t.Fatal("ending an incognito fork retained its raw chat")
	}
	if _, err := s.ForkStoredChat(ctx, 1, parent.ChatID, in); !errors.Is(err, ErrNotFound) {
		t.Fatal("fork receipt resurrected or disclosed an ended incognito chat")
	}
}
