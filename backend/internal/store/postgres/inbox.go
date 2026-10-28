package postgres

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrInboxLeaseHeld means another attempt still owns the save lease.
var ErrInboxLeaseHeld = errors.New("inbox lease is held")

// ErrInboxLeaseRejected means the lease expired or the token does not match.
var ErrInboxLeaseRejected = errors.New("inbox lease rejected")

var inboxEventIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// InboxEvent is one persisted inbox row. Persisted, ST delivery, read and
// link status are independent facts. The lease token is not part of this view.
type InboxEvent struct {
	ID              int64
	EventID         string
	RelationshipID  int64
	ConversationID  int64
	Branch          *string
	SourceRevision  *int64
	Intent          string
	Body            *string
	STDelivered     bool
	MessageID       *string
	MessageRevision *int64
	LinkStatus      string
	ReadAt          *time.Time
	Persisted       bool
}

// InboxClaim is the short save lease. It is not a session.
type InboxClaim struct {
	LeaseToken     string
	LeaseExpiresAt time.Time
}

const inboxSelect = `
SELECT id, event_id, relationship_id, conversation_id, branch, source_revision,
       intent, body, st_delivered, st_message_id, st_message_revision,
       link_status, read_at
  FROM vc.inbox_event`

type inboxScanner interface {
	Scan(dest ...any) error
}

func validInboxEventID(id string) bool {
	return inboxEventIDPattern.MatchString(id)
}

func scanInbox(row inboxScanner) (InboxEvent, error) {
	var out InboxEvent
	var branch, body, messageID pgtype.Text
	var sourceRevision, messageRevision pgtype.Int8
	var readAt pgtype.Timestamptz
	err := row.Scan(
		&out.ID, &out.EventID, &out.RelationshipID, &out.ConversationID,
		&branch, &sourceRevision, &out.Intent, &body, &out.STDelivered,
		&messageID, &messageRevision, &out.LinkStatus, &readAt)
	if err != nil {
		return InboxEvent{}, err
	}
	out.Branch = textPtr(branch)
	out.SourceRevision = int8Ptr(sourceRevision)
	out.Body = textPtr(body)
	out.MessageID = textPtr(messageID)
	out.MessageRevision = int8Ptr(messageRevision)
	out.ReadAt = tzPtr(readAt)
	out.Persisted = true
	return out, nil
}

func getInboxTx(ctx context.Context, tx pgx.Tx, owner int64, eventID string) (InboxEvent, bool, error) {
	row, err := scanInbox(tx.QueryRow(ctx, inboxSelect+` WHERE owner_user_id = $1 AND event_id = $2`, owner, eventID))
	if errors.Is(err, pgx.ErrNoRows) {
		return InboxEvent{}, false, nil
	}
	if err != nil {
		return InboxEvent{}, false, err
	}
	return row, true, nil
}

func (s *Store) CreateInboxEvent(ctx context.Context, owner, conversationID int64, eventID, branch string, sourceRevision *int64, expiresAt *time.Time) (InboxEvent, error) {
	if !validInboxEventID(eventID) {
		return InboxEvent{}, ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		return tx.QueryRow(ctx, `SELECT vc.create_inbox_event($1,$2,$3,$4,$5,$6)`,
			owner, eventID, conversationID, nullIfBlank(branch), sourceRevision, expiresAt).Scan(&id)
	})
	if err != nil {
		return InboxEvent{}, mapInboxErr(err)
	}
	return s.GetInboxEvent(ctx, owner, eventID)
}

func (s *Store) ListInboxEvents(ctx context.Context, owner int64) ([]InboxEvent, error) {
	var out []InboxEvent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, inboxSelect+` WHERE owner_user_id = $1 ORDER BY id`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []InboxEvent{}
		for rows.Next() {
			row, err := scanInbox(rows)
			if err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	return out, mapInboxErr(err)
}

func (s *Store) GetInboxEvent(ctx context.Context, owner int64, eventID string) (InboxEvent, error) {
	if !validInboxEventID(eventID) {
		return InboxEvent{}, ErrNotFound
	}
	var out InboxEvent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		row, ok, err := getInboxTx(ctx, tx, owner, eventID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = row
		return nil
	})
	return out, mapInboxErr(err)
}

