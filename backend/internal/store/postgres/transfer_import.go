package postgres

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/jackc/pgx/v5"
)

func (s *Store) BeginChatTransfer(ctx context.Context, owner int64) (ChatTransferIntent, error) {
	out := ChatTransferIntent{ID: chatUUID()}
	work := func(ctx context.Context, tx pgx.Tx) error {
		query := `SELECT prefix,expires_at FROM vc.begin_chat_transfer($1,$2)`
		args := []any{owner, out.ID}
		if owner == 0 {
			query = `SELECT prefix,expires_at FROM vc.begin_unbound_chat_transfer($1)`
			args = []any{out.ID}
		}
		return tx.QueryRow(ctx, query, args...).Scan(&out.Prefix, &out.ExpiresAt)
	}
	var err error
	if owner == 0 {
		err = s.withoutOwner(ctx, work)
	} else {
		err = s.WithOwner(ctx, owner, work)
	}
	return out, mapChatErr(err)
}
func (s *Store) BindChatTransfer(ctx context.Context, owner int64, id string) error {
	return s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var ok bool
		err := tx.QueryRow(ctx, `SELECT vc.bind_chat_transfer($1,$2)`, owner, id).Scan(&ok)
		if err == nil && !ok {
			return ErrNotFound
		}
		return err
	})
}
func (s *Store) ReleaseChatTransfer(ctx context.Context, owner int64, id string) error {
	if owner == 0 {
		return s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
			_, e := tx.Exec(ctx, `SELECT vc.release_unbound_chat_transfer($1)`, id)
			return e
		})
	}
	return s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.release_chat_transfer($1,$2)`, owner, id)
		return err
	})
}
func (s *Store) CleanupChatTransfers(ctx context.Context, objects chattransfer.Objects, limit int) (int, error) {
	if objects == nil {
		return 0, ErrInvalid
	}
	limit = min(max(limit, 1), 256)
	intents := []ChatTransferIntent{}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT transfer_id::text,prefix,expires_at FROM vc.list_chat_transfer_cleanup($1)`, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var i ChatTransferIntent
			if err = rows.Scan(&i.ID, &i.Prefix, &i.ExpiresAt); err != nil {
				return err
			}
			intents = append(intents, i)
		}
		return rows.Err()
	})
	if err != nil {
		return 0, err
	}
	deleted := 0
	for _, i := range intents {
		keys, e := objects.ListKeys(ctx, i.Prefix, "", limit-deleted)
		if e != nil {
			return deleted, e
		}
		for _, key := range keys {
			if e = objects.Delete(ctx, key); e != nil {
				return deleted, e
			}
			deleted++
		}
		if len(keys) == 0 {
			e = s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
				_, e := tx.Exec(ctx, `SELECT vc.finish_chat_transfer_cleanup($1)`, i.ID)
				return e
			})
			if e != nil {
				return deleted, e
			}
		}
		if deleted >= limit {
			break
		}
	}
	return deleted, nil
}

type importInput struct {
	Request  ChatImportRequest     `json:"request"`
	Manifest chattransfer.Manifest `json:"manifest"`
	IntentID string                `json:"intentId"`
	SHA256   string                `json:"sha256"`
}

