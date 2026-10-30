package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type companionStateStore interface {
	GetCompanionState(ctx context.Context, owner, relationshipID int64, now time.Time) (postgres.CompanionState, error)
}

// ProactiveRunner is the jobs loop. HTTP always asks for a judgment.
type ProactiveRunner interface {
	RunRelationshipProactive(ctx context.Context, owner, relationshipID int64, now time.Time) (postgres.ProactiveRunResult, error)
}

type companionStateJSON struct {
	Mood struct {
		Tier string `json:"tier"`
		Vibe string `json:"vibe"`
		Line string `json:"line"`
	} `json:"mood"`
	Emotion struct {
		Line      string `json:"line"`
		Closeness int    `json:"closeness"`
		Mood      int    `json:"mood"`
		Energy    int    `json:"energy"`
	} `json:"emotion"`
	BusyUntil *string `json:"busyUntil"`
}

type proactiveRunJSON struct {
	Outcome string `json:"outcome"`
	Reason  string `json:"reason"`
	EventID string `json:"eventId,omitempty"`
}

func (s *Server) handleGetCompanionState(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st := s.companionState(w)
	if st == nil {
		return
	}
	row, err := st.GetCompanionState(r.Context(), p.AccountID, id, time.Now())
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	var body companionStateJSON
	body.Mood.Tier, body.Mood.Vibe, body.Mood.Line = row.MoodTier, row.MoodVibe, row.MoodLine
	body.Emotion.Line, body.Emotion.Closeness, body.Emotion.Mood, body.Emotion.Energy = row.EmotionLine, row.Closeness, row.Mood, row.Energy
	if row.BusyUntil != nil {
		text := row.BusyUntil.UTC().Format(time.RFC3339)
		body.BusyUntil = &text
	}
	s.writeJSON(w, http.StatusOK, body)
}

func (s *Server) handlePostProactiveRun(w http.ResponseWriter, r *http.Request) {
	p := s.followPrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var req struct {
		Now *string `json:"now"`
	}
	if !s.decodeJSON(w, r, &req) {
		return
	}
	now := time.Now()
	if req.Now != nil && *req.Now != "" {
		parsed, err := time.Parse(time.RFC3339, *req.Now)
		if err != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		now = parsed
	}
	if s.core == nil || s.core.Proactive == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	result, err := s.core.Proactive.RunRelationshipProactive(r.Context(), p.AccountID, id, now)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			s.writeStoreErr(w, err)
			return
		}
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	s.writeJSON(w, http.StatusOK, proactiveRunJSON{Outcome: result.Outcome, Reason: result.Reason, EventID: result.EventID})
}

func (s *Server) companionState(w http.ResponseWriter) companionStateStore {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	st, ok := s.core.Store.(companionStateStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	return st
}
