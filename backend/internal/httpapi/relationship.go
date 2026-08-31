package httpapi

import (
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type relationshipJSON struct {
	RelationshipID   int64    `json:"relationshipId"`
	PersonaRef       string   `json:"personaRef"`
	Active           bool     `json:"active"`
	CreatedAt        string   `json:"createdAt"`
	CompanionName    *string  `json:"companionName"`
	UserAddressAs    *string  `json:"userAddressAs"`
	ReplyLength      string   `json:"replyLength"`
	Initiative       string   `json:"initiative"`
	Humor            string   `json:"humor"`
	AdvicePref       string   `json:"advicePref"`
	RemindersAllowed bool     `json:"remindersAllowed"`
	MemoryShareScope string   `json:"memoryShareScope"`
	AvoidTopics      []string `json:"avoidTopics"`
	Gender           string   `json:"gender"`
	AvatarRef        string   `json:"avatarRef"`
}

func relationshipJSONFrom(rel postgres.Relationship) relationshipJSON {
	topics := rel.AvoidTopics
	if topics == nil {
		topics = []string{}
	}
	return relationshipJSON{
		RelationshipID:   rel.ID,
		PersonaRef:       rel.PersonaRef,
		Active:           rel.Active,
		CreatedAt:        rfc3339(rel.CreatedAt),
		CompanionName:    rel.CompanionName,
		UserAddressAs:    rel.UserAddressAs,
		ReplyLength:      rel.ReplyLength,
		Initiative:       rel.Initiative,
		Humor:            rel.Humor,
		AdvicePref:       rel.AdvicePref,
		RemindersAllowed: rel.RemindersAllowed,
		MemoryShareScope: rel.MemoryShareScope,
		AvoidTopics:      topics,
		Gender:           rel.Gender,
		AvatarRef:        rel.AvatarRef,
	}
}

func (s *Server) handleCreateRelationship(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		PersonaRef string `json:"personaRef"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	persona := strings.TrimSpace(body.PersonaRef)
	if persona == "" || !knownPersona(persona) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "personaRef is not a known persona template")
		return
	}
	rel, err := s.core.Store.CreateRelationship(r.Context(), p.AccountID, persona)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, relationshipJSONFrom(rel))
}

func (s *Server) handleListRelationships(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	list, err := s.core.Store.ListRelationships(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]relationshipJSON, 0, len(list))
	for _, rel := range list {
		out = append(out, relationshipJSONFrom(rel))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleActivateRelationship(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rel, err := s.core.Store.ActivateRelationship(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, relationshipJSONFrom(rel))
}

func (s *Server) handleDeactivateRelationship(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rel, err := s.core.Store.DeactivateRelationship(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, relationshipJSONFrom(rel))
}

func (s *Server) handleDeleteRelationship(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	retain, ok := parseRetain(r.URL.Query().Get("retainImportable"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if err := s.core.Store.DeleteRelationship(r.Context(), p.AccountID, id, retain); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handlePreviewRelationshipClearance(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	preview, err := s.core.Store.PreviewRelationshipClearance(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]int64{
		"relationshipId":    preview.RelationshipID,
		"conversationCount": preview.ConversationCount,
		"memoryCount":       preview.MemoryCount,
		"reminderCount":     preview.ReminderCount,
	})
}

func (s *Server) handleResetRelationship(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	retain, ok := parseRetain(r.URL.Query().Get("retainImportable"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rel, err := s.core.Store.ResetRelationship(r.Context(), p.AccountID, id, retain)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, relationshipJSONFrom(rel))
}

func (s *Server) handleUpdateRelationshipPrefs(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		CompanionName    *string  `json:"companionName"`
		UserAddressAs    *string  `json:"userAddressAs"`
		ReplyLength      string   `json:"replyLength"`
		Initiative       string   `json:"initiative"`
		Humor            string   `json:"humor"`
		AdvicePref       string   `json:"advicePref"`
		RemindersAllowed *bool    `json:"remindersAllowed"`
		MemoryShareScope string   `json:"memoryShareScope"`
		AvoidTopics      []string `json:"avoidTopics"`
		Gender           string   `json:"gender"`
		AvatarRef        string   `json:"avatarRef"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	prefs, ok := prefsFromBody(body.CompanionName, body.UserAddressAs, body.ReplyLength, body.Initiative,
		body.Humor, body.AdvicePref, body.RemindersAllowed, body.MemoryShareScope, body.AvoidTopics,
		body.Gender, body.AvatarRef)
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rel, err := s.core.Store.UpdateRelationshipPrefs(r.Context(), p.AccountID, id, prefs)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, relationshipJSONFrom(rel))
}

func prefsFromBody(
	companionName, userAddressAs *string,
	replyLength, initiative, humor, advicePref string,
	remindersAllowed *bool,
	memoryShareScope string,
	avoidTopics []string,
	gender, avatarRef string,
) (postgres.RelationshipPrefs, bool) {
	if remindersAllowed == nil {
		return postgres.RelationshipPrefs{}, false
	}
	if avoidTopics == nil {
		return postgres.RelationshipPrefs{}, false
	}
	if !catalogHas(knownReplyLength, replyLength) ||
		!catalogHas(knownInitiative, initiative) ||
		!catalogHas(knownHumor, humor) ||
		!catalogHas(knownAdvice, advicePref) ||
		!catalogHas(knownMemoryShare, memoryShareScope) ||
		!catalogHas(knownGender, gender) ||
		!catalogHas(knownAvatar, avatarRef) {
		return postgres.RelationshipPrefs{}, false
	}
	seen := map[string]struct{}{}
	avoid := make([]string, 0, len(avoidTopics))
	for _, code := range avoidTopics {
		if !catalogHas(knownAvoid, code) {
			return postgres.RelationshipPrefs{}, false
		}
		if _, dup := seen[code]; dup {
			continue
		}
		seen[code] = struct{}{}
		avoid = append(avoid, code)
	}
	var namePtr, addrPtr *string
	if companionName != nil {
		name, ok := sanitizeLabel(*companionName)
		if !ok {
			return postgres.RelationshipPrefs{}, false
		}
		if name != "" {
			namePtr = &name
		}
	}
	if userAddressAs != nil {
		addr, ok := sanitizeLabel(*userAddressAs)
		if !ok {
			return postgres.RelationshipPrefs{}, false
		}
		if addr != "" {
			addrPtr = &addr
		}
	}
	return postgres.RelationshipPrefs{
		CompanionName:    namePtr,
		UserAddressAs:    addrPtr,
		ReplyLength:      replyLength,
		Initiative:       initiative,
		Humor:            humor,
		AdvicePref:       advicePref,
		RemindersAllowed: *remindersAllowed,
		MemoryShareScope: memoryShareScope,
		AvoidTopics:      avoid,
		Gender:           gender,
		AvatarRef:        avatarRef,
	}, true
}

func parseRetain(raw string) (bool, bool) {
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
