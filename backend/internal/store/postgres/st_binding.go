package postgres

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// STBindingInput resolves one stable ST chat to an existing or new instance.
// RelationshipID is explicit when a branch should reuse the parent instance.
type STBindingInput struct {
	ChatIdentity   string
	CharacterRef   string
	Mode           string
	RelationshipID *int64
	DisplayName    string
}

type STBinding struct {
	RelationshipID int64
	ConversationID int64
	ChatIdentity   string
	CharacterRef   string
	Mode           string
}

// ResolveSTBinding atomically resolves the owner-scoped chat identity. It does
// not deduplicate by card, mirror ST message bodies, or allocate a Go revision.
func (s *Store) ResolveSTBinding(ctx context.Context, owner int64, input STBindingInput) (STBinding, error) {
	var out STBinding
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_relationship_id, out_conversation_id,
			out_chat_identity, out_character_ref, out_mode
			FROM vc.resolve_st_binding($1, $2, $3, $4, $5, $6)`,
			owner, input.ChatIdentity, input.CharacterRef, input.Mode, input.RelationshipID, input.DisplayName,
		).Scan(&out.RelationshipID, &out.ConversationID, &out.ChatIdentity, &out.CharacterRef, &out.Mode)
	})
	if err != nil {
		return STBinding{}, mapSTBindingErr(err)
	}
	return out, nil
}

func mapSTBindingErr(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" && pgErr.Message == "resolve_st_binding: conflict" {
		return ErrConflict
	}
	return mapStoreErr(err)
}
