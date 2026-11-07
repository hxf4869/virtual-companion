package postgres

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/text/cases"
)

const storedChatPageBytes = 256 << 10
const storedChatSearchDocuments = 200
const storedChatSearchBytes = 8 << 20

type ChatListQuery struct {
	Cursor, CharacterRef, Q string
	RelationshipID          *int64
	Limit                   int
}
type ChatMessageQuery struct {
	Before, After, AnchorMessageID, View, Q string
	IncludeChat                             bool
	Limit                                   int
}
type StoredChatPage struct {
	Items          []StoredChatSummary `json:"items"`
	NextCursor     *string             `json:"nextCursor"`
	AuthorityEpoch int64               `json:"authorityEpoch,string"`
}
type StoredMessagePage struct {
	ChatID           string          `json:"chatId"`
	Revision         int64           `json:"chatRevision,string"`
	MetadataRevision int64           `json:"metadataRevision,string"`
	OrderRevision    int64           `json:"orderRevision,string"`
	AuthorityEpoch   int64           `json:"authorityEpoch,string"`
	Items            []StoredMessage `json:"items"`
	BeforeCursor     *string         `json:"beforeCursor"`
	AfterCursor      *string         `json:"afterCursor"`
	HasOlder         bool            `json:"hasOlder"`
	HasNewer         bool            `json:"hasNewer"`
	Chat             *StoredChat     `json:"chat,omitempty"`
}
type ChatChangesPage struct {
	ChatID          string       `json:"chatId"`
	AuthorityEpoch  int64        `json:"authorityEpoch,string"`
	Items           []ChatChange `json:"items"`
	ThroughRevision int64        `json:"throughRevision,string"`
	CurrentRevision int64        `json:"currentRevision,string"`
	HasMore         bool         `json:"hasMore"`
}

type chatKeyset struct {
	Kind         string    `json:"kind"`
	Owner        int64     `json:"owner,string"`
	ChatID       string    `json:"chat,omitempty"`
	Epoch        int64     `json:"epoch,string"`
	Order        int64     `json:"order,string"`
	Position     int64     `json:"position,string"`
	UpdatedAt    time.Time `json:"updatedAt"`
	View         string    `json:"view,omitempty"`
	Q            string    `json:"q,omitempty"`
	Character    string    `json:"character,omitempty"`
	Relationship string    `json:"relationship,omitempty"`
	Expires      int64     `json:"expires"`
}

