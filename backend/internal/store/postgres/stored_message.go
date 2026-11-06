package postgres

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// The message document contains shared ST fields; each candidate owns its text,
// extra, variables and swipe_info extensions. These are persisted independently
// so a single edit never serializes or rewrites the rest of the conversation.
func (s *Store) insertStoredMessage(ctx context.Context, tx pgx.Tx, owner int64, chatID string, m StoredMessage, initial []byte) error {
	position, err := strconv.ParseInt(m.Position, 10, 64)
	if err != nil {
		return ErrInvalid
	}
	data, err := s.encodeChatJSON(m.Data)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT vc.insert_stored_message($1,$2,$3,$4,$5,$6,$7,$8)`, owner, chatID, m.MessageID, position, m.Revision, m.SelectedCandidateID, data, initial)
	if err != nil {
		return err
	}
	for i, c := range m.Candidates {
		b, err := s.encodeChatJSON(c.Data)
		if err != nil {
			return ErrInvalid
		}
		digest, err := chatDigest(c.Data)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `SELECT vc.insert_stored_candidate($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, owner, chatID, m.MessageID, c.CandidateID, i, c.SourceRevision, c.SourceGeneration, c.settled, b, digest)
		if err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) loadStoredMessage(ctx context.Context, tx pgx.Tx, owner int64, chatID, messageID string) (StoredMessage, error) {
	var m StoredMessage
	var data string
	err := tx.QueryRow(ctx, `SELECT message_id::text,revision,position::text,selected_candidate_id::text,data_cipher
 FROM vc.stored_message WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL`, owner, chatID, messageID).
		Scan(&m.MessageID, &m.Revision, &m.Position, &m.SelectedCandidateID, &data)
	if err == pgx.ErrNoRows {
		return m, ErrNotFound
	}
	if err != nil {
		return m, err
	}
	if err = s.decodeChatJSON(data, &m.Data); err != nil {
		return m, err
	}
	rows, err := tx.Query(ctx, `SELECT candidate_id::text,source_revision,source_generation,settled,data_cipher,ever_selected
 FROM vc.stored_candidate WHERE owner_user_id=$1 AND chat_id=$2 AND message_id=$3 AND deleted_at IS NULL ORDER BY ordinal`, owner, chatID, messageID)
	if err != nil {
		return m, err
	}
	defer rows.Close()
	m.Candidates = []StoredCandidate{}
	for rows.Next() {
		var c StoredCandidate
		var b string
		if err = rows.Scan(&c.CandidateID, &c.SourceRevision, &c.SourceGeneration, &c.settled, &b, &c.everSelected); err != nil {
			return m, err
		}
		if err = s.decodeChatJSON(b, &c.Data); err != nil {
			return m, err
		}
		m.Candidates = append(m.Candidates, c)
	}
	m.View = "full"
	m.CandidateCount = len(m.Candidates)
	return m, rows.Err()
}
