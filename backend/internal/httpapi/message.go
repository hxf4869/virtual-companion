package httpapi

import (
	"net/http"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type messageJSON struct {
	MessageID      int64  `json:"messageId"`
	ConversationID int64  `json:"conversationId"`
	Role           string `json:"role"`
	Content        string `json:"content"`
	CreatedAt      string `json:"createdAt"`
	NoMemory       bool   `json:"noMemory"`
}

func messageJSONFrom(m postgres.Message) messageJSON {
	return messageJSON{
		MessageID:      m.ID,
		ConversationID: m.ConversationID,
		Role:           m.Role,
		Content:        m.Content,
		CreatedAt:      rfc3339(m.CreatedAt),
		NoMemory:       m.NoMemory,
	}
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	conversationID, ok := parsePathID(r.PathValue("conversationId"))
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
	var afterPtr *int64
	var limitPtr *int
	if afterSet {
		afterPtr = &after
	}
	if limitSet {
		limitPtr = &limit
	}
	list, err := s.core.Store.ListMessages(r.Context(), p.AccountID, conversationID, afterPtr, limitPtr)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]messageJSON, 0, len(list))
	for _, m := range list {
		out = append(out, messageJSONFrom(m))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	conversationID, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	messageID, ok := parsePathID(r.PathValue("messageId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if err := s.core.Store.DeleteMessage(r.Context(), p.AccountID, conversationID, messageID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleSetMessageNoMemory(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	conversationID, ok := parsePathID(r.PathValue("conversationId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	messageID, ok := parsePathID(r.PathValue("messageId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var body struct {
		NoMemory *bool `json:"noMemory"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.NoMemory == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	msg, err := s.core.Store.SetMessageNoMemory(r.Context(), p.AccountID, conversationID, messageID, *body.NoMemory)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, messageJSONFrom(msg))
}