// Authentication is domain-separated from owner-context proofs. Cursor fields
// are not trusted until their MAC and the current owner/filter fences match.
func (s *Store) encodeChatCursor(c chatKeyset) string {
	c.Expires = time.Now().Add(15 * time.Minute).Unix()
	b, _ := json.Marshal(c)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("vc-chat-keyset-v1\x00"))
	mac.Write(b)
	return base64.RawURLEncoding.EncodeToString(b) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Store) decodeChatCursor(token string) (chatKeyset, error) {
	var c chatKeyset
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return c, ErrInvalid
	}
	b, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return c, ErrInvalid
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return c, ErrInvalid
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte("vc-chat-keyset-v1\x00"))
	mac.Write(b)
	if !hmac.Equal(mac.Sum(nil), sig) || json.Unmarshal(b, &c) != nil {
		return c, ErrInvalid
	}
	return c, nil
}
func chatPageLimit(limit int) (int, error) {
	if limit == 0 {
		return 50, nil
	}
	if limit < 1 || limit > 200 {
		return 0, ErrInvalid
	}
	return limit, nil
}
func normalizeChatQuery(q string) string    { return strings.ToLower(strings.TrimSpace(q)) }
func normalizeMessageQuery(q string) string { return cases.Fold().String(strings.TrimSpace(q)) }
func normalizeChatID(id string) (string, error) {
	id = strings.ToLower(id)
	if !stsource.ValidIdentity(id) {
		return "", ErrInvalid
	}
	return id, nil
}
func (s *Store) withStoredChatRead(ctx context.Context, owner int64, search bool, work func(context.Context, pgx.Tx, int64) error) error {
	if search {
		// Keep the deadline visible even if owner binding masks its database error.
		if ctx == nil {
			ctx = context.Background()
		}
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, s.txTimeout)
		defer cancel()
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		authority, epoch, err := lockChatAuthority(ctx, tx, owner, false)
		if err != nil {
			return err
		}
		if authority != "GO" {
			return chatError("SCHEMA_UNAVAILABLE")
		}
		return work(ctx, tx, epoch)
	})
	var pgErr *pgconn.PgError
	if search && err != nil && (errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &pgErr) && pgErr.Code == "57014")) {
		return chatError("CHAT_SEARCH_TIMEOUT")
	}
	return mapChatErr(err)
}
func (s *Store) readStoredChat(ctx context.Context, tx pgx.Tx, owner int64, id string, epoch int64) (StoredChat, error) {
	return s.scanStoredChat(tx.QueryRow(ctx, `SELECT `+storedChatColumns+` FROM vc.lock_stored_chat($1,$2,false)`, owner, id), epoch)
}
func (s *Store) GetStoredChat(ctx context.Context, owner int64, chatID string) (StoredChat, error) {
	var out StoredChat
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	err = s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		var e error
		out, e = s.readStoredChat(ctx, tx, owner, id, epoch)
		return e
	})
	return out, err
}
func (s *Store) ListStoredChats(ctx context.Context, owner int64, q ChatListQuery) (StoredChatPage, error) {
	out := StoredChatPage{Items: []StoredChatSummary{}}
	limit, err := chatPageLimit(q.Limit)
	if err != nil {
		return out, err
	}
	if q.RelationshipID != nil && *q.RelationshipID <= 0 {
		return out, ErrInvalid
	}
	q.Q = normalizeChatQuery(q.Q)
	rel := ""
	if q.RelationshipID != nil {
		rel = strconv.FormatInt(*q.RelationshipID, 10)
	}
	err = s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		out.AuthorityEpoch = epoch
		var beforeTime *time.Time
		var beforeID *string
		if q.Cursor != "" {
			c, err := s.decodeChatCursor(q.Cursor)
			if err != nil {
				return err
			}
			if c.Kind != "list" || c.Owner != owner || c.Q != q.Q || c.Character != q.CharacterRef || c.Relationship != rel {
				return ErrInvalid
			}
			if c.Epoch != epoch || c.Expires <= time.Now().Unix() {
				return chatError("CHAT_CURSOR_EXPIRED")
			}
			beforeTime = &c.UpdatedAt
			beforeID = &c.ChatID
		}
		// This projection never reads/decrypts a message, candidate, header or metadata.
		rows, err := tx.Query(ctx, `SELECT c.chat_id::text,c.kind,c.conversation_id,c.relationship_id,c.character_ref,c.group_ref,
   c.branch_root::text,c.revision,c.metadata_revision,c.order_revision,c.title,c.message_count,c.updated_at
   FROM vc.stored_chat c LEFT JOIN vc.relationship r ON(r.owner_user_id,r.id)=(c.owner_user_id,c.relationship_id)
   WHERE c.owner_user_id=$1 AND c.deleted_at IS NULL AND ($2='' OR c.character_ref=$2)
   AND ($3::bigint IS NULL OR c.relationship_id=$3)
   AND ($4='' OR strpos(lower(c.title),$4)>0 OR strpos(lower(coalesce(r.companion_name,c.character_ref,'')),$4)>0)
   AND ($5::timestamptz IS NULL OR (c.updated_at,c.chat_id)<($5,$6::uuid))
   ORDER BY c.updated_at DESC,c.chat_id DESC LIMIT $7`, owner, q.CharacterRef, q.RelationshipID, q.Q, beforeTime, beforeID, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var c StoredChatSummary
			c.AuthorityEpoch = epoch
			if err = rows.Scan(&c.ChatID, &c.Kind, &c.ConversationID, &c.RelationshipID, &c.CharacterRef, &c.GroupRef, &c.BranchRoot, &c.Revision, &c.MetadataRevision, &c.OrderRevision, &c.Title, &c.MessageCount, &c.UpdatedAt); err != nil {
				return err
			}
			out.Items = append(out.Items, c)
		}
		if err = rows.Err(); err != nil {
			return err
		}
		if len(out.Items) > limit {
			out.Items = out.Items[:limit]
			last := out.Items[len(out.Items)-1]
			cursor := s.encodeChatCursor(chatKeyset{Kind: "list", Owner: owner, ChatID: last.ChatID, Epoch: epoch, UpdatedAt: last.UpdatedAt, Q: q.Q, Character: q.CharacterRef, Relationship: rel})
			out.NextCursor = &cursor
		}
		return nil
	})
	return out, err
}

