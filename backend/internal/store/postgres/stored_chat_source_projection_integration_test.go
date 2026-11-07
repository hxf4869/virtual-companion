//go:build integration

package postgres

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
)

func sx7SourceChat(t *testing.T) StoredChat {
	t.Helper()
	_ = storedChatFixture(t)
	character := "synthetic-sx7"
	chat, err := testEnv.store.CreateStoredChat(t.Context(), 1, ChatCreate{RequestID: chatUUID(), AuthorityEpoch: 2, Kind: "SINGLE", CharacterRef: &character, Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	return chat
}

func TestStoredChatSX7SourceProjection(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	appended := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic source", "is_user": true}))
	message := appended.Changed[0]
	var state, ref, body string
	var revision, generation int64
	err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT c.st_source_state,s.source_ref,s.content_cipher,s.source_revision,s.source_generation
   FROM vc.conversation c JOIN vc.st_message_source s ON (s.owner_user_id,s.conversation_id)=(c.owner_user_id,c.id)
   WHERE c.owner_user_id=1 AND c.id=$1 AND s.message_id=$2 AND s.present`, *chat.ConversationID, message.MessageID).Scan(&state, &ref, &body, &revision, &generation)
	})
	if err != nil {
		t.Fatalf("ACK has no atomic source projection: %v", err)
	}
	if state != "PRESENT" || body != "synthetic source" || revision != 1 || generation != 1 {
		t.Fatal("source publication differs from stored candidate")
	}
}

func TestStoredChatSX7SourceRevisionsForkAndRights(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	fixture, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close(ctx)
	appended := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic first", "is_user": true, "swipes": []any{"synthetic first", "synthetic second"}, "swipe_id": 0}))
	message := appended.Changed[0]
	first, second := message.SelectedCandidateID, message.Candidates[1].CandidateID
	var sourceID int64
	if err = fixture.QueryRow(ctx, `SELECT id FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *chat.ConversationID, first).Scan(&sourceID); err != nil {
		t.Fatal(err)
	}
	// Cosmetic data must not replace the source identity or advance its counters.
	edited, err := s.EditStoredMessage(ctx, 1, chat.ChatID, message.MessageID, ChatMessageEditRequest{RequestID: chatUUID(), AuthorityEpoch: 2, BaseRevision: 1, CandidateID: &first,
		Changes: []ChatFieldChange{{Path: []string{"extra", "ui_only"}, Before: ChatFieldValue{}, After: ChatFieldValue{Exists: true, Value: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	var stable bool
	if err = fixture.QueryRow(ctx, `SELECT id=$1 AND source_revision=1 AND source_generation=1 AND present FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$2 AND candidate_id=$3`, sourceID, *chat.ConversationID, first).Scan(&stable); err != nil || !stable {
		t.Fatalf("cosmetic edit altered source: %v", err)
	}
	message = edited.Changed[0]
	// Forgetting remains sticky after deselection, fork and later reselection.
	tx, err := fixture.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.bindOwner(ctx, tx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, `UPDATE vc.st_message_source SET suppressed=true WHERE owner_user_id=1 AND id=$1`, sourceID); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	switched, err := s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Operation(t, "selectSwipe", ChatData{"messageId": message.MessageID, "candidateId": second},
		ChatData{"messageRevision": strconv.FormatInt(message.Revision, 10), "selectedCandidateId": first}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	var withdrawn bool
	if err = fixture.QueryRow(ctx, `SELECT NOT present AND content_cipher='' AND source_generation=2 AND suppressed FROM vc.st_message_source WHERE owner_user_id=1 AND id=$1`, sourceID).Scan(&withdrawn); err != nil || !withdrawn {
		t.Fatalf("deselection did not withdraw exact source: %v", err)
	}
	fork, err := s.ForkStoredChat(ctx, 1, chat.ChatID, ChatForkRequest{RequestID: chatUUID(), AuthorityEpoch: 2, ParentRevision: switched.Revision, ThroughID: message.MessageID})
	if err != nil {
		t.Fatal(err)
	}
	mapped := fork.Mapping[0]
	var copiedFirst string
	for _, candidate := range mapped.Candidates {
		if candidate.ParentCandidateID == first {
			copiedFirst = candidate.CandidateID
		}
	}
	if err = fixture.QueryRow(ctx, `SELECT suppressed AND NOT present AND content_cipher='' AND source_revision=1 AND source_generation=1 FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *fork.Chat.ConversationID, copiedFirst).Scan(&stable); err != nil || !stable {
		t.Fatalf("fork lost deselected suppression: %v", err)
	}
	child, err := s.GetStoredMessage(ctx, 1, fork.Chat.ChatID, mapped.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := s.ApplyStoredChatOperations(ctx, 1, fork.Chat.ChatID, sx5Operations(fork.Chat, sx5Operation(t, "selectSwipe", ChatData{"messageId": child.MessageID, "candidateId": copiedFirst},
		ChatData{"messageRevision": "1", "selectedCandidateId": child.SelectedCandidateID}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.QueryRow(ctx, `SELECT suppressed AND present AND source_generation=1 FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *fork.Chat.ConversationID, copiedFirst).Scan(&stable); err != nil || !stable {
		t.Fatalf("reselection resurrected forgotten source: %v", err)
	}
	current := selected.Changed[0]
	// no_memory removes the compatibility plaintext without deleting raw history.
	_, err = s.EditStoredMessage(ctx, 1, fork.Chat.ChatID, current.MessageID, ChatMessageEditRequest{RequestID: chatUUID(), AuthorityEpoch: 2, BaseRevision: current.Revision, CandidateID: &copiedFirst,
		Changes: []ChatFieldChange{{Path: []string{"extra", "no_memory"}, Before: ChatFieldValue{}, After: ChatFieldValue{Exists: true, Value: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.QueryRow(ctx, `SELECT NOT eligible AND content_cipher='' AND suppressed AND source_revision=2 AND source_generation=2 FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND candidate_id=$2`, *fork.Chat.ConversationID, copiedFirst).Scan(&stable); err != nil || !stable {
		t.Fatalf("no_memory projection: %v", err)
	}
	raw, err := s.GetStoredMessage(ctx, 1, fork.Chat.ChatID, current.MessageID)
	if err != nil || raw.Data["mes"] != "synthetic first" {
		t.Fatal("no_memory erased raw history")
	}
}

func TestStoredChatSX7SourceVoiceAndIncognito(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	written := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic voice", "swipes": []any{"synthetic voice", "synthetic alternative"}, "swipe_id": 0}))
	message := written.Changed[0]
	voiceRef := "stmsg:" + chat.ChatID + ":" + message.MessageID + ":" + message.SelectedCandidateID
	if _, err := s.ResolveVoiceMessage(ctx, 1, *chat.RelationshipID, voiceRef); err != nil {
		t.Fatalf("settled GO voice unavailable: %v", err)
	}
	if _, err := s.ResolveVoiceMessage(ctx, 2, *chat.RelationshipID, voiceRef); err == nil {
		t.Fatal("cross-owner voice resolved")
	}
	_, err := s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Operation(t, "selectSwipe", ChatData{"messageId": message.MessageID, "candidateId": message.Candidates[1].CandidateID},
		ChatData{"messageRevision": "1", "selectedCandidateId": message.SelectedCandidateID}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ResolveVoiceMessage(ctx, 1, *chat.RelationshipID, voiceRef); err == nil {
		t.Fatal("deselected voice source still resolved")
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.conversation SET incognito=true WHERE owner_user_id=1 AND id=$1`, *chat.ConversationID); err != nil {
		t.Fatal(err)
	}
	private := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic private", "is_user": true}))
	var safe bool
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT NOT eligible AND content_cipher='' FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=$1 AND message_id=$2`, *chat.ConversationID, private.Changed[0].MessageID).Scan(&safe)
	})
	if err != nil || !safe {
		t.Fatalf("incognito projection leaked content: %v", err)
	}
	if _, err = s.EndConversation(ctx, 1, *chat.ConversationID); err != nil {
		t.Fatal(err)
	}
	err = s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT c.st_source_state='DELETED' AND c.st_applied_revision=$2 AND NOT EXISTS(SELECT 1 FROM vc.stored_chat WHERE owner_user_id=1 AND conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=c.id AND (present OR content_cipher<>'')) FROM vc.conversation c WHERE c.owner_user_id=1 AND c.id=$1`, *chat.ConversationID, private.Revision+1).Scan(&safe)
	})
	if err != nil || !safe {
		t.Fatalf("incognito end left raw/source state: %v", err)
	}
}

func TestStoredChatSX7InboxLinkChangesBeforeAck(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	claim, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
	if err != nil {
		t.Fatal(err)
	}
	rb := result.Readback
	_, err = s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Operation(t, "delete", ChatData{"messageId": rb.MessageID}, ChatData{"messageRevision": "1"}, nil)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, rb.MessageID, rb.MessageRevision); err != nil {
		t.Fatal(err)
	}
	current, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || current.LinkStatus != "removed" {
		t.Fatalf("late ACK restored deleted link: %v", err)
	}
}

func TestStoredChatSX7UnknownEvidenceCannotUseOldProjection(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	written := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic evidence", "is_user": true}))
	m := written.Changed[0]
	ref := "st:" + chat.ChatID + ":" + m.MessageID + ":" + m.SelectedCandidateID + ":1:1"
	if err := IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='FROZEN',epoch=epoch+1 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	if err := s.reconcileSTEvidence(ctx, 1, []string{ref}); err == nil {
		t.Error("FROZEN accepted old source projection")
	}
	err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		var allowed bool
		if err := tx.QueryRow(ctx, `SELECT vc.guard_st_evidence_write($1,$2,$3)`, int64(1), *chat.RelationshipID, ref).Scan(&allowed); err != nil {
			return err
		}
		if allowed {
			t.Error("frozen SQL evidence guard accepted stale authority")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='GO',epoch=epoch+1 WHERE owner_user_id=1;
 UPDATE vc.stored_chat SET revision=revision+1 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	if err = s.reconcileSTEvidence(ctx, 1, []string{ref}); err == nil {
		t.Error("unknown raw watermark accepted old source projection")
	}
}

func TestStoredChatSX7SourceJobsUseCurrentDelta(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	useSTExtractRoute(t, s)
	if _, err := s.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	written := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic extracted input", "is_user": true}, ChatData{"mes": "synthetic excluded input", "is_user": true, "extra": ChatData{"no_memory": true}}))
	var original StoredMessage
	for _, m := range written.Changed {
		if m.Data["mes"] == "synthetic extracted input" {
			original = m
		}
	}
	fixture, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer fixture.Close(ctx)
	var total, pending int
	if err = fixture.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE status='PENDING') FROM vc.work_item WHERE owner_user_id=1 AND kind='ST_MEMORY_EXTRACT'`).Scan(&total, &pending); err != nil || total != 1 || pending != 1 {
		t.Fatalf("new settled source jobs=%d pending=%d err=%v", total, pending, err)
	}
	_, err = s.EditStoredMessage(ctx, 1, chat.ChatID, original.MessageID, ChatMessageEditRequest{RequestID: chatUUID(), AuthorityEpoch: 2, BaseRevision: 1, CandidateID: &original.SelectedCandidateID,
		Changes: []ChatFieldChange{{Path: []string{"mes"}, Before: ChatFieldValue{Exists: true, Value: "synthetic extracted input"}, After: ChatFieldValue{Exists: true, Value: "synthetic replacement input"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err = fixture.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE status='PENDING') FROM vc.work_item WHERE owner_user_id=1 AND kind='ST_MEMORY_EXTRACT'`).Scan(&total, &pending); err != nil || total != 2 || pending != 1 {
		t.Fatalf("edit did not replace the source job atomically: total=%d pending=%d err=%v", total, pending, err)
	}
}

func TestStoredChatSX7InboxReselectionRestoresLink(t *testing.T) {
	chat, event := storedInboxFixture(t)
	s, ctx := testEnv.store, t.Context()
	claim, err := s.ClaimInboxEvent(ctx, 1, event.EventID, 60)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.DeliverStoredInbox(ctx, 1, chat.ChatID, event.EventID, claim.LeaseToken)
	if err != nil {
		t.Fatal(err)
	}
	rb := result.Readback
	if _, err = s.AckInboxEvent(ctx, 1, event.EventID, claim.LeaseToken, rb.MessageID, rb.MessageRevision); err != nil {
		t.Fatal(err)
	}
	original, err := s.GetStoredMessage(ctx, 1, chat.ChatID, rb.MessageID)
	if err != nil {
		t.Fatal(err)
	}
	alternative := chatUUID()
	added, err := s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Swipe(t, original, "addSwipe", alternative)))
	if err != nil {
		t.Fatal(err)
	}
	switched, err := s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Swipe(t, added.Changed[0], "selectSwipe", alternative)))
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || current.LinkStatus != "invalidated" {
		t.Fatalf("new candidate kept inbox link: %v", err)
	}
	_, err = s.ApplyStoredChatOperations(ctx, 1, chat.ChatID, sx5Operations(chat, sx5Swipe(t, switched.Changed[0], "selectSwipe", original.SelectedCandidateID)))
	if err != nil {
		t.Fatal(err)
	}
	current, err = s.GetInboxEvent(ctx, 1, event.EventID)
	if err != nil || current.LinkStatus != "present" {
		t.Fatalf("original candidate did not restore link: %v", err)
	}
	page := sx5Page(t, chat)
	if len(page.Items) != 1 {
		t.Fatal("reselection redelivered an inbox message")
	}
}

func TestStoredChatSX7OpenTopicUnavailable(t *testing.T) {
	chat := sx7SourceChat(t)
	s, ctx := testEnv.store, t.Context()
	written := sx5Append(t, chat, sx5AppendRequest(chat, ChatData{"mes": "synthetic open topic", "is_user": true}))
	m := written.Changed[0]
	ref := "st:" + chat.ChatID + ":" + m.MessageID + ":" + m.SelectedCandidateID + ":1:1"
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.companion_affect(owner_user_id,relationship_id,open_topic_source_ref) VALUES(1,$1,$2) ON CONFLICT(owner_user_id,relationship_id) DO UPDATE SET open_topic_source_ref=excluded.open_topic_source_ref`, *chat.RelationshipID, ref); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='FROZEN',epoch=epoch+1 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	if err := s.reconcileOpenTopic(ctx, 1, *chat.RelationshipID); !errors.Is(err, stsource.ErrUnavailable) {
		t.Fatalf("frozen topic used stale projection: %v", err)
	}
	var persisted string
	err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT open_topic_source_ref FROM vc.companion_affect WHERE owner_user_id=1 AND relationship_id=$1`, *chat.RelationshipID).Scan(&persisted)
	})
	if err != nil || persisted != ref {
		t.Fatal("temporary unavailability permanently erased topic")
	}
	if err = IsolationSuperExec(ctx, `UPDATE vc.chat_authority SET authority='ST',epoch=epoch+1 WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	s.UseSTSourceReader(nil)
	if err = s.reconcileOpenTopic(ctx, 1, *chat.RelationshipID); err != nil {
		t.Fatalf("legacy unavailable topic stopped normal state reads: %v", err)
	}
}
