package httpapi

import (
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type reportJSON struct {
	ID             string  `json:"id"`
	MessageID      *string `json:"messageId"`
	Reason         string  `json:"reason"`
	Note           string  `json:"note"`
	Status         string  `json:"status"`
	ResolutionNote *string `json:"resolutionNote,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	ResolvedAt     *string `json:"resolvedAt,omitempty"`
}

func reportJSONFrom(rec postgres.Report) reportJSON {
	var resolution *string
	if rec.ResolutionNote != "" {
		n := rec.ResolutionNote
		resolution = &n
	}
	return reportJSON{
		ID:             idString(rec.ID),
		MessageID:      optID(rec.MessageID),
		Reason:         rec.Reason,
		Note:           rec.Note,
		Status:         rec.Status,
		ResolutionNote: resolution,
		CreatedAt:      rfc3339(rec.CreatedAt),
		ResolvedAt:     optTime(rec.ResolvedAt),
	}
}

func (s *Server) handleCreateReport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		MessageID *wireID `json:"messageId"`
		Reason    string  `json:"reason"`
		Note      string  `json:"note"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	var msg *int64
	if body.MessageID != nil && body.MessageID.Set {
		v := body.MessageID.V
		msg = &v
	}
	rec, err := s.core.Store.CreateReport(r.Context(), p.AccountID, msg, strings.TrimSpace(body.Reason), body.Note)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, reportJSONFrom(rec))
}

func (s *Server) handleListReports(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	after, afterSet, ok := parseOptionalID(r.URL.Query().Get("after"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	limit, limitSet, ok := parseOptionalLimit(r.URL.Query().Get("limit"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var afterPtr *int64
	var limitPtr *int
	if afterSet {
		afterPtr = &after
	}
	if limitSet {
		limitPtr = &limit
	}
	list, err := s.core.Store.ListReports(r.Context(), p.AccountID, afterPtr, limitPtr)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]reportJSON, 0, len(list))
	for _, rec := range list {
		out = append(out, reportJSONFrom(rec))
	}
	s.writeJSON(w, http.StatusOK, out)
}
