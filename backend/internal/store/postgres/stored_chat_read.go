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
	"golang.org/x/text/cases"
)

const storedChatPageBytes = 256 << 10

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
func (s *Store) withStoredChatRead(ctx context.Context, owner int64, work func(context.Context, pgx.Tx, int64) error) error {
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
	err = s.withStoredChatRead(ctx, owner, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
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
	err = s.withStoredChatRead(ctx, owner, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
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
	err = s.withStoredChatRead(ctx, owner, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
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

// A bounded server-side scan is necessary for encrypted full-chat search. It
// decrypts only current selected-candidate documents, never JSONL or all swipes.
// Ordinary pagination stays an indexed SQL keyset and does not scan bodies.
func (s *Store) storedMessageKeys(ctx context.Context, tx pgx.Tx, owner int64, chatID string, bound *int64, forward, inclusive bool, q string, limit int) ([]chatMessageKey, error) {
	out := []chatMessageKey{}
	direction, op := "DESC", "<"
	if forward {
		direction, op = "ASC", ">"
	}
	if inclusive {
		op += "="
	}
	fold := cases.Fold()
	for {
		count := limit - len(out)
		if q != "" {
			count = 200
		}
		args := []any{owner, chatID}
		boundary := ""
		if bound != nil {
			args = append(args, *bound)
			boundary = " AND m.position " + op + " $3"
		}
		args = append(args, count)
		limitSQL := " LIMIT $" + strconv.Itoa(len(args))
		pageSQL := `SELECT m.message_id,m.position,m.selected_candidate_id FROM vc.stored_message m
   WHERE m.owner_user_id=$1 AND m.chat_id=$2 AND m.deleted_at IS NULL` + boundary + ` ORDER BY m.position ` + direction + limitSQL
		sql := `SELECT m.message_id::text,m.position FROM (` + pageSQL + `) m ORDER BY m.position ` + direction
		if q != "" {
			// Bound the position range before touching encrypted candidates. A lateral
			// point lookup avoids rescanning/sorting all candidates for each search page.
			sql = `WITH page AS MATERIALIZED (` + pageSQL + `) SELECT m.message_id::text,m.position,c.data_cipher
    FROM page m JOIN LATERAL (SELECT data_cipher FROM vc.stored_candidate c
     WHERE c.owner_user_id=$1 AND c.chat_id=$2 AND c.message_id=m.message_id AND c.candidate_id=m.selected_candidate_id AND c.deleted_at IS NULL LIMIT 1) c ON true
    ORDER BY m.position ` + direction
		}
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		n := 0
		var last int64
		for rows.Next() {
			var k chatMessageKey
			var encrypted string
			if q == "" {
				err = rows.Scan(&k.ID, &k.Position)
			} else {
				err = rows.Scan(&k.ID, &k.Position, &encrypted)
			}
			if err != nil {
				rows.Close()
				return nil, err
			}
			n++
			last = k.Position
			match := true
			if q != "" {
				var data ChatData
				if err = s.decodeChatJSON(encrypted, &data); err != nil {
					rows.Close()
					return nil, err
				}
				mes, _ := data["mes"].(string)
				match = strings.Contains(fold.String(mes), q)
			}
			if match {
				out = append(out, k)
				if len(out) == limit {
					break
				}
			}
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return nil, err
		}
		if len(out) == limit || q == "" || n < count {
			return out, nil
		}
		bound = &last
		op = strings.TrimSuffix(op, "=")
	}
}

// Ciphertext sizes are available without decrypting or transferring the bodies.
// Stop the SQL page at a soft byte budget (but always include its first row).
func (s *Store) loadStoredMessagePage(ctx context.Context, tx pgx.Tx, owner int64, chatID string, keys []chatMessageKey, view string, forward bool) ([]StoredMessage, error) {
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
		if err = s.decodeChatJSON(cd, &c.Data); err != nil {
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
	err = s.withStoredChatRead(ctx, owner, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
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
			if q.Q != "" {
				anchor, err := s.storedMessageKeys(ctx, tx, owner, id, bound, false, true, q.Q, 1)
				if err != nil {
					return err
				}
				if len(anchor) == 0 || anchor[0].ID != q.AnchorMessageID {
					return ErrNotFound
				}
			}
		}
		keys, err := s.storedMessageKeys(ctx, tx, owner, id, bound, forward, inclusive, q.Q, limit)
		if err != nil {
			return err
		}
		messages, err := s.loadStoredMessagePage(ctx, tx, owner, id, keys, q.View, forward)
		if err != nil {
			return err
		}
		if !forward {
			for l, r := 0, len(messages)-1; l < r; l, r = l+1, r-1 {
				messages[l], messages[r] = messages[r], messages[l]
			}
		}
		out.Items = messages
		if len(messages) == 0 {
			return nil
		}
		first, _ := strconv.ParseInt(messages[0].Position, 10, 64)
		last, _ := strconv.ParseInt(messages[len(messages)-1].Position, 10, 64)
		cursor := chatKeyset{Kind: "messages", Owner: owner, ChatID: id, Epoch: epoch, Order: chat.OrderRevision, View: q.View, Q: q.Q, Position: first}
		before := s.encodeChatCursor(cursor)
		out.BeforeCursor = &before
		cursor.Position = last
		after := s.encodeChatCursor(cursor)
		out.AfterCursor = &after
		older, err := s.storedMessageKeys(ctx, tx, owner, id, &first, false, false, q.Q, 1)
		if err != nil {
			return err
		}
		newer, err := s.storedMessageKeys(ctx, tx, owner, id, &last, true, false, q.Q, 1)
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
	err = s.withStoredChatRead(ctx, owner, func(ctx context.Context, tx pgx.Tx, epoch int64) error {
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
