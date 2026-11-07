package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/restoregate"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type storedChatReader interface {
	ListStoredChats(context.Context, int64, postgres.ChatListQuery) (postgres.StoredChatPage, error)
	GetStoredChat(context.Context, int64, string) (postgres.StoredChat, error)
	ListStoredMessages(context.Context, int64, string, postgres.ChatMessageQuery) (postgres.StoredMessagePage, error)
	GetStoredMessage(context.Context, int64, string, string) (postgres.StoredMessage, error)
	ListStoredChatChanges(context.Context, int64, string, int64, int) (postgres.ChatChangesPage, error)
}

func (s *Server) registerStoredChatReads() {
	s.mux.HandleFunc("GET /api/v1/chats", s.handleListStoredChats)
	s.mux.HandleFunc("GET /api/v1/chats/{chatId}", s.handleGetStoredChat)
	s.mux.HandleFunc("GET /api/v1/chats/{chatId}/messages", s.handleListStoredMessages)
	s.mux.HandleFunc("GET /api/v1/chats/{chatId}/messages/{messageId}", s.handleGetStoredMessage)
	s.mux.HandleFunc("GET /api/v1/chats/{chatId}/changes", s.handleListStoredChatChanges)
}

func (s *Server) storedChatRead(w http.ResponseWriter, r *http.Request) (storedChatReader, int64) {
	p := s.corePrincipalWithUnavailableCode(w, r, false, "SCHEMA_UNAVAILABLE")
	if p == nil {
		return nil, 0
	}
	store, ok := s.core.Store.(storedChatReader)
	if !ok || restoregate.Closed(s.cfg.RestoreGateFile) {
		s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
		return nil, 0
	}
	return store, p.AccountID
}

