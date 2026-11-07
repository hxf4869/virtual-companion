package postgres

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Store) DeleteStoredChat(ctx context.Context, owner int64, chatID string, in ChatDeleteRequest) (ChatCommit, error) {
	var out ChatCommit
	id, err := normalizeChatID(chatID)
	if err != nil || in.Revision < 0 {
		return out, ErrInvalid
	}
	in.RequestID = strings.ToLower(in.RequestID)
	result, err := s.storedChatWrite(ctx, owner, storedChatResource("DELETE", id, ""), in.RequestID, in.AuthorityEpoch, in,
		func(ctx context.Context, tx pgx.Tx, operationID string, epoch int64) (chatWriteResult, error) {
			chat, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,true)`, owner, id), epoch)
			if err != nil {
				return chatWriteResult{}, err
			}
			if chat.Revision != in.Revision {
				return chatWriteResult{}, chatError("REVISION_CONFLICT")
			}
			chat.Revision++
			chat.MessageCount = 0
			var next int64
			if err = tx.QueryRow(ctx, `SELECT next_position FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, id).Scan(&next); err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.delete_stored_chat_messages($1,$2,$3)`, owner, id, chat.Revision); err != nil {
				return chatWriteResult{}, err
			}
			if err = s.persistStoredChat(ctx, tx, owner, chat, next, false, false, true); err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.revoke_stored_chat_sources($1,$2,'{}',true)`, owner, id); err != nil {
				return chatWriteResult{}, err
			}
			if err = publishStoredSources(ctx, tx, owner, id, nil, nil, false); err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.fence_changed_stored_chat_runs($1,$2)`, owner, id); err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.clear_stored_chat_receipt_bodies($1,$2)`, owner, id); err != nil {
				return chatWriteResult{}, err
			}
			out = ChatCommit{RequestID: in.RequestID, OperationID: operationID, ChatID: id, Revision: chat.Revision,
				MetadataRevision: chat.MetadataRevision, OrderRevision: chat.OrderRevision, AuthorityEpoch: epoch,
				Changed: []StoredMessage{}, DeletedIDs: []string{}, Deleted: true}
			event := ChatChange{OperationID: operationID, Revision: chat.Revision, MetadataRevision: chat.MetadataRevision, OrderRevision: chat.OrderRevision,
				AuthorityEpoch: epoch, ChangedIDs: []string{}, DeletedIDs: []string{}, Deleted: true}
			if err = storeChatChange(ctx, tx, owner, id, event); err != nil {
				return chatWriteResult{}, err
			}
			body, err := chatJSON(out)
			return chatWriteResult{ChatID: id, Revision: chat.Revision, Status: 200, Body: body}, err
		})
	if err != nil {
		return out, err
	}
	err = chatDecode(result.Body, &out)
	out.HTTPStatus = result.Status
	return out, err
}

