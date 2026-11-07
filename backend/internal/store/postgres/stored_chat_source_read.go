package postgres

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// The raw chat and its source watermark are committed together. A missing
// raw row is unknown unless the incognito end path recorded its deletion.
func readStoredChatSourceStates(ctx context.Context, tx pgx.Tx, owner int64, chats []string) ([]STSourceState, error) {
	rows, err := tx.Query(ctx, `SELECT c.st_chat_identity,c.incognito,COALESCE(c.st_source_state,''),c.st_applied_revision,
		r.revision,r.deleted_at IS NOT NULL
		FROM vc.conversation c
		LEFT JOIN vc.stored_chat r ON r.owner_user_id=c.owner_user_id AND r.conversation_id=c.id
			AND r.chat_id::text=c.st_chat_identity
		WHERE c.owner_user_id=$1 AND c.st_chat_identity=ANY($2::text[])
		ORDER BY array_position($2::text[],c.st_chat_identity)`, owner, chats)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := make([]STSourceState, 0, len(chats))
	for rows.Next() {
		state := STSourceState{State: "UNAVAILABLE"}
		var incognito, deleted bool
		var projectedState string
		var appliedRevision, rawRevision *int64
		if err := rows.Scan(&state.ChatIdentity, &incognito, &projectedState, &appliedRevision, &rawRevision, &deleted); err != nil {
			return nil, err
		}
		switch {
		case deleted:
			state.State, state.Revision = "DELETED", rawRevision
		case rawRevision == nil && incognito && appliedRevision != nil && projectedState == "DELETED":
			state.State, state.Revision = "DELETED", appliedRevision
		case rawRevision != nil && appliedRevision != nil && *rawRevision == *appliedRevision && projectedState == "PRESENT":
			state.State, state.Revision = "PRESENT", rawRevision
		}
		states = append(states, state)
	}
	return states, rows.Err()
}