func (s *Server) handleListStoredChats(w http.ResponseWriter, r *http.Request) {
	store, owner := s.storedChatRead(w, r)
	if store == nil {
		return
	}
	query, limit, ok := storedChatPageParams(r.URL.RawQuery)
	cursor := query.Get("cursor")
	if !ok || (query.Has("cursor") && cursor == "") {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	in := postgres.ChatListQuery{
		Cursor: cursor, CharacterRef: query.Get("characterRef"), Q: strings.TrimSpace(query.Get("q")), Limit: limit,
	}
	if query.Has("relationshipId") {
		relationshipID, ok := parseChatDecimal(query.Get("relationshipId"))
		if !ok || relationshipID == 0 {
			s.writeStoreErr(w, postgres.ErrInvalid)
			return
		}
		in.RelationshipID = &relationshipID
	}
	page, err := store.ListStoredChats(r.Context(), owner, in)
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	if page.Items == nil {
		page.Items = []postgres.StoredChatSummary{}
	}
	s.writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleGetStoredChat(w http.ResponseWriter, r *http.Request) {
	store, owner := s.storedChatRead(w, r)
	if store == nil {
		return
	}
	chatID := strings.ToLower(r.PathValue("chatId"))
	if !stsource.ValidIdentity(chatID) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	chat, err := store.GetStoredChat(r.Context(), owner, chatID)
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, chat)
}

func (s *Server) handleListStoredMessages(w http.ResponseWriter, r *http.Request) {
	store, owner := s.storedChatRead(w, r)
	if store == nil {
		return
	}
	chatID := strings.ToLower(r.PathValue("chatId"))
	query, limit, ok := storedChatPageParams(r.URL.RawQuery)
	if !ok || !stsource.ValidIdentity(chatID) || !utf8.ValidString(query.Get("q")) || utf8.RuneCountInString(query.Get("q")) > 200 {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	in := postgres.ChatMessageQuery{
		Before: query.Get("before"), After: query.Get("after"), AnchorMessageID: strings.ToLower(query.Get("anchorMessageId")),
		View: query.Get("view"), IncludeChat: query.Has("include"), Q: strings.TrimSpace(query.Get("q")), Limit: limit,
	}
	if !query.Has("view") {
		in.View = "display"
	}
	if (in.View != "display" && in.View != "full") || (in.IncludeChat && query.Get("include") != "chat") {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	directions := 0
	for _, key := range []string{"before", "after", "anchorMessageId"} {
		if query.Has(key) {
			directions++
			if query.Get(key) == "" {
				s.writeStoreErr(w, postgres.ErrInvalid)
				return
			}
		}
	}
	if directions > 1 || (in.AnchorMessageID != "" && !stsource.ValidIdentity(in.AnchorMessageID)) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	page, err := store.ListStoredMessages(r.Context(), owner, chatID, in)
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	if page.Items == nil {
		page.Items = []postgres.StoredMessage{}
	}
	s.writeJSON(w, http.StatusOK, page)
}

func (s *Server) handleGetStoredMessage(w http.ResponseWriter, r *http.Request) {
	store, owner := s.storedChatRead(w, r)
	if store == nil {
		return
	}
	chatID := strings.ToLower(r.PathValue("chatId"))
	messageID := strings.ToLower(r.PathValue("messageId"))
	if !stsource.ValidIdentity(chatID) || !stsource.ValidIdentity(messageID) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	message, err := store.GetStoredMessage(r.Context(), owner, chatID, messageID)
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, message)
}

func (s *Server) handleListStoredChatChanges(w http.ResponseWriter, r *http.Request) {
	store, owner := s.storedChatRead(w, r)
	if store == nil {
		return
	}
	chatID := strings.ToLower(r.PathValue("chatId"))
	query, limit, ok := storedChatPageParams(r.URL.RawQuery)
	afterRevision, validRevision := parseChatDecimal(query.Get("afterRevision"))
	if !ok || !validRevision || !stsource.ValidIdentity(chatID) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	page, err := store.ListStoredChatChanges(r.Context(), owner, chatID, afterRevision, limit)
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	if page.Items == nil {
		page.Items = []postgres.ChatChange{}
	}
	s.writeJSON(w, http.StatusOK, page)
}

func storedChatPageParams(raw string) (url.Values, int, bool) {
	query, err := url.ParseQuery(raw)
	if err != nil {
		return nil, 0, false
	}
	for _, values := range query {
		if len(values) != 1 {
			return nil, 0, false
		}
	}
	if !query.Has("limit") {
		return query, 50, true
	}
	limit, err := strconv.ParseUint(query.Get("limit"), 10, 32)
	return query, int(limit), err == nil && limit >= 1 && limit <= 200
}

func parseChatDecimal(raw string) (int64, bool) {
	if raw == "" || (len(raw) > 1 && raw[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(raw, 10, 63)
	return int64(n), err == nil
}

func (s *Server) writeStoredChatError(w http.ResponseWriter, err error) {
	var chatErr *postgres.ChatError
	if errors.As(err, &chatErr) {
		switch chatErr.Code {
		case "RATE_LIMITED":
			w.Header().Set("Retry-After", "2")
			s.writeAPIError(w, http.StatusTooManyRequests, chatErr.Code, "rate limited")
			return
		case "CHAT_TRANSFER_TIMEOUT":
			w.Header().Set("Retry-After", "1")
			s.writeAPIError(w, http.StatusServiceUnavailable, chatErr.Code, "chat transfer timed out")
			return
		case "CHAT_IMPORT_EXPIRED":
			s.writeAPIError(w, http.StatusGone, chatErr.Code, "chat import expired")
			return
		case "CHAT_SEARCH_TIMEOUT":
			s.writeAPIError(w, http.StatusServiceUnavailable, "CHAT_SEARCH_TIMEOUT", "chat search timed out; retry this cursor")
			return
		case "CHAT_CURSOR_EXPIRED":
			s.writeAPIError(w, http.StatusGone, "CHAT_CURSOR_EXPIRED", "chat cursor expired")
			return
		case "CHAT_CHANGES_EXPIRED":
			s.writeAPIError(w, http.StatusGone, "CHAT_CHANGES_EXPIRED", "chat changes expired")
			return
		case "CHAT_AUTHORITY_CHANGED":
			s.writeAPIError(w, http.StatusConflict, "CHAT_AUTHORITY_CHANGED", "chat authority changed")
			return
		case "REVISION_CONFLICT", "IDEMPOTENCY_KEY_REUSED", "CHAT_ID_REUSED", "CHAT_GENERATION_FENCED":
			s.writeAPIError(w, http.StatusConflict, chatErr.Code, "chat write conflict")
			return
		case "OPERATION_RESULT_EXPIRED":
			s.writeAPIError(w, http.StatusGone, chatErr.Code, "operation result expired")
			return
		case "CHAT_PAYLOAD_TOO_LARGE":
			s.writeAPIError(w, http.StatusRequestEntityTooLarge, chatErr.Code, "chat payload too large")
			return
		case "CHAT_INVALID_OPERATION", "CHAT_IMPORT_INVALID":
			s.writeAPIError(w, http.StatusUnprocessableEntity, chatErr.Code, "invalid chat operation")
			return
		case "CHAT_PRECONDITION_REQUIRED":
			s.writeAPIError(w, http.StatusPreconditionRequired, chatErr.Code, "chat precondition required")
			return
		}
	} else if errors.Is(err, postgres.ErrInvalid) || errors.Is(err, postgres.ErrNotFound) ||
		errors.Is(err, postgres.ErrConflict) || errors.Is(err, postgres.ErrRateLimited) ||
		errors.Is(err, postgres.ErrOwnerContextRejected) {
		s.writeStoreErr(w, err)
		return
	}
	s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
}
