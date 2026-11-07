package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// Only changed selected candidates cross into the existing plaintext memory
// projection. Full raw documents and other swipes stay in encrypted chat rows.
func storedSourceProjection(message StoredMessage) ChatData {
	candidate := message.Candidates[candidateIndex(message, message.SelectedCandidateID)]
	extra := asChatData(candidate.Data["extra"])
	source := asChatData(extra["vc_source"])
	role := "assistant"
	if chatBoolean(message.Data["is_user"]) {
		role = "user"
	} else if chatBoolean(message.Data["is_system"]) {
		role = "system"
	}
	return ChatData{
		"messageId": message.MessageID, "candidateId": candidate.CandidateID,
		"revision": candidate.SourceRevision, "generation": candidate.SourceGeneration,
		"role": role, "text": candidate.Data["mes"], "settled": candidate.settled,
		"eligible":        !chatBoolean(message.Data["is_system"]) && !chatBoolean(extra["no_memory"]),
		"inboxEventId":    source["inbox_event_id"],
		"sourceTimestamp": source["sourceTimestamp"], "sourceTimezone": source["sourceTimezone"], "position": message.Position,
	}
}

func publishStoredSources(ctx context.Context, tx pgx.Tx, owner int64, chatID string, rows []ChatData, changed []string, orderChanged bool) error {
	if rows == nil {
		rows = []ChatData{}
	}
	if changed == nil {
		changed = []string{}
	}
	data, err := chatJSON(rows)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `SELECT vc.publish_stored_chat_sources($1,$2,$3,$4,$5)`, owner, chatID, data, changed, orderChanged)
	return err
}
