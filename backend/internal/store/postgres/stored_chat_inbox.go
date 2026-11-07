package postgres

import (
	"context"
	"errors"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// DeliverStoredInbox uses the same owner/chat locks, message mutation and outbox
// transaction as foreground writes. The existing event lease is the authority;
// text, branch and voice are read from the event, never a caller-supplied body.
// Its durable (eventId, chatId) mapping is the receipt even when the message is
// removed. The caller ACKs only after receiving this committed readback.
func (s *Store) DeliverStoredInbox(ctx context.Context, owner int64, chatID, eventID, leaseToken string) (stsource.InboxDeliveryResult, error) {
	var out stsource.InboxDeliveryResult
	id, err := normalizeChatID(chatID)
	if err != nil || !validInboxEventID(eventID) || strings.TrimSpace(leaseToken) == "" {
		return out, ErrInvalid
	}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		authority, epoch, err := lockChatAuthority(ctx, tx, owner, true)
		if err != nil {
			return err
		}
		if authority != "GO" {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		chat, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,true)`, owner, id), epoch)
		if err != nil {
			return err
		}
		var leaseAlive bool
		err = tx.QueryRow(ctx, `SELECT coalesce(lease_token=$4 AND lease_expires_at>clock_timestamp(),false)
 FROM vc.lock_stored_chat_inbox_event($1,$2,$3)`, owner, id, eventID, leaseToken).Scan(&leaseAlive)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if !leaseAlive {
			return ErrInboxLeaseRejected
		}
		event, exists, err := getInboxTx(ctx, tx, owner, eventID)
		if err != nil {
			return err
		}
		if !exists || chat.ConversationID == nil || event.ConversationID != *chat.ConversationID {
			return ErrNotFound
		}
		markLink := func(status string) error {
			out.LinkStatus = status
			_, err := tx.Exec(ctx, `SELECT vc.set_inbox_link_status($1,$2,$3)`, owner, eventID, status)
			return err
		}
		if event.Intent == "WAITING_HOST" {
			out.WaitingHost = true
			return nil
		}
		if event.Branch != nil && *event.Branch != "" && *event.Branch != chat.BranchRoot {
			return markLink("invalidated")
		}
		var messageID string
		err = tx.QueryRow(ctx, `SELECT message_id::text FROM vc.stored_chat_inbox WHERE owner_user_id=$1 AND chat_id=$2 AND event_id=$3`, owner, id, eventID).Scan(&messageID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if messageID == "" && event.STDelivered {
			// Previously delivered legacy messages never reopen a delivery after a
			// deletion, rollback or missing migration association.
			if event.MessageID == nil || !stsource.ValidIdentity(*event.MessageID) {
				return markLink("removed")
			}
			messageID = *event.MessageID
		}
		if messageID == "" {
			if event.Body == nil {
				return ErrInvalid
			}
			mutation := &storedChatMutation{store: s, owner: owner, chat: chat,
				metadata: ChatData{"title": chat.Title, "header": chat.Header, "metadata": chat.Metadata},
				start:    map[string]StoredMessage{}, messages: map[string]StoredMessage{}, deleted: map[string]bool{}, appended: map[string][]byte{},
				addedCandidates: map[string]map[string][]byte{}, positions: map[string]int64{}, returned: map[string]bool{}}
			if err = tx.QueryRow(ctx, `SELECT next_position FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, id).Scan(&mutation.nextPosition); err != nil {
				return err
			}
			extra := ChatData{}
			if event.Voice != nil {
				extra["vc_voice"] = event.Voice
			}
			messageID = chatUUID()
			if err = mutation.append(ctx, tx, ChatAppendMessage{MessageID: messageID, Data: ChatData{"is_user": false, "mes": *event.Body, "extra": extra}}); err != nil {
				return err
			}
			message := mutation.messages[messageID]
			selected := &message.Candidates[candidateIndex(message, message.SelectedCandidateID)]
			asChatData(asChatData(selected.Data["extra"])["vc_source"])["inbox_event_id"] = eventID
			mutation.messages[messageID] = message
			operationID := chatUUID()
			commit, err := mutation.persist(ctx, tx, operationID, operationID)
			if err != nil {
				return err
			}
			chat.Revision = commit.Revision
			if _, err = tx.Exec(ctx, `SELECT vc.insert_stored_chat_inbox($1,$2,$3,$4)`, owner, id, eventID, messageID); err != nil {
				return err
			}
			out.Saved = true
		}
		message, err := s.loadStoredMessage(ctx, tx, owner, id, messageID)
		if errors.Is(err, ErrNotFound) {
			return markLink("removed")
		}
		if err != nil {
			return err
		}
		selected := message.Candidates[candidateIndex(message, message.SelectedCandidateID)]
		source := asChatData(asChatData(selected.Data["extra"])["vc_source"])
		if source["inbox_event_id"] != eventID || (event.MessageRevision != nil && selected.SourceRevision < *event.MessageRevision) {
			return markLink("invalidated")
		}
		if err = tx.QueryRow(ctx, `SELECT coalesce(lease_token=$3 AND lease_expires_at>clock_timestamp(),false)
 FROM vc.inbox_event WHERE owner_user_id=$1 AND event_id=$2`, owner, eventID, leaseToken).Scan(&leaseAlive); err != nil {
			return err
		}
		if !leaseAlive {
			return ErrInboxLeaseRejected
		}
		out.Associated, out.Acked, out.LinkStatus = true, true, "present"
		out.Readback = &stsource.InboxReadback{ChatIdentity: id, ChatRevision: chat.Revision, EventID: eventID,
			MessageID: message.MessageID, MessageRevision: selected.SourceRevision, CandidateID: selected.CandidateID}
		return nil
	})
	if err != nil {
		var chatErr *ChatError
		if errors.As(err, &chatErr) {
			return stsource.InboxDeliveryResult{}, chatErr
		}
		return stsource.InboxDeliveryResult{}, mapInboxErr(err)
	}
	return out, nil
}
