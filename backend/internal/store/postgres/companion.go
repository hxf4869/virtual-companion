package postgres

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	relSelect = `SELECT out_id, out_persona_ref, out_active, out_created_at,
		out_companion_name, out_user_address_as, out_reply_length,
		out_initiative, out_humor, out_advice_pref, out_reminders_allowed,
		out_memory_share_scope, out_avoid_topics, out_gender, out_avatar_ref `
	previewMaxRunes = 200
)

// Relationship is one Companion row owned by the caller.
type Relationship struct {
	ID               int64
	PersonaRef       string
	Active           bool
	CreatedAt        time.Time
	CompanionName    *string
	UserAddressAs    *string
	ReplyLength      string
	Initiative       string
	Humor            string
	AdvicePref       string
	RemindersAllowed bool
	MemoryShareScope string
	AvoidTopics      []string
	Gender           string
	AvatarRef        string
}

// RelationshipPrefs is a full replacement of structured Companion prefs.
type RelationshipPrefs struct {
	CompanionName    *string
	UserAddressAs    *string
	ReplyLength      string
	Initiative       string
	Humor            string
	AdvicePref       string
	RemindersAllowed bool
	MemoryShareScope string
	AvoidTopics      []string
	Gender           string
	AvatarRef        string
}

// Conversation is one list row.
type Conversation struct {
	ID                 int64
	RelationshipID     int64
	CreatedAt          time.Time
	LastMessageRole    *string
	LastMessagePreview *string
	Title              *string
	Incognito          bool
}

// Message is one history row with decrypted content.
type Message struct {
	ID             int64
	ConversationID int64
	Role           string
	Content        string
	CreatedAt      time.Time
	NoMemory       bool
}

// ChatWipePreview is the account-wide wipe preview counts.
type ChatWipePreview struct {
	ConversationCount int64
	MessageCount      int64
	InFlightCount     int64
}

// ChatWipeResult is what a wipe actually cleared.
type ChatWipeResult struct {
	ConversationsDeleted int64
	MessagesDeleted      int64
	WorkItemsCancelled   int64
}

// ConversationEnd is the result of ending one conversation.
type ConversationEnd struct {
	OK               bool
	IncognitoCleared bool
}

func (s *Store) CreateRelationship(ctx context.Context, owner int64, personaRef string) (Relationship, error) {
	var out Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.create_relationship($1, $2)`, owner, personaRef).Scan(&id); err != nil {
			return err
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return errStore
		}
		out = rel
		return nil
	})
	if err != nil {
		return Relationship{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ListRelationships(ctx context.Context, owner int64) ([]Relationship, error) {
	var out []Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, relSelect+`FROM vc.list_relationships($1)`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			rel, err := scanRelationshipRow(rows)
			if err != nil {
				return err
			}
			out = append(out, rel)
		}
		if out == nil {
			out = []Relationship{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ActivateRelationship(ctx context.Context, owner, id int64) (Relationship, error) {
	var out Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		var done bool
		if err := tx.QueryRow(ctx, `SELECT vc.activate_relationship($1, $2)`, owner, id).Scan(&done); err != nil {
			return err
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = rel
		return nil
	})
	if err != nil {
		return Relationship{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) DeactivateRelationship(ctx context.Context, owner, id int64) (Relationship, error) {
	var out Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var updated bool
		if err := tx.QueryRow(ctx, `SELECT vc.deactivate_relationship($1, $2)`, owner, id).Scan(&updated); err != nil {
			return err
		}
		if !updated {
			return ErrNotFound
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = rel
		return nil
	})
	if err != nil {
		return Relationship{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) UpdateRelationshipPrefs(ctx context.Context, owner, id int64, prefs RelationshipPrefs) (Relationship, error) {
	var out Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var updated bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.update_relationship_prefs($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
			owner, id,
			nullString(prefs.CompanionName),
			nullString(prefs.UserAddressAs),
			prefs.ReplyLength, prefs.Initiative, prefs.Humor, prefs.AdvicePref,
			prefs.RemindersAllowed, prefs.MemoryShareScope,
			strings.Join(prefs.AvoidTopics, ","),
			prefs.Gender, prefs.AvatarRef,
		).Scan(&updated); err != nil {
			return err
		}
		if !updated {
			return ErrNotFound
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = rel
		return nil
	})
	if err != nil {
		return Relationship{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) DeleteRelationship(ctx context.Context, owner, id int64, retainImportable bool) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT vc.delete_relationship($1, $2, $3)`, owner, id, retainImportable).Scan(&deleted); err != nil {
			return err
		}
		if !deleted {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) CreateConversation(ctx context.Context, owner, relationshipID int64, incognito bool) (int64, error) {
	var id int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, ok, err := scanRelationship(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		return tx.QueryRow(ctx, `SELECT vc.create_conversation($1, $2, $3)`, owner, relationshipID, incognito).Scan(&id)
	})
	if err != nil {
		return 0, mapStoreErr(err)
	}
	return id, nil
}