func (s *Store) ForkStoredChat(ctx context.Context, owner int64, chatID string, in ChatForkRequest) (ChatForkResult, error) {
	var out ChatForkResult
	id, err := normalizeChatID(chatID)
	if err != nil || in.ParentRevision < 0 {
		return out, ErrInvalid
	}
	in.ThroughID, err = normalizeChatID(in.ThroughID)
	if err != nil {
		return out, err
	}
	in.RequestID = strings.ToLower(in.RequestID)
	result, err := s.storedChatWrite(ctx, owner, storedChatResource("POST", id, "/forks"), in.RequestID, in.AuthorityEpoch, in,
		func(ctx context.Context, tx pgx.Tx, operationID string, epoch int64) (chatWriteResult, error) {
			parent, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,true)`, owner, id), epoch)
			if err != nil {
				return chatWriteResult{}, err
			}
			if parent.Revision != in.ParentRevision {
				return chatWriteResult{}, chatError("REVISION_CONFLICT")
			}
			var through int64
			if err = tx.QueryRow(ctx, `SELECT position FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL`, owner, id, in.ThroughID).Scan(&through); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					err = ErrNotFound
				}
				return chatWriteResult{}, err
			}
			mapping, err := storedForkMapping(ctx, tx, owner, id, through)
			if err != nil {
				return chatWriteResult{}, err
			}
			child := parent
			child.ChatID, child.Revision, child.MetadataRevision, child.OrderRevision = chatUUID(), 1, 1, 1
			child.MessageCount = int64(len(mapping))
			child.Header, err = cloneChatData(parent.Header)
			if err != nil {
				return chatWriteResult{}, err
			}
			child.Metadata, err = cloneChatData(parent.Metadata)
			if err != nil {
				return chatWriteResult{}, err
			}
			child.Header["vc_f2"] = ChatData{"id": child.ChatID, "revision": 1}
			child.Header["vc_branch_root"] = child.BranchRoot
			if parent.ConversationID != nil {
				var mode string
				if err = tx.QueryRow(ctx, `SELECT st_mode FROM vc.conversation WHERE owner_user_id=$1 AND id=$2`, owner, *parent.ConversationID).Scan(&mode); err != nil {
					return chatWriteResult{}, err
				}
				var conversation, relationship int64
				if err = tx.QueryRow(ctx, `SELECT out_conversation_id,out_relationship_id FROM vc.resolve_st_binding($1,$2,$3,$4,$5,'')`, owner, child.ChatID, *parent.CharacterRef, mode, *parent.RelationshipID).
					Scan(&conversation, &relationship); err != nil {
					return chatWriteResult{}, err
				}
				child.ConversationID, child.RelationshipID = &conversation, &relationship
				child.Header["vc_binding"] = ChatData{"chatIdentity": child.ChatID, "conversationId": strconv.FormatInt(conversation, 10),
					"relationshipId": strconv.FormatInt(relationship, 10), "characterRef": *child.CharacterRef, "mode": mode}
			}
			header, err := s.encodeChatJSON(child.Header)
			if err != nil {
				return chatWriteResult{}, err
			}
			metadata, err := s.encodeChatJSON(child.Metadata)
			if err != nil {
				return chatWriteResult{}, err
			}
			inserted, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.insert_stored_chat($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, owner, child.ChatID,
				child.Kind, child.ConversationID, child.RelationshipID, child.CharacterRef, child.GroupRef, child.BranchRoot, child.Title, header, metadata), epoch)
			if err != nil {
				return chatWriteResult{}, err
			}
			child.UpdatedAt = inserted.UpdatedAt
			child.FileName, child.FileAliases = inserted.FileName, inserted.FileAliases
			encodedMapping, err := chatJSON(mapping)
			if err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.copy_stored_chat_prefix($1,$2,$3,$4,$5)`, owner, id, child.ChatID, through, encodedMapping); err != nil {
				return chatWriteResult{}, err
			}
			if _, err = tx.Exec(ctx, `SELECT vc.copy_stored_chat_sources($1,$2,$3,$4)`, owner, id, child.ChatID, encodedMapping); err != nil {
				return chatWriteResult{}, err
			}
			changed := make([]string, len(mapping))
			for i, entry := range mapping {
				changed[i] = entry.MessageID
			}
			event := ChatChange{OperationID: operationID, Revision: 1, MetadataRevision: 1, OrderRevision: 1, AuthorityEpoch: epoch,
				ChangedIDs: changed, DeletedIDs: []string{}, MetadataChanged: true}
			if err = storeChatChange(ctx, tx, owner, child.ChatID, event); err != nil {
				return chatWriteResult{}, err
			}
			out = ChatForkResult{RequestID: in.RequestID, OperationID: operationID, Chat: child, Mapping: mapping}
			body, err := chatJSON(out)
			return chatWriteResult{ChatID: child.ChatID, Revision: 1, Status: 201, Body: body}, err
		})
	if err != nil {
		return out, err
	}
	err = chatDecode(result.Body, &out)
	out.HTTPStatus = result.Status
	return out, err
}

func storedForkMapping(ctx context.Context, tx pgx.Tx, owner int64, parent string, through int64) ([]ChatForkMapping, error) {
	rows, err := tx.Query(ctx, `SELECT m.message_id::text,c.candidate_id::text FROM vc.stored_message m JOIN vc.stored_candidate c
 ON(c.owner_user_id,c.chat_id,c.message_id)=(m.owner_user_id,m.chat_id,m.message_id)
 WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.position<=$3 AND m.deleted_at IS NULL AND c.deleted_at IS NULL ORDER BY m.position,c.ordinal`, owner, parent, through)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ChatForkMapping{}
	for rows.Next() {
		var message, candidate string
		if err = rows.Scan(&message, &candidate); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].ParentMessageID != message {
			out = append(out, ChatForkMapping{ParentMessageID: message, MessageID: chatUUID(), Candidates: []ChatForkCandidateMapping{}})
		}
		entry := &out[len(out)-1]
		entry.Candidates = append(entry.Candidates, ChatForkCandidateMapping{ParentCandidateID: candidate, CandidateID: chatUUID()})
	}
	return out, rows.Err()
}
