package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/restoregate"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type memoryJSON struct {
	Version              int64                `json:"version"`
	Type                 string               `json:"type"`
	RelationshipID       string               `json:"relationshipId"`
	Mode                 string               `json:"mode"`
	Lifecycle            string               `json:"lifecycle"`
	SourceStatus         string               `json:"sourceStatus"`
	RecallEligible       bool                 `json:"recallEligible"`
	MemoryID             string               `json:"memoryId"`
	Scope                string               `json:"scope"`
	Summary              string               `json:"summary"`
	Status               string               `json:"status"`
	ConversationID       *string              `json:"conversationId,omitempty"`
	CreatedAt            string               `json:"createdAt"`
	DeletedAt            *string              `json:"deletedAt,omitempty"`
	AutoSaved            bool                 `json:"autoSaved"`
	SupersededAt         *string              `json:"supersededAt,omitempty"`
	SupersededByMemoryID *string              `json:"supersededByMemoryId,omitempty"`
	EventAt              *string              `json:"eventAt,omitempty"`
	EventStatus          *string              `json:"eventStatus,omitempty"`
	EventExpiresAt       *string              `json:"eventExpiresAt,omitempty"`
	Time                 *postgres.MemoryTime `json:"time,omitempty"`
}

type memoryEvidenceJSON struct {
	EvidenceID string `json:"evidenceId"`
	SourceRef  string `json:"sourceRef"`
	CreatedAt  string `json:"createdAt"`
}

func memoryJSONFrom(m postgres.Memory) memoryJSON {
	lifecycle := "ACTIVE"
	if m.SupersededAt != nil {
		lifecycle = "SUPERSEDED"
	}
	if m.DeletedAt != nil {
		lifecycle = "FORGETTING"
	}
	kind := "FACT"
	if m.EventAt != nil {
		kind = "EVENT"
	}
	if m.Time == nil {
		m.Time = &postgres.MemoryTime{RecordedAt: m.CreatedAt}
	}
	return memoryJSON{
		Version: 1, Type: kind, RelationshipID: idString(m.RelationshipID), Mode: "DAILY", Lifecycle: lifecycle, SourceStatus: "PENDING_VERIFICATION", RecallEligible: false,
		MemoryID:             idString(m.ID),
		Scope:                m.Scope,
		Summary:              m.Summary,
		Status:               m.Status,
		ConversationID:       optID(m.ConversationID),
		CreatedAt:            rfc3339(m.CreatedAt),
		DeletedAt:            optTime(m.DeletedAt),
		AutoSaved:            m.AutoSaved,
		SupersededAt:         optTime(m.SupersededAt),
		SupersededByMemoryID: optID(m.SupersededByMemoryID),
		EventAt:              optTime(m.EventAt),
		EventStatus:          m.EventStatus,
		EventExpiresAt:       optTime(m.EventExpiresAt),
		Time:                 m.Time,
	}
}

func (s *Server) handleCreateMemoryCandidate(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	relID, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		Scope          string   `json:"scope"`
		Summary        string   `json:"summary"`
		ConversationID *wireID  `json:"conversationId"`
		Evidence       []string `json:"evidence"`
		EventAt        *string  `json:"eventAt"`
		EventStatus    *string  `json:"eventStatus"`
		EventExpiresAt *string  `json:"eventExpiresAt"`
		IdempotencyKey string   `json:"idempotencyKey"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	key := strings.TrimSpace(body.IdempotencyKey)
	if key == "" {
		key = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	}
	eventAt, eventExpires, ok := parseEventTimes(body.EventAt, body.EventExpiresAt)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	in := postgres.MemoryCreate{
		RelationshipID: relID,
		Scope:          strings.TrimSpace(body.Scope),
		Summary:        strings.TrimSpace(body.Summary),
		Evidence:       body.Evidence,
		EventAt:        eventAt,
		EventStatus:    trimOpt(body.EventStatus),
		EventExpiresAt: eventExpires,
		IdempotencyKey: key,
	}
	if body.ConversationID != nil && body.ConversationID.Set {
		v := body.ConversationID.V
		in.ConversationID = &v
	}
	mem, err := s.core.Store.CreateMemoryCandidate(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
}

type managedMemoryStore interface {
	ListManagedMemories(context.Context, int64, int64, postgres.MemoryFilters) ([]json.RawMessage, string, error)
	GetManagedMemory(context.Context, int64, int64) (json.RawMessage, error)
	ManagedMemoryEvidence(context.Context, int64, int64) ([]json.RawMessage, error)
	CorrectManagedMemory(context.Context, int64, int64, int64, string) (json.RawMessage, error)
	ForgetManagedMemory(context.Context, int64, int64) error
}

func (s *Server) managedMemories(w http.ResponseWriter) managedMemoryStore {
	st, ok := s.core.Store.(managedMemoryStore)
	if !ok {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}
func (s *Server) restoreGateClosed(w http.ResponseWriter) bool {
	if s == nil || !restoregate.Closed(s.cfg.RestoreGateFile) {
		return false
	}
	s.writeAPIError(w, http.StatusServiceUnavailable, "RESTORE_GATE_CLOSED", "restore cleanup is not finished")
	return true
}

func (s *Server) handleListMemories(w http.ResponseWriter, r *http.Request) {
	if s.restoreGateClosed(w) {
		return
	}
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.managedMemories(w)
	if st == nil {
		return
	}
	q := r.URL.Query()
	limit := 0
	if q.Has("limit") {
		v, e := strconv.Atoi(q.Get("limit"))
		if e != nil || v < 1 {
			s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid request")
			return
		}
		limit = v
	}
	rows, next, err := st.ListManagedMemories(r.Context(), p.AccountID, id, postgres.MemoryFilters{Query: q.Get("q"), Status: q.Get("status"), EventDateFrom: q.Get("eventDateFrom"), EventDateTo: q.Get("eventDateTo"), Cursor: q.Get("cursor"), Limit: limit})
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if next != "" {
		w.Header().Set("X-Next-Cursor", next)
	}
	s.writeJSON(w, 200, rows)
}
func (s *Server) handleGetMemory(w http.ResponseWriter, r *http.Request) {
	if s.restoreGateClosed(w) {
		return
	}
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, 404, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st := s.managedMemories(w)
	if st == nil {
		return
	}
	row, err := st.GetManagedMemory(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, 200, row)
}
func (s *Server) handleUpdateMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, 403, "ACCESS_DENIED", "recent reauthentication required")
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, 404, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	var body struct {
		Summary         string `json:"summary"`
		ExpectedVersion int64  `json:"expectedVersion"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.ExpectedVersion < 1 {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "expectedVersion is required")
		return
	}
	st := s.managedMemories(w)
	if st == nil {
		return
	}
	row, err := st.CorrectManagedMemory(r.Context(), p.AccountID, id, body.ExpectedVersion, strings.TrimSpace(body.Summary))
	if errors.Is(err, postgres.ErrMemoryVersionConflict) {
		s.writeAPIError(w, 409, "MEMORY_VERSION_CONFLICT", "memory has changed")
		return
	}
	if errors.Is(err, memoryengine.ErrUnavailable) {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "memory engine temporarily unavailable")
		return
	}
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, 200, row)
}
func (s *Server) handleDeleteMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, 403, "ACCESS_DENIED", "recent reauthentication required")
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.managedMemories(w)
	if st == nil {
		return
	}
	if err := st.ForgetManagedMemory(r.Context(), p.AccountID, id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, 202, map[string]any{"cleanup": map[string]string{"state": "PENDING"}})
}

