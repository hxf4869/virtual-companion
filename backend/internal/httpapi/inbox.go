package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// inboxStore is the W10 inbox surface. Handlers bind it by type assertion so
// CompanionStore stays unchanged. Route registration belongs to T4.
type inboxStore interface {
	ListInboxEvents(ctx context.Context, owner int64) ([]postgres.InboxEvent, error)
	ClaimInboxEvent(ctx context.Context, owner int64, eventID string, leaseSeconds int) (postgres.InboxClaim, error)
	AckInboxEvent(ctx context.Context, owner int64, eventID, leaseToken, messageID string, messageRevision int64) (postgres.InboxEvent, error)
	MarkInboxRead(ctx context.Context, owner int64, eventID string) (postgres.InboxEvent, error)
}

type inboxLinkJSON struct {
	RelationshipID string  `json:"relationshipId"`
	ConversationID string  `json:"conversationId"`
	Branch         *string `json:"branch"`
}

type inboxEventJSON struct {
	InboxID         string        `json:"inboxId"`
	EventID         string        `json:"eventId"`
	RelationshipID  string        `json:"relationshipId"`
	ConversationID  string        `json:"conversationId"`
	Branch          *string       `json:"branch"`
	SourceRevision  *int64        `json:"sourceRevision"`
	Intent          string        `json:"intent"`
	Body            *string       `json:"body"`
	Persisted       bool          `json:"persisted"`
	STDelivered     bool          `json:"stDelivered"`
	MessageID       *string       `json:"messageId"`
	MessageRevision *int64        `json:"messageRevision"`
	LinkStatus      string        `json:"linkStatus"`
	Link            inboxLinkJSON `json:"link"`
	ReadAt          *time.Time    `json:"readAt"`
	Read            bool          `json:"read"`
}

type inboxClaimJSON struct {
	LeaseToken     string `json:"leaseToken"`
	LeaseExpiresAt string `json:"leaseExpiresAt"`
}

func inboxEventJSONFrom(row postgres.InboxEvent) inboxEventJSON {
	return inboxEventJSON{
		InboxID:         idString(row.ID),
		EventID:         row.EventID,
		RelationshipID:  idString(row.RelationshipID),
		ConversationID:  idString(row.ConversationID),
		Branch:          row.Branch,
		SourceRevision:  row.SourceRevision,
		Intent:          row.Intent,
		Body:            row.Body,
		Persisted:       row.Persisted,
		STDelivered:     row.STDelivered,
		MessageID:       row.MessageID,
		MessageRevision: row.MessageRevision,
		LinkStatus:      row.LinkStatus,
		Link: inboxLinkJSON{
			RelationshipID: idString(row.RelationshipID),
			ConversationID: idString(row.ConversationID),
			Branch:         row.Branch,
		},
		ReadAt: row.ReadAt,
		Read:   row.ReadAt != nil,
	}
}

func (s *Server) inbox(w http.ResponseWriter) inboxStore {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	st, ok := s.core.Store.(inboxStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}

func (s *Server) writeInboxErr(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrInboxLeaseHeld) || errors.Is(err, postgres.ErrInboxLeaseRejected) {
		s.writeAPIError(w, http.StatusConflict, "INVALID_REQUEST", "invalid request")
		return
	}
	s.writeStoreErr(w, err)
}

func (s *Server) handleListInbox(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	st := s.inbox(w)
	if st == nil {
		return
	}
	rows, err := st.ListInboxEvents(r.Context(), p.AccountID)
	if err != nil {
		s.writeInboxErr(w, err)
		return
	}
	out := make([]inboxEventJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, inboxEventJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleClaimInbox(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventId"))
	var body struct {
		LeaseSeconds *int `json:"leaseSeconds"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.LeaseSeconds == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.inbox(w)
	if st == nil {
		return
	}
	claim, err := st.ClaimInboxEvent(r.Context(), p.AccountID, eventID, *body.LeaseSeconds)
	if err != nil {
		s.writeInboxErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, inboxClaimJSON{
		LeaseToken:     claim.LeaseToken,
		LeaseExpiresAt: claim.LeaseExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) handleAckInbox(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventId"))
	var body struct {
		LeaseToken      *string `json:"leaseToken"`
		MessageID       *string `json:"messageId"`
		MessageRevision *int64  `json:"messageRevision"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.LeaseToken == nil || body.MessageID == nil || body.MessageRevision == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.inbox(w)
	if st == nil {
		return
	}
	row, err := st.AckInboxEvent(r.Context(), p.AccountID, eventID, *body.LeaseToken, *body.MessageID, *body.MessageRevision)
	if err != nil {
		s.writeInboxErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, inboxEventJSONFrom(row))
}

func (s *Server) handleMarkInboxRead(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	eventID := strings.TrimSpace(r.PathValue("eventId"))
	st := s.inbox(w)
	if st == nil {
		return
	}
	row, err := st.MarkInboxRead(r.Context(), p.AccountID, eventID)
	if err != nil {
		s.writeInboxErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, inboxEventJSONFrom(row))
}
