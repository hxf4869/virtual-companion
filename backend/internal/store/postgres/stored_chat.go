package postgres

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// ChatError carries a frozen, body-free chat protocol error.
type ChatError struct{ Code string }

func (e *ChatError) Error() string { return e.Code }
func chatError(code string) error  { return &ChatError{Code: code} }
func mapChatErr(err error) error {
	var e *ChatError
	if errors.As(err, &e) {
		return e
	}
	return mapStoreErr(err)
}

type ChatData map[string]any

type StoredChatSummary struct {
	ChatID           string    `json:"chatId"`
	Kind             string    `json:"kind"`
	ConversationID   *int64    `json:"conversationId,string"`
	RelationshipID   *int64    `json:"relationshipId,string"`
	CharacterRef     *string   `json:"characterRef"`
	GroupRef         *string   `json:"groupRef"`
	BranchRoot       string    `json:"branchRoot"`
	Revision         int64     `json:"chatRevision,string"`
	MetadataRevision int64     `json:"metadataRevision,string"`
	OrderRevision    int64     `json:"orderRevision,string"`
	AuthorityEpoch   int64     `json:"authorityEpoch,string"`
	Title            string    `json:"title"`
	MessageCount     int64     `json:"messageCount"`
	UpdatedAt        time.Time `json:"updatedAt"`
	FileName         string    `json:"fileName"`
	FileAliases      []string  `json:"fileAliases"`
}
type StoredChat struct {
	StoredChatSummary
	Header   ChatData `json:"header"`
	Metadata ChatData `json:"metadata"`
}
type StoredCandidate struct {
	CandidateID      string   `json:"candidateId"`
	SourceRevision   int64    `json:"sourceRevision,string"`
	SourceGeneration int64    `json:"sourceGeneration,string"`
	Data             ChatData `json:"data"`
	settled          bool
	everSelected     bool
}
type StoredMessage struct {
	MessageID           string            `json:"messageId"`
	Revision            int64             `json:"messageRevision,string"`
	Position            string            `json:"position"`
	View                string            `json:"view"`
	SelectedCandidateID string            `json:"selectedCandidateId"`
	CandidateCount      int               `json:"candidateCount"`
	Candidates          []StoredCandidate `json:"candidates"`
	Data                ChatData          `json:"data"`
}
type ChatChange struct {
	OperationID      string   `json:"operationId"`
	Revision         int64    `json:"chatRevision,string"`
	MetadataRevision int64    `json:"metadataRevision,string"`
	OrderRevision    int64    `json:"orderRevision,string"`
	AuthorityEpoch   int64    `json:"authorityEpoch,string"`
	ChangedIDs       []string `json:"changedIds"`
	DeletedIDs       []string `json:"deletedIds"`
	MetadataChanged  bool     `json:"metadataChanged"`
	OrderChanged     bool     `json:"orderChanged"`
	Deleted          bool     `json:"deleted"`
}
type ChatCommit struct {
	HTTPStatus       int             `json:"-"`
	RequestID        string          `json:"requestId"`
	OperationID      string          `json:"operationId"`
	ChatID           string          `json:"chatId"`
	Rebased          bool            `json:"rebased"`
	Revision         int64           `json:"chatRevision,string"`
	MetadataRevision int64           `json:"metadataRevision,string"`
	OrderRevision    int64           `json:"orderRevision,string"`
	AuthorityEpoch   int64           `json:"authorityEpoch,string"`
	Changed          []StoredMessage `json:"changed"`
	DeletedIDs       []string        `json:"deletedIds"`
	Chat             *StoredChat     `json:"chat,omitempty"`
	Deleted          bool            `json:"deleted"`
}
type ChatCreate struct {
	RequestID      string  `json:"requestId"`
	AuthorityEpoch int64   `json:"authorityEpoch,string"`
	Kind           string  `json:"kind"`
	CharacterRef   *string `json:"characterRef,omitempty"`
	GroupRef       *string `json:"groupRef,omitempty"`
	Mode           string  `json:"mode,omitempty"`
	Title          string  `json:"title,omitempty"`
}

func chatUUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
func chatJSON(v any) ([]byte, error) { return json.Marshal(v) }
func chatDecode(data []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	return d.Decode(v)
}

// Request hashes implement the SX-2 idempotency contract, not content identity.
func chatDigest(v any) ([]byte, error) {
	data, err := canonicalChatJSON(v)
	if err != nil {
		return nil, ErrInvalid
	}
	sum := sha256.Sum256(data)
	return sum[:], nil
}