func (s *Store) GetStoredMessage(ctx context.Context, owner int64, chatID, messageID string) (StoredMessage, error) {
	var out StoredMessage
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	mid, err := normalizeChatID(messageID)
	if err != nil {
		return out, err
	}
	err = s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		if _, err := s.readStoredChat(ctx, tx, owner, id, epoch); err != nil {
			return err
		}
		m, err := s.loadStoredMessage(ctx, tx, owner, id, mid)
		if err != nil {
			return err
		}
		out, err = projectStoredMessage(m, "full")
		return err
	})
	return out, err
}

type chatMessageKey struct {
	ID       string
	Position int64
}

// Ordinary pagination and search existence probes use only indexed positions.
func (s *Store) storedMessageKeys(ctx context.Context, tx pgx.Tx, owner int64, chatID string, bound *int64, forward, inclusive bool, limit int) ([]chatMessageKey, error) {
	direction, op := "DESC", "<"
	if forward {
		direction, op = "ASC", ">"
	}
	if inclusive {
		op += "="
	}
	args := []any{owner, chatID}
	boundary := ""
	if bound != nil {
		args = append(args, *bound)
		boundary = " AND position " + op + " $3"
	}
	args = append(args, limit)
	rows, err := tx.Query(ctx, `SELECT message_id::text,position FROM vc.stored_message
 WHERE owner_user_id=$1 AND chat_id=$2 AND deleted_at IS NULL`+boundary+` ORDER BY position `+direction+` LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []chatMessageKey{}
	for rows.Next() {
		var k chatMessageKey
		if err := rows.Scan(&k.ID, &k.Position); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

type storedSearchWindow struct {
	keys        []chatMessageKey
	selected    map[string]ChatData
	first, last *int64
}

// Select at most one window before transferring ciphertext. The anchor, when
// present, is its first document; validation never scans earlier bodies. Keep
// matching selected documents for projection so none is decrypted twice.
func (s *Store) searchStoredMessageWindow(ctx context.Context, tx pgx.Tx, owner int64, chatID string, bound *int64, forward, inclusive bool, q string, limit int) (storedSearchWindow, error) {
	out := storedSearchWindow{keys: []chatMessageKey{}, selected: map[string]ChatData{}}
	direction, op := "DESC", "<"
	if forward {
		direction, op = "ASC", ">"
	}

	documents, bytes := storedChatSearchDocuments, storedChatSearchBytes
	if inclusive {
		// Validate this selected document directly before even fetching older bodies.
		var k chatMessageKey
		var encrypted string
		err := tx.QueryRow(ctx, `SELECT m.message_id::text,m.position,c.data_cipher FROM vc.stored_message m
  JOIN vc.stored_candidate c ON(c.owner_user_id,c.chat_id,c.message_id,c.candidate_id)=(m.owner_user_id,m.chat_id,m.message_id,m.selected_candidate_id)
  WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.position=$3 AND m.deleted_at IS NULL AND c.deleted_at IS NULL`, owner, chatID, bound).Scan(&k.ID, &k.Position, &encrypted)
		if errors.Is(err, pgx.ErrNoRows) {
			return out, ErrNotFound
		}
		if err != nil {
			return out, err
		}
		var data ChatData
		if err := s.decodeChatJSON(encrypted, &data); err != nil {
			return out, err
		}
		mes, _ := data["mes"].(string)
		if !strings.Contains(cases.Fold().String(mes), q) {
			return out, ErrNotFound
		}
		out.keys = append(out.keys, k)
		out.selected[k.ID] = data
		first, last := k.Position, k.Position
		out.first, out.last = &first, &last
		documents--
		bytes -= len(encrypted)
		if len(out.keys) == limit || bytes <= 0 {
			return out, nil
		}
	}
	args := []any{owner, chatID, documents, bytes, !inclusive}
	boundary := ""
	if bound != nil {
		args = append(args, *bound)
		boundary = " AND m.position " + op + " $6"
	}
	rows, err := tx.Query(ctx, `WITH page AS MATERIALIZED (
 SELECT m.message_id,m.position,m.selected_candidate_id FROM vc.stored_message m
 WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL`+boundary+` ORDER BY m.position `+direction+` LIMIT $3
 ), sizes AS MATERIALIZED (
 SELECT m.*,c.bytes FROM page m JOIN LATERAL (
 SELECT octet_length(data_cipher) AS bytes FROM vc.stored_candidate c
 WHERE c.owner_user_id=$1 AND c.chat_id=$2 AND c.message_id=m.message_id AND c.candidate_id=m.selected_candidate_id AND c.deleted_at IS NULL LIMIT 1
 ) c ON true
 ), sized AS (
 SELECT *,row_number() OVER(ORDER BY position `+direction+`) AS n,
 sum(bytes) OVER(ORDER BY position `+direction+`) AS scanned_bytes FROM sizes
 ) SELECT m.message_id::text,m.position,c.data_cipher FROM sized m JOIN LATERAL (
 SELECT data_cipher FROM vc.stored_candidate c WHERE c.owner_user_id=$1 AND c.chat_id=$2 AND c.message_id=m.message_id AND c.candidate_id=m.selected_candidate_id AND c.deleted_at IS NULL LIMIT 1
 ) c ON true WHERE ($5 AND m.n=1) OR m.scanned_bytes<=$4 ORDER BY m.position `+direction, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	fold := cases.Fold()
	for rows.Next() {
		var k chatMessageKey
		var encrypted string
		if err := rows.Scan(&k.ID, &k.Position, &encrypted); err != nil {
			return out, err
		}
		var data ChatData
		if err := s.decodeChatJSON(encrypted, &data); err != nil {
			return out, err
		}
		mes, _ := data["mes"].(string)
		match := strings.Contains(fold.String(mes), q)
		if out.first == nil {
			first := k.Position
			out.first = &first
		}
		last := k.Position
		out.last = &last
		if match {
			out.keys = append(out.keys, k)
			out.selected[k.ID] = data
			if len(out.keys) == limit {
				break
			}
		}
	}
	// A full match page can stop before Next closes rows; drain before Err.
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}
	return out, nil
}

// Ciphertext sizes are available without decrypting or transferring the bodies.
// Stop the SQL page at a soft byte budget (but always include its first row).
func (s *Store) loadStoredMessagePage(ctx context.Context, tx pgx.Tx, owner int64, chatID string, keys []chatMessageKey, view string, forward bool, selected map[string]ChatData) ([]StoredMessage, error) {
	result := []StoredMessage{}
	if len(keys) == 0 {
		return result, nil
	}
	ids := make([]string, len(keys))
	for i, k := range keys {
		ids[i] = k.ID
	}
	direction := "DESC"
	if forward {
		direction = "ASC"
	}
	rows, err := tx.Query(ctx, `WITH sizes AS (
  SELECT m.*, (SELECT count(*) FROM vc.stored_candidate c WHERE (c.owner_user_id,c.chat_id,c.message_id)=(m.owner_user_id,m.chat_id,m.message_id) AND c.deleted_at IS NULL) AS candidate_count,
   octet_length(m.data_cipher)+768+(SELECT coalesce(sum(octet_length(c.data_cipher)+256),0) FROM vc.stored_candidate c
    WHERE (c.owner_user_id,c.chat_id,c.message_id)=(m.owner_user_id,m.chat_id,m.message_id) AND c.deleted_at IS NULL AND ($4='full' OR c.candidate_id=m.selected_candidate_id)) AS bytes
  FROM vc.stored_message m WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.message_id=ANY($3::uuid[]) AND m.deleted_at IS NULL
 ), sized AS (SELECT *,coalesce(sum(bytes) OVER(ORDER BY position `+direction+` ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior_bytes FROM sizes)
 SELECT m.message_id::text,m.revision,m.position::text,m.selected_candidate_id::text,m.data_cipher,m.candidate_count,
  c.candidate_id::text,c.source_revision,c.source_generation,c.settled,c.data_cipher
 FROM sized m JOIN vc.stored_candidate c ON(c.owner_user_id,c.chat_id,c.message_id)=(m.owner_user_id,m.chat_id,m.message_id)
 WHERE m.prior_bytes<$5 AND c.deleted_at IS NULL AND ($4='full' OR c.candidate_id=m.selected_candidate_id)
 ORDER BY m.position `+direction+`,c.ordinal`, owner, chatID, ids, view, storedChatPageBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m StoredMessage
		var c StoredCandidate
		var md, cd string
		if err = rows.Scan(&m.MessageID, &m.Revision, &m.Position, &m.SelectedCandidateID, &md, &m.CandidateCount, &c.CandidateID, &c.SourceRevision, &c.SourceGeneration, &c.settled, &cd); err != nil {
			return nil, err
		}
		if c.CandidateID == m.SelectedCandidateID && selected[m.MessageID] != nil {
			c.Data = selected[m.MessageID]
		} else if err = s.decodeChatJSON(cd, &c.Data); err != nil {
			return nil, err
		}
		if len(result) == 0 || result[len(result)-1].MessageID != m.MessageID {
			if err = s.decodeChatJSON(md, &m.Data); err != nil {
				return nil, err
			}
			m.Candidates = []StoredCandidate{}
			result = append(result, m)
		}
		last := &result[len(result)-1]
		last.Candidates = append(last.Candidates, c)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	bytes := 2048 // page envelope and authenticated boundary cursors
	for i := range result {
		result[i], err = projectStoredMessage(result[i], view)
		if err != nil {
			return nil, err
		}
		wire, err := chatJSON(result[i])
		if err != nil {
			return nil, err
		}
		if i > 0 && bytes+len(wire)+1 > storedChatPageBytes {
			return result[:i], nil
		}
		bytes += len(wire) + 1
	}
	return result, nil
}

func (s *Store) ListStoredMessages(ctx context.Context, owner int64, chatID string, q ChatMessageQuery) (StoredMessagePage, error) {
	out := StoredMessagePage{Items: []StoredMessage{}}
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	limit, err := chatPageLimit(q.Limit)
	if err != nil {
		return out, err
	}
	if q.View == "" {
		q.View = "display"
	}
	if q.View != "display" && q.View != "full" {
		return out, ErrInvalid
	}
	n := 0
	for _, v := range []string{q.Before, q.After, q.AnchorMessageID} {
		if v != "" {
			n++
		}
	}
	if n > 1 {
		return out, ErrInvalid
	}
	if q.AnchorMessageID != "" {
		q.AnchorMessageID, err = normalizeChatID(q.AnchorMessageID)
		if err != nil {
			return out, err
		}
	}
	q.Q = normalizeMessageQuery(q.Q)
	err = s.withStoredChatRead(ctx, owner, q.Q != "", func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		chat, err := s.readStoredChat(ctx, tx, owner, id, epoch)
		if err != nil {
			return err
		}
		out.ChatID = id
		out.Revision = chat.Revision
		out.MetadataRevision = chat.MetadataRevision
		out.OrderRevision = chat.OrderRevision
		out.AuthorityEpoch = epoch
		if q.IncludeChat {
			out.Chat = &chat
		}
		var bound *int64
		forward, inclusive := q.After != "", q.AnchorMessageID != ""
		token := q.Before
		if forward {
			token = q.After
		}
		if token != "" {
			c, err := s.decodeChatCursor(token)
			if err != nil {
				return err
			}
			if c.Kind != "messages" || c.Owner != owner || c.ChatID != id || c.View != q.View || c.Q != q.Q {
				return ErrInvalid
			}
			if c.Epoch != epoch || c.Order != chat.OrderRevision || c.Expires <= time.Now().Unix() {
				return chatError("CHAT_CURSOR_EXPIRED")
			}
			bound = &c.Position
		}
		if q.AnchorMessageID != "" {
			var position int64
			err = tx.QueryRow(ctx, `SELECT position FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL`, owner, id, q.AnchorMessageID).Scan(&position)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			bound = &position
		}
		var keys []chatMessageKey
		var window storedSearchWindow
		if q.Q != "" {
			window, err = s.searchStoredMessageWindow(ctx, tx, owner, id, bound, forward, inclusive, q.Q, limit)
			keys = window.keys
		} else {
			keys, err = s.storedMessageKeys(ctx, tx, owner, id, bound, forward, inclusive, limit)
		}
		if err != nil {
			return err
		}
		messages, err := s.loadStoredMessagePage(ctx, tx, owner, id, keys, q.View, forward, window.selected)
		if err != nil {
			return err
		}
		var first, last int64
		if q.Q != "" {
			if window.first == nil {
				return nil
			}
			first, last = *window.first, *window.last
			// The response budget may omit found matches. Resume from the last
			// actually returned match, leaving every omitted match for the next page.
			if len(messages) < len(keys) {
				last, _ = strconv.ParseInt(messages[len(messages)-1].Position, 10, 64)
			}
			if !forward {
				first, last = last, first
			}
		} else {
			if len(messages) == 0 {
				return nil
			}
			first, _ = strconv.ParseInt(messages[0].Position, 10, 64)
			last, _ = strconv.ParseInt(messages[len(messages)-1].Position, 10, 64)
			if !forward {
				first, last = last, first
			}
		}
		if !forward {
			for l, r := 0, len(messages)-1; l < r; l, r = l+1, r-1 {
				messages[l], messages[r] = messages[r], messages[l]
			}
		}
		out.Items = messages
		cursor := chatKeyset{Kind: "messages", Owner: owner, ChatID: id, Epoch: epoch, Order: chat.OrderRevision, View: q.View, Q: q.Q, Position: first}
		before := s.encodeChatCursor(cursor)
		out.BeforeCursor = &before
		cursor.Position = last
		after := s.encodeChatCursor(cursor)
		out.AfterCursor = &after
		older, err := s.storedMessageKeys(ctx, tx, owner, id, &first, false, false, 1)
		if err != nil {
			return err
		}
		newer, err := s.storedMessageKeys(ctx, tx, owner, id, &last, true, false, 1)
		if err != nil {
			return err
		}
		out.HasOlder = len(older) > 0
		out.HasNewer = len(newer) > 0
		return nil
	})
	return out, err
}

func (s *Store) ListStoredChatChanges(ctx context.Context, owner int64, chatID string, afterRevision int64, limit int) (ChatChangesPage, error) {
	out := ChatChangesPage{Items: []ChatChange{}, ThroughRevision: afterRevision}
	id, err := normalizeChatID(chatID)
	if err != nil {
		return out, err
	}
	limit, err = chatPageLimit(limit)
	if err != nil || afterRevision < 0 {
		return out, ErrInvalid
	}
	err = s.withStoredChatRead(ctx, owner, false, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
		c, err := s.readStoredChat(ctx, tx, owner, id, epoch)
		if err != nil {
			return err
		}
		out.ChatID = id
		out.AuthorityEpoch = epoch
		out.CurrentRevision = c.Revision
		if afterRevision > c.Revision {
			return ErrInvalid
		}
		if afterRevision == c.Revision {
			return nil
		}
		rows, err := tx.Query(ctx, `SELECT revision,event FROM vc.chat_change WHERE owner_user_id=$1 AND chat_id=$2 AND revision>$3 AND created_at>=now()-interval '7 days' ORDER BY revision LIMIT $4`, owner, id, afterRevision, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var revision int64
			var data []byte
			var event ChatChange
			if err = rows.Scan(&revision, &data); err != nil {
				return err
			}
			if err = chatDecode(data, &event); err != nil {
				return err
			}
			if revision != afterRevision+int64(len(out.Items))+1 {
				return chatError("CHAT_CHANGES_EXPIRED")
			}
			out.Items = append(out.Items, event)
		}
		if err = rows.Err(); err != nil {
			return err
		}
		if len(out.Items) == 0 {
			return chatError("CHAT_CHANGES_EXPIRED")
		}
		if len(out.Items) > limit {
			out.Items = out.Items[:limit]
			out.HasMore = true
		}
		out.ThroughRevision = out.Items[len(out.Items)-1].Revision
		if !out.HasMore && out.ThroughRevision != out.CurrentRevision {
			return chatError("CHAT_CHANGES_EXPIRED")
		}
		return nil
	})
	return out, err
}

func copyChatData(data ChatData) ChatData {
	out := ChatData{}
	for k, v := range data {
		out[k] = v
	}
	return out
}
func asChatData(v any) ChatData {
	switch d := v.(type) {
	case ChatData:
		return d
	case map[string]any:
		return ChatData(d)
	}
	return nil
}

// Project a coherent ST message from its shared document and candidate rows.
// Full reads preserve arbitrary extension fields; display omits variables and
// non-selected candidate documents and is never a writable full snapshot.
func projectStoredMessage(m StoredMessage, view string) (StoredMessage, error) {
	m.Candidates = append([]StoredCandidate(nil), m.Candidates...)
	selected := -1
	for i := range m.Candidates {
		c := &m.Candidates[i]
		c.Data = copyChatData(c.Data)
		extra := copyChatData(asChatData(c.Data["extra"]))
		source := copyChatData(asChatData(extra["vc_source"]))
		source["id"] = c.CandidateID
		source["revision"] = c.SourceRevision
		source["generation"] = c.SourceGeneration
		source["settled"] = c.settled
		extra["vc_source"] = source
		c.Data["extra"] = extra
		if c.CandidateID == m.SelectedCandidateID {
			selected = i
		}
	}
	if selected < 0 {
		return m, errStore
	}
	data := copyChatData(m.Data)
	data["vc_message_id"] = m.MessageID
	data["mes"] = m.Candidates[selected].Data["mes"]
	data["extra"] = m.Candidates[selected].Data["extra"]
	for _, key := range []string{"send_date", "gen_started", "gen_finished"} {
		if v, ok := m.Candidates[selected].Data[key]; ok {
			data[key] = v
		}
	}
	if view == "full" {
		swipes := make([]any, len(m.Candidates))
		info := make([]any, len(m.Candidates))
		variables := make([]any, len(m.Candidates))
		hasVariables := false
		for i, c := range m.Candidates {
			swipes[i] = c.Data["mes"]
			ci := copyChatData(c.Data)
			delete(ci, "mes")
			delete(ci, "variables")
			info[i] = ci
			if v, ok := c.Data["variables"]; ok {
				variables[i] = v
				hasVariables = true
			}
		}
		data["swipes"] = swipes
		data["swipe_info"] = info
		data["swipe_id"] = selected
		if hasVariables {
			data["variables"] = variables
		} else {
			delete(data, "variables")
		}
	} else {
		visible := ChatData{}
		for _, k := range []string{"name", "is_user", "is_system", "send_date", "gen_started", "gen_finished", "mes", "extra", "vc_message_id", "force_avatar", "original_avatar", "name_override"} {
			if v, ok := data[k]; ok {
				visible[k] = v
			}
		}
		data = visible
		chosen := m.Candidates[selected]
		chosen.Data = ChatData{"mes": chosen.Data["mes"], "extra": chosen.Data["extra"]}
		m.Candidates = []StoredCandidate{chosen}
	}
	m.Data = data
	m.View = view
	return m, nil
}
