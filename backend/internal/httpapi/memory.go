package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type memoryJSON struct {
	MemoryID             string  `json:"memoryId"`
	Scope                string  `json:"scope"`
	Summary              string  `json:"summary"`
	Status               string  `json:"status"`
	ConversationID       *string `json:"conversationId,omitempty"`
	CreatedAt            string  `json:"createdAt"`
	DeletedAt            *string `json:"deletedAt,omitempty"`
	AutoSaved            bool    `json:"autoSaved"`
	SupersededAt         *string `json:"supersededAt,omitempty"`
	SupersededByMemoryID *string `json:"supersededByMemoryId,omitempty"`
	EventAt              *string `json:"eventAt,omitempty"`
	EventStatus          *string `json:"eventStatus,omitempty"`
	EventExpiresAt       *string `json:"eventExpiresAt,omitempty"`
}

type memoryEvidenceJSON struct {
	EvidenceID string `json:"evidenceId"`
	SourceRef  string `json:"sourceRef"`
	CreatedAt  string `json:"createdAt"`
}

func memoryJSONFrom(m postgres.Memory) memoryJSON {
	return memoryJSON{
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

func (s *Server) handleListMemories(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	relID, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	include, ok := parseOptionalBool(r.URL.Query().Get("includeDeleted"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	list, err := s.core.Store.ListMemories(r.Context(), p.AccountID, relID, include)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]memoryJSON, 0, len(list))
	for _, m := range list {
		out = append(out, memoryJSONFrom(m))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleGetMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	mem, err := s.core.Store.GetMemory(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
}

func (s *Server) handleUpdateMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	var body struct {
		Summary        string  `json:"summary"`
		EventAt        *string `json:"eventAt"`
		EventStatus    *string `json:"eventStatus"`
		EventExpiresAt *string `json:"eventExpiresAt"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	eventAt, eventExpires, ok := parseEventTimes(body.EventAt, body.EventExpiresAt)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	mem, err := s.core.Store.UpdateMemory(r.Context(), p.AccountID, id, strings.TrimSpace(body.Summary), eventAt, trimOpt(body.EventStatus), eventExpires)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
}

func (s *Server) handleDeleteMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	mem, err := s.core.Store.DeleteMemory(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, memoryJSONFrom(mem))
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
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	list, err := s.core.Store.ListMemoryEvidence(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]memoryEvidenceJSON, 0, len(list))
	for _, e := range list {
		out = append(out, memoryEvidenceJSON{
			EvidenceID: idString(e.ID),
			SourceRef:  e.SourceRef,
			CreatedAt:  rfc3339(e.CreatedAt),
		})
	}
	s.writeJSON(w, http.StatusOK, out)
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