const storedChatColumns = `chat_id::text,kind,conversation_id,relationship_id,character_ref,group_ref,
 branch_root::text,revision,metadata_revision,order_revision,title,message_count,updated_at,header_cipher,metadata_cipher`

func (s *Store) scanStoredChat(row pgx.Row, epoch int64) (StoredChat, error) {
	var c StoredChat
	var h, m string
	c.AuthorityEpoch = epoch
	err := row.Scan(&c.ChatID, &c.Kind, &c.ConversationID, &c.RelationshipID, &c.CharacterRef, &c.GroupRef,
		&c.BranchRoot, &c.Revision, &c.MetadataRevision, &c.OrderRevision, &c.Title, &c.MessageCount, &c.UpdatedAt, &h, &m)
	if errors.Is(err, pgx.ErrNoRows) {
		return c, ErrNotFound
	}
	if err != nil {
		return c, err
	}
	if err = s.decodeChatJSON(h, &c.Header); err != nil {
		return c, err
	}
	err = s.decodeChatJSON(m, &c.Metadata)
	c.FileName = c.ChatID + ".jsonl"
	c.FileAliases = []string{c.FileName}
	return c, err
}
func lockChatAuthority(ctx context.Context, tx pgx.Tx, owner int64, write bool) (string, int64, error) {
	var authority string
	var epoch int64
	err := tx.QueryRow(ctx, `SELECT authority,epoch FROM vc.lock_chat_authority($1,$2)`, owner, write).Scan(&authority, &epoch)
	return authority, epoch, err
}

type chatWriteResult struct {
	ChatID   string
	Revision int64
	Status   int
	Body     json.RawMessage
}
type chatWriteWork func(context.Context, pgx.Tx, string, int64) (chatWriteResult, error)

// All writers share this boundary: authority and deletion locks, replay, data,
// source barriers (inside work), change/outbox and receipt commit together.
func (s *Store) storedChatWrite(ctx context.Context, owner int64, resource, requestID string, epoch int64, payload any, work chatWriteWork) (chatWriteResult, error) {
	return s.storedChatWriteBoundary(ctx, owner, resource, requestID, epoch, payload, false, work)
}

