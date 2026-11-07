package postgres

import (
	"context"
	"io"
	"strconv"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/jackc/pgx/v5"
)

// ChatExportSnapshot identifies a complete captured JSONL body. Bytes includes
// every LF. A failed capture has no snapshot and its destination must be discarded.
type ChatExportSnapshot struct {
	ChatID         string
	Revision       int64
	AuthorityEpoch int64
	Bytes          int64
}

// CaptureStoredChatJSONL writes a complete single-revision snapshot into a
// caller-owned private encrypted staging writer, never directly to HTTP output.
// It retains only the current message and its candidates in Go memory.
func (s *Store) CaptureStoredChatJSONL(ctx context.Context, owner int64, chatID string, revision *int64, dst io.Writer) (ChatExportSnapshot, error) {
	return s.captureStoredChatJSONL(ctx, owner, chatID, revision, dst, nil)
}

func (s *Store) captureStoredChatJSONL(ctx context.Context, owner int64, chatID string, revision *int64, dst io.Writer, migration *ChatMigrationRun) (ChatExportSnapshot, error) {
	var snapshot ChatExportSnapshot
	id, err := normalizeChatID(chatID)
	if err != nil || dst == nil || (revision != nil && *revision < 0) {
		return snapshot, ErrInvalid
	}
	if s == nil || s.cipher == nil {
		return snapshot, errStore
	}
	err = s.withChatTransfer(ctx, owner, pgx.TxOptions{IsoLevel: pgx.RepeatableRead}, func(ctx context.Context, tx pgx.Tx) error {
		var chat StoredChat
		var err error
		if migration == nil {
			chat, err = s.lockChatExport(ctx, tx, owner, id, 0)
		} else {
			var mode string
			var epoch int64
			mode, epoch, err = lockChatAuthority(ctx, tx, owner, true)
			if err == nil && (mode != "FROZEN" || epoch != migration.FrozenEpoch) {
				err = chatError("CHAT_AUTHORITY_CHANGED")
			}
			if err == nil {
				chat, err = s.readStoredChat(ctx, tx, owner, id, epoch)
			}
		}
		if err != nil {
			return err
		}
		if revision != nil && chat.Revision != *revision {
			return chatError("REVISION_CONFLICT")
		}
		output := &chatExportWriter{ctx: ctx, dst: dst, limit: chatjsonl.MaxHeaderBytes}
		writer := chatjsonl.NewWriter(output)
		if err = writer.WriteHeader(map[string]any(storedChatExportHeader(chat))); err != nil {
			return output.result(err)
		}
		output.limit = chatjsonl.MaxMessageBytes
		rows, err := tx.Query(ctx, `SELECT m.message_id::text,m.revision,m.position::text,m.selected_candidate_id::text,m.data_cipher,
   c.candidate_id::text,c.source_revision,c.source_generation,c.settled,c.data_cipher
   FROM vc.stored_message m JOIN vc.stored_candidate c
    ON (c.owner_user_id,c.chat_id,c.message_id)=(m.owner_user_id,m.chat_id,m.message_id) AND c.deleted_at IS NULL
   WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL
   ORDER BY m.position,c.ordinal`, owner, id)
		if err != nil {
			return err
		}
		defer rows.Close()
		var current StoredMessage
		var messages int64
		flush := func() error {
			if current.MessageID == "" {
				return nil
			}
			current.CandidateCount = len(current.Candidates)
			full, err := projectStoredMessage(current, "full")
			if err != nil {
				return err
			}
			if err = writer.WriteMessage(map[string]any(full.Data)); err != nil {
				return output.result(err)
			}
			messages++
			return nil
		}
		for rows.Next() {
			var message StoredMessage
			var candidate StoredCandidate
			var md, cd string
			if err = rows.Scan(&message.MessageID, &message.Revision, &message.Position, &message.SelectedCandidateID, &md,
				&candidate.CandidateID, &candidate.SourceRevision, &candidate.SourceGeneration, &candidate.settled, &cd); err != nil {
				return err
			}
			if message.MessageID != current.MessageID {
				if err = flush(); err != nil {
					return err
				}
				if err = s.decodeChatJSON(md, &message.Data); err != nil {
					return err
				}
				current = message
			}
			if err = s.decodeChatJSON(cd, &candidate.Data); err != nil {
				return err
			}
			current.Candidates = append(current.Candidates, candidate)
		}
		if err = rows.Err(); err != nil {
			return err
		}
		if err = flush(); err != nil {
			return err
		}
		if messages != chat.MessageCount {
			return errStore
		}
		snapshot = ChatExportSnapshot{ChatID: id, Revision: chat.Revision, AuthorityEpoch: chat.AuthorityEpoch, Bytes: output.bytes}
		return nil
	})
	if err != nil {
		return ChatExportSnapshot{}, err
	}
	return snapshot, nil
}

