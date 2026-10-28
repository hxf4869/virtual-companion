package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type stBindingJSON struct {
	RelationshipID string `json:"relationshipId"`
	ConversationID string `json:"conversationId"`
	ChatIdentity   string `json:"chatIdentity"`
	CharacterRef   string `json:"characterRef"`
	Mode           string `json:"mode"`
}

func (s *Server) handleResolveSTBinding(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		ChatIdentity   string  `json:"chatIdentity"`
		CharacterRef   string  `json:"characterRef"`
		Mode           string  `json:"mode"`
		RelationshipID *string `json:"relationshipId"`
		DisplayName    string  `json:"displayName"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.ChatIdentity) == "" || strings.TrimSpace(body.CharacterRef) == "" ||
		(body.Mode != "COMPANION" && body.Mode != "STORY") || utf8.RuneCountInString(body.DisplayName) > 32 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid binding")
		return
	}
	var relationshipID *int64
	if body.RelationshipID != nil {
		id, ok := parsePathID(*body.RelationshipID)
		if !ok || idString(id) != *body.RelationshipID {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid binding")
			return
		}
		relationshipID = &id
	}
	binding, err := s.core.Store.ResolveSTBinding(r.Context(), p.AccountID, postgres.STBindingInput{
		ChatIdentity: body.ChatIdentity, CharacterRef: body.CharacterRef, Mode: body.Mode,
		RelationshipID: relationshipID, DisplayName: body.DisplayName,
	})
	if errors.Is(err, postgres.ErrConflict) {
		// Keep the legacy error mapping for other endpoints unchanged.
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "binding conflict")
		return
	}
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, stBindingJSON{
		RelationshipID: idString(binding.RelationshipID), ConversationID: idString(binding.ConversationID),
		ChatIdentity: binding.ChatIdentity, CharacterRef: binding.CharacterRef, Mode: binding.Mode,
	})
}