func (s *Store) storedChatWriteBoundary(ctx context.Context, owner int64, resource, requestID string, epoch int64, payload any, transfer bool, work chatWriteWork) (chatWriteResult, error) {
	var result chatWriteResult
	if s == nil || s.cipher == nil {
		return result, errStore
	}
	if requestID == "" {
		return result, chatError("CHAT_PRECONDITION_REQUIRED")
	}
	if epoch < 0 {
		return result, ErrInvalid
	}
	if !stsource.ValidIdentity(requestID) {
		return result, ErrInvalid
	}
	digest, err := chatDigest(payload)
	if err != nil {
		return result, err
	}
	boundary := s.WithOwner
	if transfer {
		boundary = func(ctx context.Context, owner int64, work TxWork) error {
			return s.withChatTransfer(ctx, owner, pgx.TxOptions{}, work)
		}
	}
	err = boundary(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		authority, current, err := lockChatAuthority(ctx, tx, owner, true)
		if err != nil {
			return err
		}
		if authority != "GO" || current != epoch {
			return chatError("CHAT_AUTHORITY_CHANGED")
		}
		if _, err := tx.Exec(ctx, `SELECT vc.expire_stored_chat_runs($1)`, owner); err != nil {
			return err
		}
		// The owner memory barrier serializes receipt lookup with all chat writers.
		var oldDigest []byte
		var body *string
		var expires time.Time
		err = tx.QueryRow(ctx, `SELECT request_digest,chat_id::text,result_revision,status,result_cipher,expires_at
   FROM vc.chat_receipt WHERE owner_user_id=$1 AND resource=$2 AND request_id=$3`, owner, resource, requestID).
			Scan(&oldDigest, &result.ChatID, &result.Revision, &result.Status, &body, &expires)
		if err == nil {
			if !bytes.Equal(digest, oldDigest) {
				return chatError("IDEMPOTENCY_KEY_REUSED")
			}
			// A receipt never bypasses a subsequent conversation/relationship deletion.
			var live bool
			err = tx.QueryRow(ctx, `SELECT true FROM vc.lock_stored_chat($1,$2,false)`, owner, result.ChatID).Scan(&live)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if !live && resource != "DELETE /api/v1/chats/"+result.ChatID && resource != "POST /api/v1/service/chats/native/delete" {
				return ErrNotFound
			}
			if body == nil || !expires.After(time.Now()) {
				return chatError("OPERATION_RESULT_EXPIRED")
			}
			plain, err := s.decryptStored(*body)
			if err != nil {
				return err
			}
			result.Body = []byte(plain)
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		operationID := chatUUID()
		result, err = work(ctx, tx, operationID, current)
		if err != nil {
			return err
		}
		encrypted, err := s.encryptStored(string(result.Body))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT vc.insert_chat_receipt($1,$2,$3,$4,$5,$6,$7,$8,$9)`, owner, resource, requestID, digest, operationID, result.ChatID, result.Revision, result.Status, encrypted)
		return err
	})
	return result, mapChatErr(err)
}

func storeChatChange(ctx context.Context, tx pgx.Tx, owner int64, chatID string, event ChatChange) error {
	data, err := chatJSON(event)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT vc.insert_chat_change($1,$2,$3,$4)`, owner, chatID, event.Revision, data)
	return err
}

func (s *Store) CreateStoredChat(ctx context.Context, owner int64, in ChatCreate) (StoredChat, error) {
	var out StoredChat
	in.RequestID = strings.ToLower(in.RequestID)
	if (in.Kind == "SINGLE" && (in.CharacterRef == nil || *in.CharacterRef == "" || in.GroupRef != nil || (in.Mode != "COMPANION" && in.Mode != "STORY"))) ||
		(in.Kind == "GROUP" && (in.GroupRef == nil || *in.GroupRef == "" || in.CharacterRef != nil || in.Mode != "")) || (in.Kind != "SINGLE" && in.Kind != "GROUP") {
		return out, ErrInvalid
	}
	result, err := s.storedChatWrite(ctx, owner, "POST /api/v1/chats", in.RequestID, in.AuthorityEpoch, in, func(ctx context.Context, tx pgx.Tx, op string, epoch int64) (chatWriteResult, error) {
		id := chatUUID()
		var conversation, relationship *int64
		if in.Kind == "SINGLE" {
			var c, r int64
			if err := tx.QueryRow(ctx, `SELECT out_conversation_id,out_relationship_id FROM vc.resolve_st_binding($1,$2,$3,$4,NULL,'')`, owner, id, *in.CharacterRef, in.Mode).Scan(&c, &r); err != nil {
				return chatWriteResult{}, err
			}
			conversation = &c
			relationship = &r
		}
		header := ChatData{"vc_f2": ChatData{"id": id, "revision": 1}, "vc_branch_root": id}
		if conversation != nil {
			header["vc_binding"] = ChatData{"conversationId": fmt.Sprint(*conversation), "relationshipId": fmt.Sprint(*relationship), "chatIdentity": id, "characterRef": *in.CharacterRef, "mode": in.Mode}
		}
		h, err := s.encodeChatJSON(header)
		if err != nil {
			return chatWriteResult{}, err
		}
		metadata, err := s.encodeChatJSON(ChatData{})
		if err != nil {
			return chatWriteResult{}, err
		}
		c, err := s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.insert_stored_chat($1,$2,$3,$4,$5,$6,$7,$2,$8,$9,$10)`, owner, id, in.Kind, conversation, relationship, in.CharacterRef, in.GroupRef, in.Title, h, metadata), epoch)
		if err != nil {
			return chatWriteResult{}, err
		}
		if err = publishStoredSources(ctx, tx, owner, id, nil, nil, false); err != nil {
			return chatWriteResult{}, err
		}
		event := ChatChange{OperationID: op, Revision: c.Revision, MetadataRevision: c.MetadataRevision, OrderRevision: c.OrderRevision, AuthorityEpoch: epoch, ChangedIDs: []string{}, DeletedIDs: []string{}, MetadataChanged: true}
		if err = storeChatChange(ctx, tx, owner, id, event); err != nil {
			return chatWriteResult{}, err
		}
		body, err := chatJSON(c)
		return chatWriteResult{ChatID: id, Revision: c.Revision, Status: 201, Body: body}, err
	})
	if err != nil {
		return out, err
	}
	err = chatDecode(result.Body, &out)
	return out, mapChatErr(err)
}

// Raw chat and receipt documents remain in the Go encrypted domain. Only the
// existing memory source projection is allowed to retain plaintext evidence.
func (s *Store) encodeChatJSON(v ChatData) (string, error) {
	if s == nil || s.cipher == nil {
		return "", errStore
	}
	if v == nil {
		return "", ErrInvalid
	}
	b, err := chatJSON(v)
	if err != nil {
		return "", ErrInvalid
	}
	return s.encryptStored(string(b))
}
func (s *Store) decodeChatJSON(v string, out any) error {
	plain, err := s.decryptStored(v)
	if err != nil {
		return err
	}
	return chatDecode([]byte(plain), out)
}
