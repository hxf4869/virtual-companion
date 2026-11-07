package postgres

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// inboxProjection is one cross-owner row from vc.list_inbox_projections.
// create has no inbox yet. deliver is an undelivered BODY event.
type inboxProjection struct {
	OwnerID        int64
	Action         string
	EventID        string
	ConversationID int64
	Branch         *string
	SourceRevision *int64
	ExpiresAt      *time.Time
	ChatIdentity   string
	Intent         string
}

// ProjectInbox creates inbox rows for ready follow-ups and saves BODY text
// through the owner's current chat authority. WAITING_HOST creates no chat message.
// A missing consent skips channel creation and is not a batch failure.
// Reconciliation is not done here and does not send a replacement notice.
func (s *Store) ProjectInbox(ctx context.Context) error {
	if s == nil {
		return nil
	}
	rows, err := s.listInboxProjections(ctx)
	if err != nil {
		return err
	}
	var first error
	for _, row := range rows {
		if err := s.projectInboxRow(ctx, row); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func (s *Store) listInboxProjections(ctx context.Context) ([]inboxProjection, error) {
	var out []inboxProjection
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_owner, out_action, out_event_id, out_conversation_id, out_branch,
			       out_source_revision, out_expires_at, out_chat_identity, out_intent
			  FROM vc.list_inbox_projections()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []inboxProjection{}
		for rows.Next() {
			var row inboxProjection
			if err := rows.Scan(&row.OwnerID, &row.Action, &row.EventID, &row.ConversationID,
				&row.Branch, &row.SourceRevision, &row.ExpiresAt, &row.ChatIdentity, &row.Intent); err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) projectInboxRow(ctx context.Context, row inboxProjection) error {
	if row.Action == "create" {
		branch := ""
		if row.Branch != nil {
			branch = *row.Branch
		}
		_, err := s.CreateInboxEvent(ctx, row.OwnerID, row.ConversationID, row.EventID, branch, row.SourceRevision, row.ExpiresAt)
		if err != nil && !errors.Is(err, ErrConflict) {
			if errors.Is(err, ErrInvalid) || errors.Is(err, ErrNotFound) {
				return nil
			}
			return err
		}
	}
	if _, err := s.CreateNotificationDeliveries(ctx, row.OwnerID, row.EventID); err != nil {
		if !errors.Is(err, ErrInvalid) && !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrConflict) {
			return err
		}
	}
	if row.Intent == "WAITING_HOST" {
		return nil
	}
	return s.deliverProjectedInbox(ctx, row)
}

func (s *Store) deliverProjectedInbox(ctx context.Context, row inboxProjection) error {
	if !stsource.ValidIdentity(row.ChatIdentity) {
		return nil
	}
	state, err := s.GetChatStorageState(ctx, row.OwnerID)
	if err != nil {
		return err
	}
	type stInboxBridge interface {
		stsource.Reader
		DeliverInbox(context.Context, stsource.InboxDeliveryRequest) (stsource.InboxDeliveryResult, error)
	}
	var bridge stInboxBridge
	var location string
	switch state.Mode {
	case "ST":
		var ok bool
		bridge, ok = s.stSources.(stInboxBridge)
		if !ok {
			return nil
		}
		snaps, err := bridge.Read(ctx, row.OwnerID, []stsource.Query{{ChatIdentity: row.ChatIdentity}})
		if err != nil || len(snaps) != 1 || snaps[0].State != "PRESENT" || snaps[0].Location == "" {
			return nil
		}
		location = snaps[0].Location
	case "GO":
		// DeliverStoredInbox resolves the destination under the authority lock.
	default:
		return nil
	}
	event, err := s.GetInboxEvent(ctx, row.OwnerID, row.EventID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	if event.Intent == "WAITING_HOST" || event.STDelivered {
		return nil
	}
	if state.Mode == "GO" && event.LinkStatus != "present" {
		return nil
	}
	claim, err := s.ClaimInboxEvent(ctx, row.OwnerID, row.EventID, 60)
	if err != nil {
		if errors.Is(err, ErrInboxLeaseHeld) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) {
			return nil
		}
		return err
	}
	var result stsource.InboxDeliveryResult
	if state.Mode == "GO" {
		result, err = s.DeliverStoredInbox(ctx, row.OwnerID, row.ChatIdentity, row.EventID, claim.LeaseToken)
	} else {
		// The legacy read and write are separate requests. Check again before writing.
		current, stateErr := s.GetChatStorageState(ctx, row.OwnerID)
		if stateErr != nil {
			return stateErr
		}
		if current.Mode != "ST" || current.AuthorityEpoch != state.AuthorityEpoch {
			return nil
		}
		result, err = bridge.DeliverInbox(ctx, stsource.InboxDeliveryRequest{
			OwnerAccountID: strconv.FormatInt(row.OwnerID, 10),
			File:           location,
			Event: stsource.InboxDeliveryEvent{
				EventID:     event.EventID,
				Intent:      event.Intent,
				Body:        event.Body,
				Voice:       event.Voice,
				Branch:      event.Branch,
				STDelivered: event.STDelivered,
			},
			Lease: stsource.InboxDeliveryLease{Token: claim.LeaseToken, ExpiresAt: claim.LeaseExpiresAt},
		})
	}
	if err != nil {
		if errors.Is(err, stsource.ErrUnavailable) || errors.Is(err, ErrInboxLeaseRejected) || errors.Is(err, ErrNotFound) {
			return nil
		}
		return err
	}
	if !result.Acked || result.Readback == nil || result.Readback.MessageID == "" {
		return nil
	}
	_, err = s.AckInboxEvent(ctx, row.OwnerID, row.EventID, claim.LeaseToken, result.Readback.MessageID, result.Readback.MessageRevision)
	if errors.Is(err, ErrInboxLeaseRejected) || errors.Is(err, ErrConflict) || errors.Is(err, ErrInvalid) || errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}