func (s *Store) ListConversations(ctx context.Context, owner int64, relationshipID, after *int64, limit *int) ([]Conversation, error) {
	var out []Conversation
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_relationship_id, out_created_at,
			        out_last_message_role, out_last_message_preview, out_title, out_incognito
			   FROM vc.list_conversations($1, $2, $3, $4)`,
			owner, relationshipID, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		var ids []int64
		for rows.Next() {
			var c Conversation
			if err := rows.Scan(&c.ID, &c.RelationshipID, &c.CreatedAt,
				&c.LastMessageRole, &c.LastMessagePreview, &c.Title, &c.Incognito); err != nil {
				return err
			}
			out = append(out, c)
			ids = append(ids, c.ID)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		if len(ids) == 0 {
			if out == nil {
				out = []Conversation{}
			}
			return nil
		}
		last, err := loadLastMessageBodies(ctx, tx, owner, ids)
		if err != nil {
			return err
		}
		for i := range out {
			stored, ok := last[out[i].ID]
			if !ok {
				out[i].LastMessagePreview = nil
				out[i].LastMessageRole = nil
				continue
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				out[i].LastMessagePreview = nil
				continue
			}
			preview := clampPreview(plain)
			out[i].LastMessagePreview = &preview
		}
		return nil
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) DeleteConversation(ctx context.Context, owner, id int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT vc.delete_conversation($1, $2)`, owner, id).Scan(&deleted); err != nil {
			return err
		}
		if !deleted {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) RenameConversation(ctx context.Context, owner, id int64, title string) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var renamed bool
		if err := tx.QueryRow(ctx, `SELECT vc.rename_conversation($1, $2, $3)`, owner, id, title).Scan(&renamed); err != nil {
			return err
		}
		if !renamed {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) EndConversation(ctx context.Context, owner, id int64) (ConversationEnd, error) {
	var out ConversationEnd
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`SELECT out_ok, out_incognito_cleared FROM vc.end_conversation($1, $2)`,
			owner, id).Scan(&out.OK, &out.IncognitoCleared)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return ConversationEnd{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) PreviewChatWipe(ctx context.Context, owner int64) (ChatWipePreview, error) {
	var out ChatWipePreview
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT out_conversation_count, out_message_count, out_in_flight_count
			   FROM vc.preview_chat_wipe($1)`, owner).Scan(
			&out.ConversationCount, &out.MessageCount, &out.InFlightCount)
	})
	if err != nil {
		return ChatWipePreview{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) WipeAllChats(ctx context.Context, owner int64) (ChatWipeResult, error) {
	var out ChatWipeResult
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var preview ChatWipePreview
		if err := tx.QueryRow(ctx,
			`SELECT out_conversation_count, out_message_count, out_in_flight_count
			   FROM vc.preview_chat_wipe($1)`, owner).Scan(
			&preview.ConversationCount, &preview.MessageCount, &preview.InFlightCount); err != nil {
			return err
		}
		err := tx.QueryRow(ctx,
			`SELECT out_conversations_deleted, out_messages_deleted, out_work_items_cancelled
			   FROM vc.wipe_all_chats($1)`, owner).Scan(
			&out.ConversationsDeleted, &out.MessagesDeleted, &out.WorkItemsCancelled)
		if err == pgx.ErrNoRows {
			out = ChatWipeResult{
				ConversationsDeleted: preview.ConversationCount,
				MessagesDeleted:      preview.MessageCount,
				WorkItemsCancelled:   preview.InFlightCount,
			}
			return nil
		}
		return err
	})
	if err != nil {
		return ChatWipeResult{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) ListMessages(ctx context.Context, owner, conversationID int64, after *int64, limit *int) ([]Message, error) {
	var out []Message
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_role, out_content, out_created_at, out_no_memory
			   FROM vc.list_messages($1, $2, $3, $4)`,
			owner, conversationID, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Message
			var stored string
			if err := rows.Scan(&m.ID, &m.Role, &stored, &m.CreatedAt, &m.NoMemory); err != nil {
				return err
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return errStore
			}
			m.ConversationID = conversationID
			m.Content = plain
			out = append(out, m)
		}
		if out == nil {
			out = []Message{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) DeleteMessage(ctx context.Context, owner, conversationID, messageID int64) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT vc.delete_message($1, $2, $3)`, owner, conversationID, messageID).Scan(&deleted); err != nil {
			return err
		}
		if !deleted {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) SetMessageNoMemory(ctx context.Context, owner, conversationID, messageID int64, noMemory bool) (Message, error) {
	var out Message
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var changed bool
		if err := tx.QueryRow(ctx, `SELECT vc.set_message_no_memory($1, $2, $3, $4)`,
			owner, conversationID, messageID, noMemory).Scan(&changed); err != nil {
			return err
		}
		if !changed {
			return ErrNotFound
		}
		after := messageID - 1
		if after < 0 {
			after = 0
		}
		limit := 1
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_role, out_content, out_created_at, out_no_memory
			   FROM vc.list_messages($1, $2, $3, $4)`,
			owner, conversationID, after, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Message
			var stored string
			if err := rows.Scan(&m.ID, &m.Role, &stored, &m.CreatedAt, &m.NoMemory); err != nil {
				return err
			}
			if m.ID != messageID {
				continue
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return errStore
			}
			m.ConversationID = conversationID
			m.Content = plain
			out = m
			return nil
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return ErrNotFound
	})
	if err != nil {
		return Message{}, mapStoreErr(err)
	}
	return out, nil
}

