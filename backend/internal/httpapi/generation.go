package httpapi

import (
	"net/http"
	"unicode/utf8"
)

var feedbackKinds = map[string]struct{}{
	"TOO_MECHANICAL":   {},
	"FORGOT_CONTEXT":   {},
	"CROSSED_BOUNDARY": {},
	"FACTUAL_ERROR":    {},
	"UNSAFE":           {},
}

type feedbackJSON struct {
	GenerationID string  `json:"generationId"`
	Kind         string  `json:"kind"`
	Note         *string `json:"note,omitempty"`
	CreatedAt    string  `json:"createdAt"`
}

func (s *Server) registerGeneration() {
	if s.core == nil || s.core.Turns == nil {
		return
	}
	s.mux.HandleFunc("POST /api/v1/generations/{generationId}/feedback", s.handleGenerationFeedback)
}

func (s *Server) handleGenerationFeedback(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("generationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		Kind string `json:"kind"`
		Note string `json:"note"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if _, ok := feedbackKinds[body.Kind]; !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if utf8.RuneCountInString(body.Note) > 500 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rec, err := s.core.Turns.RecordGenerationFeedback(r.Context(), p.AccountID, id, body.Kind, body.Note)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, feedbackJSON{
		GenerationID: idString(rec.GenerationID),
		Kind:         rec.Kind,
		Note:         rec.Note,
		CreatedAt:    rfc3339(rec.CreatedAt),
	})
}