func (s *Server) handleConfirmMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var supersede *int64
	if r.ContentLength != 0 {
		var body struct {
			SupersedeMemoryID *wireID `json:"supersedeMemoryId"`
		}
		if r.Body != nil && r.ContentLength > 0 {
			if !s.decodeJSON(w, r, &body) {
				return
			}
			if body.SupersedeMemoryID != nil && body.SupersedeMemoryID.Set {
				v := body.SupersedeMemoryID.V
				supersede = &v
			}
		}
	}
	mem, err := s.core.Store.ConfirmMemory(r.Context(), p.AccountID, id, supersede)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
}

func (s *Server) handleRejectMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	mem, err := s.core.Store.RejectMemory(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
}

func (s *Server) handleListMemoryEvidence(w http.ResponseWriter, r *http.Request) {
	if s.restoreGateClosed(w) {
		return
	}
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.managedMemories(w)
	if st == nil {
		return
	}
	rows, err := st.ManagedMemoryEvidence(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, 200, rows)
}

// memoryAutoSavePrefStore is the per-owner auto-memory kill-switch surface
// (V66). The handler binds it by type assertion, mirroring the jobs package
// routeStore pattern, so the shared CompanionStore interface stays unchanged.
type memoryAutoSavePrefStore interface {
	GetMemoryAutoSavePref(ctx context.Context, owner int64) (bool, error)
	UpdateMemoryAutoSavePref(ctx context.Context, owner int64, enabled bool) (bool, error)
}

type memoryAutoSavePrefJSON struct {
	Enabled bool `json:"enabled"`
}

func (s *Server) memoryAutoSaveStore(w http.ResponseWriter) memoryAutoSavePrefStore {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	st, ok := s.core.Store.(memoryAutoSavePrefStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}

func (s *Server) handleGetMemoryAutoSavePref(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	st := s.memoryAutoSaveStore(w)
	if st == nil {
		return
	}
	v, err := st.GetMemoryAutoSavePref(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryAutoSavePrefJSON{Enabled: v})
}

func (s *Server) handleUpdateMemoryAutoSavePref(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	st := s.memoryAutoSaveStore(w)
	if st == nil {
		return
	}
	var body struct {
		Enabled *bool `json:"enabled"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.Enabled == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	v, err := st.UpdateMemoryAutoSavePref(r.Context(), p.AccountID, *body.Enabled)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryAutoSavePrefJSON{Enabled: v})
}

func parseEventTimes(eventAt, eventExpires *string) (*time.Time, *time.Time, bool) {
	a, ok := parseOptionalRFC3339(eventAt)
	if !ok {
		return nil, nil, false
	}
	b, ok := parseOptionalRFC3339(eventExpires)
	if !ok {
		return nil, nil, false
	}
	return a, b, true
}

func parseOptionalRFC3339(raw *string) (*time.Time, bool) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, true
	}
	t, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*raw))
	if err != nil {
		t, err = time.Parse(time.RFC3339, strings.TrimSpace(*raw))
		if err != nil {
			return nil, false
		}
	}
	u := t.UTC()
	return &u, true
}

func parseOptionalBool(raw string) (bool, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return false, true
	}
	switch strings.ToLower(raw) {
	case "true":
		return true, true
	case "false":
		return false, true
	default:
		return false, false
	}
}

func trimOpt(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}

func optID(v *int64) *string {
	if v == nil {
		return nil
	}
	s := idString(*v)
	return &s
}

func optTime(v *time.Time) *string {
	if v == nil {
		return nil
	}
	s := rfc3339(*v)
	return &s
}
