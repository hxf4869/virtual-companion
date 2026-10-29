package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// followUpStore is the W09 follow-up and proactive-policy surface. Handlers
// bind it by type assertion so CompanionStore stays unchanged.
type followUpStore interface {
	GetProactivePolicy(ctx context.Context, owner, relationshipID int64) (postgres.ProactivePolicy, error)
	PutProactivePolicy(ctx context.Context, owner, relationshipID int64, in postgres.ProactivePolicyWrite) (postgres.ProactivePolicy, error)
	ListFollowUps(ctx context.Context, owner, relationshipID int64) ([]postgres.FollowUp, error)
	GetFollowUp(ctx context.Context, owner, id int64) (postgres.FollowUp, error)
	CancelFollowUp(ctx context.Context, owner, id int64) (postgres.FollowUp, error)
}

type followUpJSON struct {
	FollowUpID            string  `json:"followUpId"`
	RelationshipID        string  `json:"relationshipId"`
	MemoryItemID          *string `json:"memoryItemId"`
	SourceRef             *string `json:"sourceRef"`
	SourceRevision        *int64  `json:"sourceRevision"`
	Status                string  `json:"status"`
	Body                  string  `json:"body"`
	NormalizationStatus   string  `json:"normalizationStatus"`
	TimePrecision         *string `json:"timePrecision"`
	ReminderRuleConfirmed bool    `json:"reminderRuleConfirmed"`
	EventDate             *string `json:"eventDate"`
	EventTime             *string `json:"eventTime"`
	EventTimezone         *string `json:"eventTimezone"`
	TriggerAt             *string `json:"triggerAt"`
	EventID               string  `json:"eventId"`
	Deliverable           string  `json:"deliverable"`
}

type proactivePolicyJSON struct {
	RelationshipID           string   `json:"relationshipId"`
	Enabled                  bool     `json:"enabled"`
	QuietHoursStart          *string  `json:"quietHoursStart"`
	QuietHoursEnd            *string  `json:"quietHoursEnd"`
	QuietHoursTimezone       *string  `json:"quietHoursTimezone"`
	DailyLimit               int      `json:"dailyLimit"`
	RecentInteractionMinutes int      `json:"recentInteractionMinutes"`
	AllowedModes             []string `json:"allowedModes"`
	OfflineCapable           bool     `json:"offlineCapable"`
}

func (s *Server) followUps(w http.ResponseWriter) followUpStore {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	st, ok := s.core.Store.(followUpStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}

func (s *Server) followPrincipal(w http.ResponseWriter, r *http.Request, write bool) *auth.Principal {
	p := s.corePrincipal(w, r, write)
	if p == nil {
		return nil
	}
	if write && !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "recent reauthentication required")
		return nil
	}
	return p
}

func (s *Server) handleGetProactivePolicy(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.followUps(w)
	if st == nil {
		return
	}
	row, err := st.GetProactivePolicy(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, proactivePolicyJSONFrom(row))
}

func (s *Server) handlePutProactivePolicy(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		Enabled                  *bool    `json:"enabled"`
		QuietHoursStart          *string  `json:"quietHoursStart"`
		QuietHoursEnd            *string  `json:"quietHoursEnd"`
		QuietHoursTimezone       *string  `json:"quietHoursTimezone"`
		DailyLimit               *int     `json:"dailyLimit"`
		RecentInteractionMinutes *int     `json:"recentInteractionMinutes"`
		AllowedModes             []string `json:"allowedModes"`
		OfflineCapable           *bool    `json:"offlineCapable"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.Enabled == nil || body.DailyLimit == nil || body.RecentInteractionMinutes == nil || body.OfflineCapable == nil || len(body.AllowedModes) == 0 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !quietHoursComplete(body.QuietHoursStart, body.QuietHoursEnd, body.QuietHoursTimezone) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	zone, err := postgres.CanonicalQuietHoursZone(body.QuietHoursTimezone)
	if err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.followUps(w)
	if st == nil {
		return
	}
	row, err := st.PutProactivePolicy(r.Context(), p.AccountID, id, postgres.ProactivePolicyWrite{
		Enabled:                  *body.Enabled,
		QuietHoursStart:          blankable(body.QuietHoursStart),
		QuietHoursEnd:            blankable(body.QuietHoursEnd),
		QuietHoursTimezone:       zone,
		DailyLimit:               *body.DailyLimit,
		RecentInteractionMinutes: *body.RecentInteractionMinutes,
		AllowedModes:             body.AllowedModes,
		OfflineCapable:           *body.OfflineCapable,
	})
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, proactivePolicyJSONFrom(row))
}

func (s *Server) handleListFollowUps(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.followUps(w)
	if st == nil {
		return
	}
	rows, err := st.ListFollowUps(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]followUpJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, followUpJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetFollowUp(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("followUpId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st := s.followUps(w)
	if st == nil {
		return
	}
	row, err := st.GetFollowUp(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, followUpJSONFrom(row))
}

func (s *Server) handleCancelFollowUp(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("followUpId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st := s.followUps(w)
	if st == nil {
		return
	}
	row, err := st.CancelFollowUp(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, followUpJSONFrom(row))
}

func proactivePolicyJSONFrom(row postgres.ProactivePolicy) proactivePolicyJSON {
	modes := row.AllowedModes
	if modes == nil {
		modes = []string{}
	}
	return proactivePolicyJSON{
		RelationshipID: idString(row.RelationshipID), Enabled: row.Enabled,
		QuietHoursStart: row.QuietHoursStart, QuietHoursEnd: row.QuietHoursEnd, QuietHoursTimezone: row.QuietHoursTimezone,
		DailyLimit: row.DailyLimit, RecentInteractionMinutes: row.RecentInteractionMinutes,
		AllowedModes: modes, OfflineCapable: row.OfflineCapable,
	}
}

func followUpJSONFrom(row postgres.FollowUp) followUpJSON {
	return followUpJSON{
		FollowUpID: idString(row.ID), RelationshipID: idString(row.RelationshipID),
		MemoryItemID: optID(row.MemoryItemID), SourceRef: row.SourceRef, SourceRevision: row.SourceRevision,
		Status: row.Status, Body: row.Body, NormalizationStatus: row.NormalizationStatus,
		TimePrecision: row.TimePrecision, ReminderRuleConfirmed: row.ReminderRuleConfirmed,
		EventDate: row.EventDate, EventTime: row.EventTime, EventTimezone: row.EventTimezone,
		TriggerAt: followTrigger(row.TriggerAt), EventID: row.EventID, Deliverable: row.Deliverable,
	}
}

func followTrigger(at *time.Time) *string {
	if at == nil {
		return nil
	}
	s := at.UTC().Format(time.RFC3339)
	return &s
}

func quietHoursComplete(start, end, zone *string) bool {
	blank := func(v *string) bool { return v == nil || strings.TrimSpace(*v) == "" }
	if blank(start) && blank(end) && blank(zone) {
		return true
	}
	return !blank(start) && !blank(end) && !blank(zone)
}

func blankable(v *string) *string {
	if v == nil || strings.TrimSpace(*v) == "" {
		return nil
	}
	s := strings.TrimSpace(*v)
	return &s
}
