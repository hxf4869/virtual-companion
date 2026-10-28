package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type storyWorldStore interface {
	StartStoryRun(context.Context, int64, int64, string) (postgres.StoryRun, error)
	LoadStoryActor(context.Context, int64, int64, int64, string, int64) (postgres.StoryActorFacts, error)
}

type storyRunResponse struct {
	ConversationID string                     `json:"conversationId"`
	RunID          string                     `json:"runId"`
	BranchID       string                     `json:"branchId"`
	CaseID         string                     `json:"caseId"`
	WorldVersion   int64                      `json:"worldVersion"`
	Stage          string                     `json:"stage"`
	Participants   []storyParticipantResponse `json:"participants"`
}

type storyParticipantResponse struct {
	ActorID string `json:"actorId"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Scene   string `json:"scene"`
}

func (s *Server) handleStartStoryRun(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, true)
	if principal == nil {
		return
	}
	var body struct {
		ConversationID string `json:"conversationId"`
		CaseID         string `json:"caseId"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	conversationID, ok := parsePathID(body.ConversationID)
	if !ok || idString(conversationID) != body.ConversationID || body.CaseID == "" || len(body.CaseID) > 64 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.core.Store.(storyWorldStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	run, err := store.StartStoryRun(r.Context(), principal.AccountID, conversationID, body.CaseID)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	participants := make([]storyParticipantResponse, 0, len(run.Participants))
	for _, participant := range run.Participants {
		participants = append(participants, storyParticipantResponse{
			ActorID: participant.ActorID, Name: participant.Name, Role: participant.Role, Scene: participant.Scene,
		})
	}
	s.writeJSON(w, http.StatusOK, storyRunResponse{
		ConversationID: idString(run.ConversationID), RunID: idString(run.RunID), BranchID: idString(run.BranchID),
		CaseID: run.CaseID, WorldVersion: run.WorldVersion, Stage: run.Stage, Participants: participants,
	})
}

func (s *Server) handleStoryActorView(w http.ResponseWriter, r *http.Request) {
	principal := s.corePrincipal(w, r, false)
	if principal == nil {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	branchID, branchOK := parsePathID(r.URL.Query().Get("branchId"))
	worldVersion, versionOK := parseWorldVersion(r.URL.Query().Get("worldVersion"))
	actorID := r.PathValue("actorId")
	if !runOK || !branchOK || !versionOK || !validActorID(actorID) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.core.Store.(storyWorldStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	facts, err := store.LoadStoryActor(r.Context(), principal.AccountID, runID, branchID, actorID, worldVersion)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	if facts.ActorID != actorID || facts.RunID != runID || facts.BranchID != branchID || facts.WorldVersion != worldVersion {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	view, err := story.ActorView(facts.CaseID, story.Scope{
		ConversationID: facts.ConversationID, RunID: facts.RunID, BranchID: facts.BranchID,
		ActorID: facts.ActorID, WorldVersion: facts.WorldVersion,
	}, facts.Events)
	if errors.Is(err, story.ErrUnknownActor) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	s.writeJSON(w, http.StatusOK, view)
}

type storyOutboundRequest struct {
	OwnerAccountID        string   `json:"ownerAccountId"`
	BranchID              string   `json:"branchId"`
	WorldVersion          *int64   `json:"worldVersion"`
	ChatIdentity          string   `json:"chatIdentity"`
	Protocol              string   `json:"protocol"`
	Messages              []string `json:"messages"`
	System                []string `json:"system"`
	Instructions          []string `json:"instructions"`
	ToolDefinitions       []string `json:"toolDefinitions"`
	ToolResults           []string `json:"toolResults"`
	HasPreviousResponseID *bool    `json:"hasPreviousResponseId"`
	HasConversation       *bool    `json:"hasConversation"`
}

type storyOutboundPass struct {
	Passed bool `json:"passed"`
}

// handleStoryOutboundCheck is the service-token second line for one actor.
// The handler does not log the body, a matched fact, or a marker.
func (s *Server) handleStoryOutboundCheck(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	runID, runOK := parsePathID(r.PathValue("runId"))
	actorID := r.PathValue("actorId")
	var body storyOutboundRequest
	if !s.decodeStrictJSON(w, r, &body) {
		return
	}
	branchID, branchOK := parsePathID(body.BranchID)
	ownerID, ownerOK := parsePathID(body.OwnerAccountID)
	if !runOK || !branchOK || !ownerOK || !validActorID(actorID) || !validOutboundProtocol(body.Protocol) ||
		!stsource.ValidIdentity(body.ChatIdentity) || idString(branchID) != body.BranchID || idString(ownerID) != body.OwnerAccountID ||
		body.WorldVersion == nil || *body.WorldVersion < 0 || body.HasPreviousResponseID == nil || body.HasConversation == nil ||
		body.Messages == nil || body.System == nil || body.Instructions == nil || body.ToolDefinitions == nil || body.ToolResults == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	store, ok := s.core.Store.(storyWorldStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "story world is unavailable")
		return
	}
	facts, err := store.LoadStoryActor(r.Context(), ownerID, runID, branchID, actorID, *body.WorldVersion)
	if err != nil {
		s.writeStoryErr(w, err)
		return
	}
	if facts.ActorID != actorID || facts.RunID != runID || facts.ConversationID <= 0 {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if facts.BranchID != branchID || facts.WorldVersion != *body.WorldVersion {
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "story world conflict")
		return
	}
	// 局已装入但会话身份对不上：与世界版本冲突同一类，409，不回显任何身份。
	// 会话不是 STORY 或身份为空时，store 返回 ErrNotFound，上面已经写成 404。
	if facts.ChatIdentity == "" {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if facts.ChatIdentity != body.ChatIdentity {
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "story world conflict")
		return
	}
	texts := make([]string, 0, len(body.Messages)+len(body.System)+len(body.Instructions)+len(body.ToolDefinitions)+len(body.ToolResults))
	texts = append(texts, body.Messages...)
	texts = append(texts, body.System...)
	texts = append(texts, body.Instructions...)
	texts = append(texts, body.ToolDefinitions...)
	texts = append(texts, body.ToolResults...)
	err = story.CheckOutbound(facts.CaseID, facts.ActorID, texts, *body.HasPreviousResponseID || *body.HasConversation)
	if errors.Is(err, story.ErrOutboundRejected) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "story outbound rejected")
		return
	}
	if errors.Is(err, story.ErrUnknownActor) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	s.writeJSON(w, http.StatusOK, storyOutboundPass{Passed: true})
}

func (s *Server) decodeStrictJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxCoreBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
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

func validOutboundProtocol(protocol string) bool {
	switch protocol {
	case "OPENAI_CHAT_COMPLETIONS", "OPENAI_RESPONSES", "ANTHROPIC_MESSAGES":
		return true
	default:
		return false
	}
}

func (s *Server) writeStoryErr(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrStoryWorldVersion) || errors.Is(err, postgres.ErrConflict) {
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "story world conflict")
		return
	}
	s.writeStoreErr(w, err)
}

func parseWorldVersion(raw string) (int64, bool) {
	if raw == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n < 0 || strconv.FormatInt(n, 10) != raw {
		return 0, false
	}
	return n, true
}

func validActorID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	first := id[0]
	if first < 'a' || first > 'z' {
		return false
	}
	for i := 1; i < len(id); i++ {
		c := id[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' && c != '-' {
			return false
		}
	}
	return true
}
