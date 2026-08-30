package httpapi

import (
	"net/http"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var feedbackKinds = map[string]struct{}{
	"TOO_MECHANICAL":    {},
	"FORGOT_CONTEXT":    {},
	"CROSSED_BOUNDARY":  {},
	"FACTUAL_ERROR":     {},
	"UNSAFE":            {},
}

type generationJSON struct {
	GenerationID        string `json:"generationId"`
	ConversationID      string `json:"conversationId"`
	LogicalGenerationID string `json:"logicalGenerationId"`
	Status              string `json:"status"`
	Mode                string `json:"mode"`
	CreatedAt           string `json:"createdAt,omitempty"`
}

type generationSnapshotJSON struct {
	Status             string           `json:"status"`
	AssistantMessageID *string          `json:"assistantMessageId,omitempty"`
	Events             []map[string]any `json:"events"`
	Usage              *usageJSON       `json:"usage,omitempty"`
}

type usageJSON struct {
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
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
	s.mux.HandleFunc("POST /api/v1/conversations/{conversationId}/generations", s.handleSendGeneration)
	s.mux.HandleFunc("POST /api/v1/generations/{generationId}/cancel", s.handleCancelGeneration)
	s.mux.HandleFunc("GET /api/v1/generations/{generationId}/snapshot", s.handleGenerationSnapshot)
	s.mux.HandleFunc("POST /api/v1/generations/{generationId}/feedback", s.handleGenerationFeedback)
}

func (s *Server) handleSendGeneration(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	convID, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		IdempotencyKey      string  `json:"idempotencyKey"`
		UserContent         string  `json:"userContent"`
		Mode                string  `json:"mode"`
		SourceUserMessageID *wireID `json:"sourceUserMessageId"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.IdempotencyKey == "" || utf8.RuneCountInString(body.IdempotencyKey) > 128 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if len(body.UserContent) > companion.MaxMessageBytes {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	in := postgres.StartTurn{
		ConversationID: convID,
		IdempotencyKey: body.IdempotencyKey,
		UserContent:    body.UserContent,
		Mode:           body.Mode,
		MaxOutstanding: s.cfg.Concurrency.MaxOutstandingTurns,
	}
	if body.SourceUserMessageID != nil && body.SourceUserMessageID.Set {
		id := body.SourceUserMessageID.V
		in.SourceMessageID = &id
	}
	view, err := s.core.Turns.StartTurn(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	// §19.5: intake and idempotent replay both answer 202 Accepted.
	s.writeJSON(w, http.StatusAccepted, generationJSONFrom(view))
}

func (s *Server) handleCancelGeneration(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("generationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	view, err := s.core.Turns.CancelTurn(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if s.core.Cancels != nil {
		s.core.Cancels.Cancel(id)
	}
	if s.core.Hub != nil {
		s.core.Hub.Cancelled(idString(id))
	}
	s.writeJSON(w, http.StatusOK, generationJSONFrom(view))
}

func (s *Server) handleGenerationSnapshot(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("generationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	snap, err := s.core.Turns.GenerationSnapshot(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := generationSnapshotJSON{Status: snap.Status, Events: []map[string]any{}}
	if snap.AssistantMessageID != nil {
		s := idString(*snap.AssistantMessageID)
		out.AssistantMessageID = &s
	}
	if snap.InputTokens != nil && snap.OutputTokens != nil &&
		(snap.Status == "COMPLETED" || snap.Status == "COMPLETED_FALLBACK") {
		out.Usage = &usageJSON{InputTokens: *snap.InputTokens, OutputTokens: *snap.OutputTokens}
	}
	s.writeJSON(w, http.StatusOK, out)
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

func generationJSONFrom(v postgres.GenerationView) generationJSON {
	return generationJSON{
		GenerationID:        idString(v.ID),
		ConversationID:      idString(v.ConversationID),
		LogicalGenerationID: v.LogicalGenerationID,
		Status:              v.Status,
		Mode:                v.Mode,
		CreatedAt:           rfc3339(v.CreatedAt),
	}
}
