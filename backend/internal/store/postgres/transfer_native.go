package postgres

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

func validateNativeScope(scope NativeChatScope) error {
	if scope.Kind == "SINGLE" && scope.CharacterRef != nil && *scope.CharacterRef != "" && scope.GroupRef == nil {
		return nil
	}
	if scope.Kind == "GROUP" && scope.GroupRef != nil && *scope.GroupRef != "" && scope.CharacterRef == nil {
		return nil
	}
	return ErrInvalid
}
func validTransferMode(scope NativeChatScope, mode string) bool {
	return scope.Kind == "GROUP" && mode == "" || scope.Kind == "SINGLE" && (mode == "COMPANION" || mode == "STORY")
}
func nativeScopeRef(scope NativeChatScope) string {
	if scope.CharacterRef != nil {
		return *scope.CharacterRef
	}
	if scope.GroupRef != nil {
		return *scope.GroupRef
	}
	return ""
}

var nativeReservedName = regexp.MustCompile(`(?i)^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)`)

func validNativeName(name string) bool {
	return !nativeReservedName.MatchString(name) && utf8.ValidString(name) && strings.HasSuffix(name, ".jsonl") && name != ".jsonl" && name != "..jsonl" && !strings.ContainsAny(name, "/\\\x00")
}
func (s *Store) chatAliases(ctx context.Context, tx pgx.Tx, owner int64, c *StoredChatSummary) error {
	rows, e := tx.Query(ctx, `SELECT file_name,is_primary FROM vc.chat_file_alias WHERE owner_user_id=$1 AND chat_id=$2 ORDER BY file_name`, owner, c.ChatID)
	if e != nil {
		return e
	}
	defer rows.Close()
	c.FileAliases = []string{}
	for rows.Next() {
		var name string
		var primary bool
		if e = rows.Scan(&name, &primary); e != nil {
			return e
		}
		c.FileAliases = append(c.FileAliases, name)
		if primary {
			c.FileName = name
		}
	}
	return rows.Err()
}
func (s *Store) nativeTarget(ctx context.Context, tx pgx.Tx, owner int64, scope NativeChatScope, name string, epoch int64, write bool) (StoredChat, error) {
	var out StoredChat
	var id string
	e := tx.QueryRow(ctx, `SELECT chat_id::text FROM vc.chat_file_alias WHERE owner_user_id=$1 AND kind=$2 AND scope_ref=$3 AND file_name=$4`, owner, scope.Kind, nativeScopeRef(scope), name).Scan(&id)
	if errors.Is(e, pgx.ErrNoRows) {
		return out, ErrNotFound
	}
	if e != nil {
		return out, e
	}
	out, e = s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,$3)`, owner, id, write), epoch)
	if e == nil {
		e = s.chatAliases(ctx, tx, owner, &out.StoredChatSummary)
	}
	return out, e
}
func (s *Store) ResolveNativeChat(ctx context.Context, owner int64, scope NativeChatScope, fileName string, epoch int64) (StoredChat, error) {
	var out StoredChat
	if validateNativeScope(scope) != nil || !validNativeName(fileName) {
		return out, ErrInvalid
	}
	e := s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, current int64) error {
		if current != epoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		var e error
		out, e = s.nativeTarget(ctx, tx, owner, scope, fileName, epoch, false)
		return e
	})
	return out, e
}
func (s *Store) ListNativeChats(ctx context.Context, owner int64, scope NativeChatScope, cursor string, limit int) (StoredChatPage, error) {
	out := StoredChatPage{Items: []StoredChatSummary{}}
	if validateNativeScope(scope) != nil || limit < 0 || limit > 100 {
		return out, ErrInvalid
	}
	if limit == 0 {
		limit = 50
	}
	var key chatKeyset
	var e error
	if cursor != "" {
		key, e = s.decodeChatCursor(cursor)
		if e != nil {
			return out, e
		}
	}
	e = s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		if cursor != "" && (key.Owner != owner || key.Kind != "native:"+scope.Kind || key.Character != nativeScopeRef(scope)) {
			return ErrInvalid
		}
		if cursor != "" && (key.Epoch != epoch || key.Expires <= time.Now().Unix()) {
			return chatError("CHAT_CURSOR_EXPIRED")
		}
		rows, e := tx.Query(ctx, `SELECT `+storedChatColumns+` FROM vc.stored_chat WHERE owner_user_id=$1 AND kind=$2 AND coalesce(character_ref,group_ref)=$3 AND deleted_at IS NULL AND ($4::timestamptz IS NULL OR (updated_at,chat_id)<($4,$5::uuid)) ORDER BY updated_at DESC,chat_id DESC LIMIT $6`, owner, scope.Kind, nativeScopeRef(scope), func() any {
			if cursor == "" {
				return nil
			}
			return key.UpdatedAt
		}(), func() any {
			if cursor == "" {
				return nil
			}
			return key.ChatID
		}(), limit+1)
		if e != nil {
			return e
		}
		for rows.Next() {
			c, e := s.scanStoredChat(rows, epoch)
			if e != nil {
				rows.Close()
				return e
			}
			out.Items = append(out.Items, c.StoredChatSummary)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}
		if len(out.Items) > limit {
			out.Items = out.Items[:limit]
			last := out.Items[limit-1]
			v := s.encodeChatCursor(chatKeyset{Kind: "native:" + scope.Kind, Owner: owner, Epoch: epoch, Character: nativeScopeRef(scope), UpdatedAt: last.UpdatedAt, ChatID: last.ChatID})
			out.NextCursor = &v
		}
		for i := range out.Items {
			if e = s.chatAliases(ctx, tx, owner, &out.Items[i]); e != nil {
				return e
			}
		}
		out.AuthorityEpoch = epoch
		return nil
	})
	return out, e
}
func (s *Store) RenameNativeChat(ctx context.Context, owner int64, in NativeChatMutation) (NativeChatMutationResult, error) {
	return s.nativeMutation(ctx, owner, in, false)
}
func (s *Store) DeleteNativeChat(ctx context.Context, owner int64, in NativeChatMutation) (NativeChatMutationResult, error) {
	return s.nativeMutation(ctx, owner, in, true)
}
func (s *Store) nativeMutation(ctx context.Context, owner int64, in NativeChatMutation, deleted bool) (NativeChatMutationResult, error) {
	var out NativeChatMutationResult
	if validateNativeScope(in.Scope) != nil || !validNativeName(in.Target.FileName) || (!deleted && !validNativeName(in.ToFileName)) || in.Target.ChatRevision < 0 {
		return out, ErrInvalid
	}
	if in.Target.ChatRevision >= 9007199254740991 {
		return out, chatError("CHAT_INVALID_OPERATION")
	}
	route := "rename"
	if deleted {
		route = "delete"
	}
	r, e := s.storedChatWriteBoundary(ctx, owner, "POST /api/v1/service/chats/native/"+route, in.RequestID, in.AuthorityEpoch, in, true, func(ctx context.Context, tx pgx.Tx, op string, epoch int64) (chatWriteResult, error) {
		c, e := s.nativeTarget(ctx, tx, owner, in.Scope, in.Target.FileName, epoch, true)
		if e != nil {
			return chatWriteResult{}, e
		}
		if c.ChatID != in.Target.ChatID {
			return chatWriteResult{}, ErrNotFound
		}
		if c.Revision != in.Target.ChatRevision {
			return chatWriteResult{}, chatError("REVISION_CONFLICT")
		}
		c.Revision++
		var next int64
		if e = tx.QueryRow(ctx, `SELECT next_position FROM vc.stored_chat WHERE owner_user_id=$1 AND chat_id=$2`, owner, c.ChatID).Scan(&next); e != nil {
			return chatWriteResult{}, e
		}
		if deleted {
			c.MessageCount = 0
			_, e = tx.Exec(ctx, `SELECT vc.delete_stored_chat_messages($1,$2,$3)`, owner, c.ChatID, c.Revision)
		} else {
			_, e = tx.Exec(ctx, `SELECT vc.rename_chat_file($1,$2,$3)`, owner, c.ChatID, in.ToFileName)
			c.FileName = in.ToFileName
		}
		if e != nil {
			return chatWriteResult{}, e
		}
		if e = s.persistStoredChat(ctx, tx, owner, c, next, false, false, deleted); e != nil {
			return chatWriteResult{}, e
		}
		if deleted {
			if _, e = tx.Exec(ctx, `SELECT vc.revoke_stored_chat_sources($1,$2,'{}',true)`, owner, c.ChatID); e != nil {
				return chatWriteResult{}, e
			}
			if _, e = tx.Exec(ctx, `SELECT vc.clear_stored_chat_receipt_bodies($1,$2)`, owner, c.ChatID); e != nil {
				return chatWriteResult{}, e
			}
		}
		if e = publishStoredSources(ctx, tx, owner, c.ChatID, nil, nil, false); e != nil {
			return chatWriteResult{}, e
		}
		if _, e = tx.Exec(ctx, `SELECT vc.fence_changed_stored_chat_runs($1,$2)`, owner, c.ChatID); e != nil {
			return chatWriteResult{}, e
		}
		event := ChatChange{OperationID: op, Revision: c.Revision, MetadataRevision: c.MetadataRevision, OrderRevision: c.OrderRevision, AuthorityEpoch: epoch, ChangedIDs: []string{}, DeletedIDs: []string{}, Deleted: deleted}
		if e = storeChatChange(ctx, tx, owner, c.ChatID, event); e != nil {
			return chatWriteResult{}, e
		}
		out = NativeChatMutationResult{RequestID: in.RequestID, Result: NativeChatMutationAck{Scope: in.Scope, FileName: c.FileName, ChatID: c.ChatID, ChatRevision: c.Revision, AuthorityEpoch: epoch, Deleted: deleted}}
		b, e := chatJSON(out)
		return chatWriteResult{ChatID: c.ChatID, Revision: c.Revision, Status: 200, Body: b}, e
	})
	if e == nil {
		e = chatDecode(r.Body, &out)
	}
	return out, e
}
