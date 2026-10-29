package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var storyChatIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

type storyActionStore interface {
	CommitStoryCommand(context.Context, int64, postgres.StoryCommit) (postgres.StoryCommitResult, error)
	RewindStory(context.Context, int64, postgres.StoryRewind) (postgres.StoryRewindResult, error)
	ConfirmStoryProjection(context.Context, int64, int64, int64) (bool, error)
	MapStoryParticipant(context.Context, int64, int64, string, int64) (int64, error)
	DecideStoryEpilogue(context.Context, int64, postgres.StoryEpilogue) (postgres.StoryEpilogueResult, error)
}

type storyActionResponse struct {
	Accepted     bool   `json:"accepted"`
	Replayed     bool   `json:"replayed"`
	Reason       string `json:"reason,omitempty"`
	WorldVersion int64  `json:"worldVersion"`
	WorldEventID string `json:"worldEventId,omitempty"`
	BranchID     string `json:"branchId"`
	Stage        string `json:"stage"`
	Ended        bool   `json:"ended"`
}

func (s *Server) handleStoryAction(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	var body struct {
		BranchID             string `json:"branchId"`
		ExpectedWorldVersion *int64 `json:"expectedWorldVersion"`
		ActionID             string `json:"actionId"`
		ActorID              string `json:"actorId"`
		Action               string `json:"action"`
		Target               string `json:"target"`
		ClueID               string `json:"clueId"`
		Text                 string `json:"text"`
	}
	if !runOK || !s.decodeStrictJSON(w, r, &body) {
		if runOK {
			return
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	branchID, branchOK := parsePathID(body.BranchID)
	if !branchOK || idString(branchID) != body.BranchID || body.ExpectedWorldVersion == nil || *body.ExpectedWorldVersion < 0 ||
		!validStoryActionID(body.ActionID) || !validActorID(body.ActorID) ||
		(body.Action != "" && !validActorID(body.Action)) ||
		(body.Target != "" && !validActorID(body.Target)) ||
		(body.ClueID != "" && !validActorID(body.ClueID)) ||
		utf8.RuneCountInString(body.Text) > 4000 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.storyActionStore()
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	result, err := store.CommitStoryCommand(r.Context(), principal.AccountID, postgres.StoryCommit{
		RunID: runID, BranchID: branchID, ExpectedWorldVersion: *body.ExpectedWorldVersion,
		ActionID: body.ActionID, ActorID: body.ActorID, Action: body.Action,
		Target: body.Target, ClueID: body.ClueID, Text: body.Text,
	})
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	out := storyActionResponse{
		Accepted: result.Accepted, Replayed: result.Replay, Reason: result.Reason,
		WorldVersion: result.WorldVersion, BranchID: idString(result.BranchID),
		Stage: result.Stage, Ended: result.Ended,
	}
	if result.EventID > 0 {
		out.WorldEventID = idString(result.EventID)
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleStoryRewind(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	var body struct {
		ToWorldVersion *int64 `json:"toWorldVersion"`
		ChatIdentity   string `json:"chatIdentity"`
	}
	if !runOK || !s.decodeStrictJSON(w, r, &body) {
		if runOK {
			return
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if body.ToWorldVersion == nil || *body.ToWorldVersion < 0 || !storyChatIdentity.MatchString(body.ChatIdentity) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.storyActionStore()
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	result, err := store.RewindStory(r.Context(), principal.AccountID, postgres.StoryRewind{
		RunID: runID, ToWorldVersion: *body.ToWorldVersion, ChatIdentity: body.ChatIdentity,
	})
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, struct {
		BranchID     string `json:"branchId"`
		WorldVersion int64  `json:"worldVersion"`
		Stage        string `json:"stage"`
	}{BranchID: idString(result.BranchID), WorldVersion: result.WorldVersion, Stage: result.Stage})
}

func (s *Server) handleStoryProjectionConfirm(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	eventID, eventOK := parsePathID(r.PathValue("eventId"))
	if !runOK || !eventOK || !s.decodeEmptyObject(w, r) {
		if runOK && eventOK {
			return
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.storyActionStore()
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	confirmed, err := store.ConfirmStoryProjection(r.Context(), principal.AccountID, runID, eventID)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, struct {
		WorldEventID string `json:"worldEventId"`
		Confirmed    bool   `json:"confirmed"`
	}{WorldEventID: idString(eventID), Confirmed: confirmed})
}

func (s *Server) handleStoryParticipant(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	actorID := r.PathValue("actorId")
	var body struct {
		RelationshipID string `json:"relationshipId"`
	}
	if !runOK || !s.decodeStrictJSON(w, r, &body) {
		if runOK {
			return
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	relationshipID, relationshipOK := parsePathID(body.RelationshipID)
	if !validActorID(actorID) || !relationshipOK || idString(relationshipID) != body.RelationshipID {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.storyActionStore()
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	mapped, err := store.MapStoryParticipant(r.Context(), principal.AccountID, runID, actorID, relationshipID)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, struct {
		RunID          string `json:"runId"`
		ActorID        string `json:"actorId"`
		RelationshipID string `json:"relationshipId"`
	}{RunID: idString(runID), ActorID: actorID, RelationshipID: idString(mapped)})
}

func (s *Server) handleStoryEpilogue(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	var body struct {
		Decision       string  `json:"decision"`
		RelationshipID *string `json:"relationshipId"`
		Summary        *string `json:"summary"`
	}
	if !runOK || !s.decodeStrictJSON(w, r, &body) {
		if runOK {
			return
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	in := postgres.StoryEpilogue{RunID: runID, Decision: body.Decision}
	if body.Decision == "discard" {
		if body.RelationshipID != nil || body.Summary != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
	} else if body.Decision == "save" {
		if body.RelationshipID == nil || body.Summary == nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		relationshipID, ok := parsePathID(*body.RelationshipID)
		if !ok || idString(relationshipID) != *body.RelationshipID || utf8.RuneCountInString(*body.Summary) > 2000 {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		in.RelationshipID = relationshipID
		in.Summary = *body.Summary
	} else {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.storyActionStore()
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	result, err := store.DecideStoryEpilogue(r.Context(), principal.AccountID, in)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	out := struct {
		Decision       string `json:"decision"`
		RelationshipID string `json:"relationshipId,omitempty"`
		MemoryID       string `json:"memoryId,omitempty"`
		MemoryStatus   string `json:"memoryStatus,omitempty"`
		Summary        string `json:"summary,omitempty"`
	}{Decision: result.Decision, MemoryStatus: result.MemoryStatus, Summary: result.Summary}
	if result.RelationshipID > 0 {
		out.RelationshipID = idString(result.RelationshipID)
	}
	if result.MemoryID > 0 {
		out.MemoryID = idString(result.MemoryID)
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) storyActionStore() (storyActionStore, bool) {
	if s.core == nil || s.core.Store == nil {
		return nil, false
	}
	store, ok := s.core.Store.(storyActionStore)
	return store, ok
}

func (s *Server) decodeEmptyObject(w http.ResponseWriter, r *http.Request) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxCoreBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var raw map[string]json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		if errors.Is(err, io.EOF) {
			return true
		}
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	if len(raw) != 0 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	return true
}

func validStoryActionID(value string) bool {
	return value != "" && value == strings.TrimSpace(value) && utf8.RuneCountInString(value) <= 128
}