func validTransferHash(value string) bool {
	b, e := hex.DecodeString(value)
	return e == nil && len(b) == 32 && value == fmt.Sprintf("%x", b)
}
func (s *Store) SealChatImport(ctx context.Context, owner int64, in ChatImportRequest, intentID string, manifest chattransfer.Manifest, fileSHA256 string) (ChatImportAccepted, error) {
	var out ChatImportAccepted
	in.RequestID = strings.ToLower(in.RequestID)
	scope := NativeChatScope{Kind: in.Kind, CharacterRef: in.CharacterRef, GroupRef: in.GroupRef}
	if validateNativeScope(scope) != nil || !validTransferHash(fileSHA256) || in.AuthorityEpoch <= 0 || !validTransferMode(scope, in.Mode) {
		return out, ErrInvalid
	}
	if _, e := normalizeChatID(in.RequestID); e != nil {
		return out, e
	}
	digest, err := chatDigest(struct {
		Request ChatImportRequest
		SHA256  string
	}{in, fileSHA256})
	if err != nil {
		return out, err
	}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		authority, epoch, e := lockChatAuthority(ctx, tx, owner, true)
		if e != nil {
			return e
		}
		if authority != "GO" || epoch != in.AuthorityEpoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		var old []byte
		var oldInput *string
		e = tx.QueryRow(ctx, `SELECT import_id::text,request_digest,expires_at,input_cipher FROM vc.chat_import WHERE owner_user_id=$1 AND request_id=$2`, owner, in.RequestID).Scan(&out.ImportID, &old, &out.ExpiresAt, &oldInput)
		if e == nil {
			if !bytes.Equal(old, digest) {
				return chatError("IDEMPOTENCY_KEY_REUSED")
			}
			if !out.ExpiresAt.After(time.Now()) {
				return chatError("CHAT_IMPORT_EXPIRED")
			}
			if oldInput != nil {
				var previous importInput
				if e = s.decodeChatJSON(*oldInput, &previous); e != nil {
					return e
				}
				if previous.IntentID == intentID {
					return nil
				}
			}
			_, e = tx.Exec(ctx, `SELECT vc.release_chat_transfer($1,$2)`, owner, intentID)
			return e
		}
		if !errors.Is(e, pgx.ErrNoRows) {
			return e
		}
		var active bool
		if e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.chat_import WHERE owner_user_id=$1 AND status='PENDING' AND expires_at>now())`, owner).Scan(&active); e != nil {
			return e
		}
		if active {
			return chatError("RATE_LIMITED")
		}
		var prefix string
		if e = tx.QueryRow(ctx, `SELECT prefix,expires_at FROM vc.chat_transfer_object WHERE owner_user_id=$1 AND transfer_id=$2 AND NOT released AND expires_at>now()`, owner, intentID).Scan(&prefix, &out.ExpiresAt); e != nil {
			return e
		}
		expectedChunks := int64(0)
		if manifest.Bytes > 0 {
			expectedChunks = (manifest.Bytes-1)/chattransfer.ChunkBytes + 1
		}
		if prefix != manifest.Prefix || manifest.Bytes > chatjsonl.MaxFileBytes || manifest.Bytes < 0 || int64(manifest.Chunks) != expectedChunks {
			return ErrInvalid
		}
		out.ImportID = chatUUID()
		if e = tx.QueryRow(ctx, `SELECT now()+interval '24 hours'`).Scan(&out.ExpiresAt); e != nil {
			return e
		}
		input, e := s.encodeChatJSON(asData(importInput{in, manifest, intentID, fileSHA256}))
		if e != nil {
			return e
		}
		result := ChatImportResult{ImportID: out.ImportID, Status: "PENDING", Issues: []chatjsonl.Issue{}, ExpiresAt: out.ExpiresAt}
		body, e := s.encodeChatJSON(asData(result))
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `SELECT vc.seal_chat_import($1,$2,$3,$4,$5,$6,$7,$8)`, owner, out.ImportID, in.RequestID, digest, in.AuthorityEpoch, chatUUID(), input, body)
		if e == nil {
			_, e = tx.Exec(ctx, `SELECT vc.limit_chat_transfer_expiry($1,$2,$3)`, owner, intentID, out.ImportID)
		}
		return e
	})
	out.RequestID = in.RequestID
	out.Status = "PENDING"
	out.StatusURL = "/api/v1/chats/imports/" + out.ImportID
	return out, mapChatErr(err)
}
func asData(v any) ChatData { b, _ := chatJSON(v); var d ChatData; _ = chatDecode(b, &d); return d }
func (s *Store) GetChatImport(ctx context.Context, owner int64, id string) (ChatImportResult, error) {
	var out ChatImportResult
	if _, e := normalizeChatID(id); e != nil {
		return out, e
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if _, _, e := lockChatAuthority(ctx, tx, owner, false); e != nil {
			return e
		}
		var body *string
		var expires time.Time
		e := tx.QueryRow(ctx, `SELECT result_cipher,expires_at FROM vc.chat_import WHERE owner_user_id=$1 AND import_id=$2`, owner, id).Scan(&body, &expires)
		if errors.Is(e, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if e != nil {
			return e
		}
		if body == nil || !expires.After(time.Now()) {
			return chatError("CHAT_IMPORT_EXPIRED")
		}
		return s.decodeChatJSON(*body, &out)
	})
	return out, mapChatErr(err)
}
func (s *Store) PendingChatImports(ctx context.Context, limit int) ([]ChatImportWork, error) {
	out := []ChatImportWork{}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, e := tx.Query(ctx, `SELECT owner_user_id,import_id::text FROM vc.pending_chat_imports($1)`, limit)
		if e != nil {
			return e
		}
		defer rows.Close()
		for rows.Next() {
			var w ChatImportWork
			if e = rows.Scan(&w.Owner, &w.ImportID); e != nil {
				return e
			}
			out = append(out, w)
		}
		return rows.Err()
	})
	return out, err
}

// ProcessChatImport is called by the existing jobs loop. The persistent lease is
// fenced at checkpoint and commit, so a crashed worker cannot publish after a
// successor has claimed the same import. Transient failures leave PENDING.
func (s *Store) ProcessChatImport(ctx context.Context, owner int64, id string, objects chattransfer.Objects) error {
	ctx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	token := chatUUID()
	var input importInput
	var p preparedTransfer
	var status ChatImportResult
	var chatID string
	var prepared *string
	claimed := false
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if e := tx.QueryRow(ctx, `SELECT vc.claim_chat_import($1,$2,$3)`, owner, id, token).Scan(&claimed); e != nil || !claimed {
			return e
		}
		var raw, body string
		if e := tx.QueryRow(ctx, `SELECT chat_id::text,input_cipher,prepared_cipher,result_cipher FROM vc.chat_import WHERE owner_user_id=$1 AND import_id=$2`, owner, id).Scan(&chatID, &raw, &prepared, &body); e != nil {
			return e
		}
		if e := s.decodeChatJSON(raw, &input); e != nil {
			return e
		}
		return s.decodeChatJSON(body, &status)
	})
	if err != nil || !claimed {
		return err
	}
	in := NativeChatUpload{RequestID: input.Request.RequestID, AuthorityEpoch: input.Request.AuthorityEpoch, ChatID: chatID, Scope: NativeChatScope{Kind: input.Request.Kind, CharacterRef: input.Request.CharacterRef, GroupRef: input.Request.GroupRef}, Mode: input.Request.Mode, FileName: chatID + ".jsonl"}
	finishFailure := func(code string) error {
		status.Status = "FAILED"
		status.FailureCode = &code
		status.ChatID = nil
		body, e := s.encodeChatJSON(asData(status))
		if e != nil {
			return e
		}
		e = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			var ok bool
			e := tx.QueryRow(ctx, `SELECT vc.finish_chat_import($1,$2,$3,'FAILED',$4)`, owner, id, token, body).Scan(&ok)
			if e == nil && !ok {
				return chatError("CHAT_IMPORT_EXPIRED")
			}
			return e
		})
		if e == nil {
			_ = s.ReleaseChatTransfer(ctx, owner, input.IntentID)
			if p.Intent.ID != "" {
				_ = s.ReleaseChatTransfer(ctx, owner, p.Intent.ID)
			}
		}
		return e
	}
	if prepared != nil {
		err = s.decodeChatJSON(*prepared, &p)
	} else {
		p, err = s.prepareTransfer(ctx, owner, "create", in, input.Manifest, objects)
		if err != nil {
			var ce *ChatError
			if errors.As(err, &ce) && (ce.Code == "CHAT_PAYLOAD_TOO_LARGE" || ce.Code == "CHAT_INVALID_OPERATION") {
				code := chatjsonl.InvalidCode
				if ce.Code == chatjsonl.TooLargeCode {
					code = ce.Code
				}
				return finishFailure(code)
			}
			return err
		}
		status.ValidatedMessages = p.Result.ValidatedMessages
		status.ValidatedCandidates = p.Result.ValidatedCandidates
		status.UnresolvedExtensionReferences = p.Result.UnresolvedExtensionReferences
		status.Issues = p.Result.Issues
		status.IssuesTruncated = p.Result.IssuesTruncated
		if len(status.Issues) > 0 {
			return finishFailure(transferFailureCode(p))
		}
		cipher, e := s.encodeChatJSON(asData(p))
		if e != nil {
			return e
		}
		err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
			var ok bool
			e := tx.QueryRow(ctx, `SELECT vc.checkpoint_chat_import($1,$2,$3,$4)`, owner, id, token, cipher).Scan(&ok)
			if e == nil && ok {
				_, e = tx.Exec(ctx, `SELECT vc.limit_chat_transfer_expiry($1,$2,$3)`, owner, p.Intent.ID, id)
			}
			if e == nil && !ok {
				return chatError("CHAT_IMPORT_EXPIRED")
			}
			return e
		})
	}
	if err != nil {
		return err
	}
	// Status is reconstructed from the checkpoint after a process restart.
	status.ValidatedMessages = p.Result.ValidatedMessages
	status.ValidatedCandidates = p.Result.ValidatedCandidates
	status.UnresolvedExtensionReferences = p.Result.UnresolvedExtensionReferences
	err = s.withChatTransfer(ctx, owner, pgx.TxOptions{}, func(ctx context.Context, tx pgx.Tx) error {
		mode, epoch, e := lockChatAuthority(ctx, tx, owner, true)
		if e != nil {
			return e
		}
		if mode != "GO" || epoch != in.AuthorityEpoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		var valid bool
		e = tx.QueryRow(ctx, `SELECT vc.lock_chat_import_lease($1,$2,$3)`, owner, id, token).Scan(&valid)
		if errors.Is(e, pgx.ErrNoRows) {
			return chatError("CHAT_IMPORT_EXPIRED")
		}
		if e != nil {
			return e
		}
		if !valid {
			return chatError("CHAT_IMPORT_EXPIRED")
		}
		if _, e = s.commitPreparedTransfer(ctx, tx, owner, in, "create", p, objects, chatUUID(), epoch); e != nil {
			return e
		}
		status.Status = "DONE"
		status.ChatID = &chatID
		status.FailureCode = nil
		body, e := s.encodeChatJSON(asData(status))
		if e != nil {
			return e
		}
		if e = tx.QueryRow(ctx, `SELECT vc.finish_chat_import($1,$2,$3,'DONE',$4)`, owner, id, token, body).Scan(&valid); e != nil {
			return e
		}
		if !valid {
			return chatError("CHAT_IMPORT_EXPIRED")
		}
		return nil
	})
	if err != nil {
		var ce *ChatError
		if errors.As(err, &ce) && ce.Code == "CHAT_AUTHORITY_CHANGED" {
			return finishFailure(ce.Code)
		}
		if errors.As(err, &ce) && ce.Code == chatjsonl.TooLargeCode {
			status.Issues = []chatjsonl.Issue{{Line: 1, Code: ce.Code, Reason: "HEADER_TOO_LARGE"}}
			return finishFailure(ce.Code)
		}
		return err
	}
	_ = s.ReleaseChatTransfer(ctx, owner, input.IntentID)
	_ = s.ReleaseChatTransfer(ctx, owner, p.Intent.ID)
	return nil
}