// DeliverStoredChatSnapshot rechecks current rights and exact captured identity,
// then retains their barriers until send finishes. send must honor its context.
// The caller supplies any shorter remaining end-to-end request budget.
func (s *Store) DeliverStoredChatSnapshot(ctx context.Context, owner int64, snapshot ChatExportSnapshot, send func(context.Context) error) error {
	id, err := normalizeChatID(snapshot.ChatID)
	if err != nil || snapshot.Revision <= 0 || snapshot.AuthorityEpoch <= 0 || snapshot.Bytes <= 0 || send == nil {
		return ErrInvalid
	}
	return s.withChatTransfer(ctx, owner, pgx.TxOptions{}, func(ctx context.Context, tx pgx.Tx) error {
		chat, err := s.lockChatExport(ctx, tx, owner, id, snapshot.AuthorityEpoch)
		if err != nil {
			return err
		}
		if chat.Revision != snapshot.Revision {
			return chatError("REVISION_CONFLICT")
		}
		return send(ctx)
	})
}

func (s *Store) lockChatExport(ctx context.Context, tx pgx.Tx, owner int64, id string, expectedEpoch int64) (StoredChat, error) {
	// write=true deliberately takes owner -> export -> memory barriers before
	// authority and chat-share locks, matching the established rights lock order.
	authority, epoch, err := lockChatAuthority(ctx, tx, owner, true)
	if err != nil {
		return StoredChat{}, err
	}
	if expectedEpoch > 0 && epoch != expectedEpoch {
		return StoredChat{}, chatError("REVISION_CONFLICT")
	}
	if authority != "GO" {
		return StoredChat{}, chatError("SCHEMA_UNAVAILABLE")
	}
	return s.readStoredChat(ctx, tx, owner, id, epoch)
}

func storedChatExportHeader(chat StoredChat) ChatData {
	header, metadata := copyChatData(chat.Header), copyChatData(chat.Metadata)
	for _, key := range []string{"vc_f2", "vc_binding", "vc_branch_root"} {
		delete(header, key)
		delete(metadata, key)
	}
	metadata["vc_f2"] = ChatData{"id": chat.ChatID, "revision": chat.Revision}
	metadata["vc_branch_root"] = chat.BranchRoot
	if chat.ConversationID != nil && chat.RelationshipID != nil && chat.CharacterRef != nil {
		binding := copyChatData(asChatData(chat.Header["vc_binding"]))
		binding["chatIdentity"] = chat.ChatID
		binding["conversationId"] = strconv.FormatInt(*chat.ConversationID, 10)
		binding["relationshipId"] = strconv.FormatInt(*chat.RelationshipID, 10)
		binding["characterRef"] = *chat.CharacterRef
		metadata["vc_binding"] = binding
	}
	header["chat_metadata"] = map[string]any(metadata)
	return header
}

type chatExportWriter struct {
	ctx      context.Context
	dst      io.Writer
	bytes    int64
	limit    int
	tooLarge bool
}

func (w *chatExportWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if len(p)-1 > w.limit {
		w.tooLarge = true
		return 0, chatError("CHAT_PAYLOAD_TOO_LARGE")
	}
	n, err := w.dst.Write(p)
	w.bytes += int64(n)
	return n, err
}
func (w *chatExportWriter) result(err error) error {
	if w.tooLarge {
		return chatError("CHAT_PAYLOAD_TOO_LARGE")
	}
	if w.ctx.Err() != nil {
		return w.ctx.Err()
	}
	return err
}