func scanRelationship(ctx context.Context, tx pgx.Tx, owner, id int64) (Relationship, bool, error) {
	rows, err := tx.Query(ctx, relSelect+`FROM vc.get_relationship($1, $2)`, owner, id)
	if err != nil {
		return Relationship{}, false, err
	}
	defer rows.Close()
	if !rows.Next() {
		return Relationship{}, false, rows.Err()
	}
	rel, err := scanRelationshipRow(rows)
	if err != nil {
		return Relationship{}, false, err
	}
	return rel, true, rows.Err()
}

type relationshipRow interface {
	Scan(dest ...any) error
}

func scanRelationshipRow(row relationshipRow) (Relationship, error) {
	var rel Relationship
	var name, addr, topics *string
	if err := row.Scan(
		&rel.ID, &rel.PersonaRef, &rel.Active, &rel.CreatedAt,
		&name, &addr, &rel.ReplyLength, &rel.Initiative, &rel.Humor, &rel.AdvicePref,
		&rel.RemindersAllowed, &rel.MemoryShareScope, &topics, &rel.Gender, &rel.AvatarRef,
	); err != nil {
		return Relationship{}, err
	}
	rel.CompanionName = name
	rel.UserAddressAs = addr
	rel.AvoidTopics = splitCSV(topics)
	return rel, nil
}

func loadLastMessageBodies(ctx context.Context, tx pgx.Tx, owner int64, ids []int64) (map[int64]string, error) {
	out := make(map[int64]string, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := tx.Query(ctx, `
SELECT DISTINCT ON (conversation_id) conversation_id, content
  FROM vc.message
 WHERE owner_user_id = $1 AND conversation_id = ANY($2)
 ORDER BY conversation_id, id DESC`, owner, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int64
		var content string
		if err := rows.Scan(&cid, &content); err != nil {
			return nil, err
		}
		out[cid] = content
	}
	return out, rows.Err()
}

func (s *Store) encryptStored(plain string) (string, error) {
	if plain == "" {
		return "", nil
	}
	if s == nil || s.cipher == nil {
		return plain, nil
	}
	return s.cipher.Encrypt(plain)
}

func (s *Store) decryptStored(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if s == nil || s.cipher == nil {
		if IsEncrypted(stored) {
			return "", errStore
		}
		return stored, nil
	}
	return s.cipher.Decrypt(stored)
}

func splitCSV(raw *string) []string {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return []string{}
	}
	parts := strings.Split(*raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	if out == nil {
		return []string{}
	}
	return out
}

func nullString(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}

func clampPreview(s string) string {
	if utf8.RuneCountInString(s) <= previewMaxRunes {
		return s
	}
	runes := []rune(s)
	return string(runes[:previewMaxRunes])
}
