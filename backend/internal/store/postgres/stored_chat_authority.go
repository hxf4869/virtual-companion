package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ChatStorageState is the selection hint for an authenticated owner's session.
type ChatStorageState struct {
	Mode           string `json:"mode"`
	AuthorityEpoch int64  `json:"authorityEpoch,string"`
}

// GetChatStorageState reads the authority hint for a server-verified owner.
// The session can remain readable during account deletion, so this read uses
// owner RLS directly. Chat operations still enforce their own authority locks.
func (s *Store) GetChatStorageState(ctx context.Context, owner int64) (ChatStorageState, error) {
	var state ChatStorageState
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT authority, epoch FROM vc.chat_authority WHERE owner_user_id=$1`, owner).
			Scan(&state.Mode, &state.AuthorityEpoch)
		if errors.Is(err, pgx.ErrNoRows) {
			state = ChatStorageState{Mode: "ST", AuthorityEpoch: 1}
			return nil
		}
		return err
	})
	if err != nil {
		return ChatStorageState{}, mapStoreErr(err)
	}
	return state, nil
}