func (s *Store) ClaimInboxEvent(ctx context.Context, owner int64, eventID string, leaseSeconds int) (InboxClaim, error) {
	if !validInboxEventID(eventID) {
		return InboxClaim{}, ErrNotFound
	}
	if leaseSeconds < 1 || leaseSeconds > 120 {
		return InboxClaim{}, ErrInvalid
	}
	var claim InboxClaim
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_token, out_expires_at FROM vc.claim_inbox_event($1,$2,$3)`,
			owner, eventID, leaseSeconds).Scan(&claim.LeaseToken, &claim.LeaseExpiresAt)
	})
	return claim, mapInboxErr(err)
}

func (s *Store) AckInboxEvent(ctx context.Context, owner int64, eventID, leaseToken, messageID string, messageRevision int64) (InboxEvent, error) {
	if !validInboxEventID(eventID) {
		return InboxEvent{}, ErrNotFound
	}
	messageID = strings.TrimSpace(messageID)
	if strings.TrimSpace(leaseToken) == "" || messageID == "" || len(messageID) > 128 || messageRevision < 0 {
		return InboxEvent{}, ErrInvalid
	}
	var out InboxEvent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		row, ok, err := getInboxTx(ctx, tx, owner, eventID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		if row.Intent == "WAITING_HOST" {
			return ErrInvalid
		}
		var acked bool
		if err := tx.QueryRow(ctx, `SELECT vc.ack_inbox_event($1,$2,$3,$4,$5)`,
			owner, eventID, leaseToken, messageID, messageRevision).Scan(&acked); err != nil {
			return err
		}
		if !acked {
			return ErrInvalid
		}
		row, ok, err = getInboxTx(ctx, tx, owner, eventID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = row
		return nil
	})
	return out, mapInboxErr(err)
}

func (s *Store) MarkInboxRead(ctx context.Context, owner int64, eventID string) (InboxEvent, error) {
	if !validInboxEventID(eventID) {
		return InboxEvent{}, ErrNotFound
	}
	var out InboxEvent
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.mark_inbox_read($1,$2)`, owner, eventID); err != nil {
			return err
		}
		row, ok, err := getInboxTx(ctx, tx, owner, eventID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = row
		return nil
	})
	return out, mapInboxErr(err)
}

// ObserveInboxLink reports the current link without writing and without
// creating a channel delivery. An unread or undelivered row stays as stored.
func ObserveInboxLink(event InboxEvent, snap stsource.Snapshot) string {
	if !event.STDelivered || event.MessageID == nil || event.MessageRevision == nil {
		return event.LinkStatus
	}
	switch snap.State {
	case "DELETED":
		return "removed"
	case "PRESENT":
		// An unchanged snapshot has no message list. It is not evidence that
		// the saved message disappeared, and it must not open a new delivery.
		if snap.NotModified {
			return event.LinkStatus
		}
	default:
		return event.LinkStatus
	}
	if event.Branch != nil && *event.Branch != "" && snap.BranchRoot != *event.Branch {
		return "invalidated"
	}
	var found *stsource.Message
	for i := range snap.Messages {
		if snap.Messages[i].MessageID == *event.MessageID {
			found = &snap.Messages[i]
			break
		}
	}
	if found == nil {
		return "removed"
	}
	if found.InboxEventID != event.EventID || found.Revision < *event.MessageRevision {
		return "invalidated"
	}
	return "present"
}

// ApplyInboxLink stores only the observed link status.
func (s *Store) ApplyInboxLink(ctx context.Context, owner int64, eventID string, snap stsource.Snapshot) (InboxEvent, error) {
	event, err := s.GetInboxEvent(ctx, owner, eventID)
	if err != nil {
		return InboxEvent{}, err
	}
	status := ObserveInboxLink(event, snap)
	if status == event.LinkStatus {
		return event, nil
	}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.set_inbox_link_status($1,$2,$3)`, owner, eventID, status)
		return err
	})
	if err != nil {
		return InboxEvent{}, mapInboxErr(err)
	}
	return s.GetInboxEvent(ctx, owner, eventID)
}

func mapInboxErr(err error) error {
	if err == nil || errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) ||
		errors.Is(err, ErrInboxLeaseHeld) || errors.Is(err, ErrInboxLeaseRejected) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		switch {
		case strings.Contains(pgErr.Message, "inbox lease is held"):
			return ErrInboxLeaseHeld
		case strings.Contains(pgErr.Message, "inbox lease expired"), strings.Contains(pgErr.Message, "inbox lease token does not match"):
			return ErrInboxLeaseRejected
		case strings.Contains(pgErr.Message, "already exists"):
			return ErrConflict
		case strings.Contains(pgErr.Message, "not ready"), strings.Contains(pgErr.Message, "lease seconds"):
			return ErrInvalid
		case strings.Contains(pgErr.Message, "not found"):
			return ErrNotFound
		}
	}
	return mapStoreErr(err)
}
