package httpapi

import (
	"net/http"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type conversationListJSON struct {
	ConversationID     int64   `json:"conversationId"`
	RelationshipID     int64   `json:"relationshipId"`
	LastMessageRole    *string `json:"lastMessageRole,omitempty"`
	LastMessagePreview *string `json:"lastMessagePreview,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	Title              *string `json:"title,omitempty"`
	Incognito          bool    `json:"incognito"`
}

func (s *Server) handleCreateConversation(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		RelationshipID wireID `json:"relationshipId"`
		Incognito      *bool  `json:"incognito"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if !body.RelationshipID.Set {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	incognito := body.Incognito != nil && *body.Incognito
	id, err := s.core.Store.CreateConversation(r.Context(), p.AccountID, body.RelationshipID.V, incognito)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]int64{"conversationId": id})
}

func (s *Server) handleListConversations(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	rel, relSet, ok := parseOptionalID(r.URL.Query().Get("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
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
	var relPtr, afterPtr *int64
	var limitPtr *int
	if relSet {
		relPtr = &rel
	}
	if afterSet {
		afterPtr = &after
	}
	if limitSet {
		limitPtr = &limit
	}
	list, err := s.core.Store.ListConversations(r.Context(), p.AccountID, relPtr, afterPtr, limitPtr)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]conversationListJSON, 0, len(list))
	for _, c := range list {
		out = append(out, conversationJSONFrom(c))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func conversationJSONFrom(c postgres.Conversation) conversationListJSON {
	return conversationListJSON{
		ConversationID:     c.ID,
		RelationshipID:     c.RelationshipID,
		LastMessageRole:    c.LastMessageRole,
		LastMessagePreview: c.LastMessagePreview,
		CreatedAt:          rfc3339(c.CreatedAt),
		Title:              c.Title,
		Incognito:          c.Incognito,
	}
}

func (s *Server) handleDeleteConversation(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if err := s.core.Store.DeleteConversation(r.Context(), p.AccountID, id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRenameConversation(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		Title *string `json:"title"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	title := ""
	if body.Title != nil {
		title = *body.Title
	}
	if utf8.RuneCountInString(title) > 200 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if err := s.core.Store.RenameConversation(r.Context(), p.AccountID, id, title); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"conversationId": id, "title": body.Title})
}

func (s *Server) handleEndConversation(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	end, err := s.core.Store.EndConversation(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": end.OK, "incognitoCleared": end.IncognitoCleared})
}

func (s *Server) handlePreviewChatWipe(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	preview, err := s.core.Store.PreviewChatWipe(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]int64{
		"conversationCount": preview.ConversationCount,
		"messageCount":      preview.MessageCount,
		"inFlightCount":     preview.InFlightCount,
	})
}

func (s *Server) handleWipeAllChats(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	result, err := s.core.Store.WipeAllChats(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]int64{
		"conversationsDeleted": result.ConversationsDeleted,
		"messagesDeleted":      result.MessagesDeleted,
		"workItemsCancelled":   result.WorkItemsCancelled,
	})
}
