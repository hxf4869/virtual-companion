package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// notificationHTTPStore is the channel and delivery surface. Handlers bind it
// by type assertion so CompanionStore stays unchanged.
type notificationHTTPStore interface {
	ListNotificationChannels(ctx context.Context, owner int64) ([]postgres.NotificationChannel, error)
	PutNotificationChannel(ctx context.Context, owner int64, in postgres.NotificationChannelInput) (postgres.NotificationChannel, error)
	ListNotificationDeliveries(ctx context.Context, owner int64) ([]postgres.NotificationDeliveryList, error)
}

type notificationChannelJSON struct {
	ChannelID        string   `json:"channelId"`
	Channel          string   `json:"channel"`
	Enabled          bool     `json:"enabled"`
	ConfiguredTarget string   `json:"configuredTarget"`
	PreviewBody      bool     `json:"previewBody"`
	RelationshipIDs  []string `json:"relationshipIds"`
}

type notificationDeliveryJSON struct {
	DeliveryID       string  `json:"deliveryId"`
	EventID          string  `json:"eventId"`
	Channel          string  `json:"channel"`
	ConfiguredTarget string  `json:"configuredTarget"`
	Status           string  `json:"status"`
	AttemptCount     int     `json:"attemptCount"`
	NextAttemptAt    *string `json:"nextAttemptAt"`
	CorrelationID    *string `json:"correlationId"`
	FailureCode      *string `json:"failureCode"`
	StoppedReason    *string `json:"stoppedReason"`
}

func notificationChannelJSONFrom(row postgres.NotificationChannel) notificationChannelJSON {
	rels := make([]string, 0, len(row.RelationshipIDs))
	for _, id := range row.RelationshipIDs {
		rels = append(rels, idString(id))
	}
	return notificationChannelJSON{
		ChannelID:        idString(row.ID),
		Channel:          row.Channel,
		Enabled:          row.Enabled,
		ConfiguredTarget: row.ConfiguredTarget,
		PreviewBody:      row.PreviewBody,
		RelationshipIDs:  rels,
	}
}

func notificationDeliveryJSONFrom(row postgres.NotificationDeliveryList) notificationDeliveryJSON {
	return notificationDeliveryJSON{
		DeliveryID:       idString(row.ID),
		EventID:          row.EventID,
		Channel:          row.Channel,
		ConfiguredTarget: row.ConfiguredTarget,
		Status:           row.Status,
		AttemptCount:     row.AttemptCount,
		NextAttemptAt:    optTime(row.NextAttemptAt),
		CorrelationID:    row.CorrelationID,
		FailureCode:      row.FailureCode,
		StoppedReason:    row.StoppedReason,
	}
}

func (s *Server) notificationStore(w http.ResponseWriter) notificationHTTPStore {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	st, ok := s.core.Store.(notificationHTTPStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}

func (s *Server) handleListNotificationChannels(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	st := s.notificationStore(w)
	if st == nil {
		return
	}
	rows, err := st.ListNotificationChannels(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]notificationChannelJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, notificationChannelJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handlePutNotificationChannel(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		Channel          *string         `json:"channel"`
		Enabled          *bool           `json:"enabled"`
		ConfiguredTarget *string         `json:"configuredTarget"`
		Credential       json.RawMessage `json:"credential"`
		PreviewBody      *bool           `json:"previewBody"`
		RelationshipIDs  []string        `json:"relationshipIds"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.Channel == nil || body.Enabled == nil || body.ConfiguredTarget == nil || body.PreviewBody == nil || body.RelationshipIDs == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	channel := strings.TrimSpace(*body.Channel)
	if channel != "EMAIL" && channel != "FEISHU" {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	target := strings.TrimSpace(*body.ConfiguredTarget)
	if target == "" || strings.Contains(strings.ToLower(target), "://") || len(body.RelationshipIDs) > 32 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rels := make([]int64, 0, len(body.RelationshipIDs))
	for _, raw := range body.RelationshipIDs {
		id, ok := parsePathID(raw)
		if !ok {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		rels = append(rels, id)
	}
	mode := "keep"
	plain := ""
	if len(body.Credential) > 0 {
		if string(body.Credential) == "null" {
			mode = "clear"
		} else {
			var cred string
			if json.Unmarshal(body.Credential, &cred) != nil || cred == "" {
				s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
				return
			}
			mode = "set"
			plain = cred
		}
	}
	st := s.notificationStore(w)
	if st == nil {
		return
	}
	row, err := st.PutNotificationChannel(r.Context(), p.AccountID, postgres.NotificationChannelInput{
		Channel:          channel,
		Enabled:          *body.Enabled,
		ConfiguredTarget: target,
		PreviewBody:      *body.PreviewBody,
		RelationshipIDs:  rels,
		CredentialMode:   mode,
		CredentialPlain:  plain,
	})
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, notificationChannelJSONFrom(row))
}

func (s *Server) handleListNotificationDeliveries(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	st := s.notificationStore(w)
	if st == nil {
		return
	}
	rows, err := st.ListNotificationDeliveries(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]notificationDeliveryJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, notificationDeliveryJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, out)
}
