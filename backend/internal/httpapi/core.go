package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const maxCoreBodyBytes = 64 << 10

// CompanionStore is the G7 owner-scoped persistence surface. The production
// implementation is *postgres.Store; tests may substitute a fake.
type CompanionStore interface {
	CreateRelationship(ctx context.Context, owner int64, personaRef string) (postgres.Relationship, error)
	ListRelationships(ctx context.Context, owner int64) ([]postgres.Relationship, error)
	ActivateRelationship(ctx context.Context, owner, id int64) (postgres.Relationship, error)
	DeactivateRelationship(ctx context.Context, owner, id int64) (postgres.Relationship, error)
	UpdateRelationshipPrefs(ctx context.Context, owner, id int64, prefs postgres.RelationshipPrefs) (postgres.Relationship, error)
	DeleteRelationship(ctx context.Context, owner, id int64, retainImportable bool) error
	CreateConversation(ctx context.Context, owner, relationshipID int64, incognito bool) (int64, error)
	ListConversations(ctx context.Context, owner int64, relationshipID, after *int64, limit *int) ([]postgres.Conversation, error)
	DeleteConversation(ctx context.Context, owner, id int64) error
	RenameConversation(ctx context.Context, owner, id int64, title string) error
	EndConversation(ctx context.Context, owner, id int64) (postgres.ConversationEnd, error)
	PreviewChatWipe(ctx context.Context, owner int64) (postgres.ChatWipePreview, error)
	WipeAllChats(ctx context.Context, owner int64) (postgres.ChatWipeResult, error)
	ListMessages(ctx context.Context, owner, conversationID int64, after *int64, limit *int) ([]postgres.Message, error)
	DeleteMessage(ctx context.Context, owner, conversationID, messageID int64) error
	SetMessageNoMemory(ctx context.Context, owner, conversationID, messageID int64, noMemory bool) (postgres.Message, error)
}

// Core is the G7 Relationship/Conversation/Message surface. companiond
// wires it only in full mode against an isolation or cutover database.
// api-migration never registers these routes (Phase 4 write hard-ban).
type Core struct {
	Store CompanionStore
	JWT   *auth.Verifier
}

func (s *Server) registerCore() {
	s.mux.HandleFunc("POST /api/v1/relationships", s.handleCreateRelationship)
	s.mux.HandleFunc("GET /api/v1/relationships", s.handleListRelationships)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}", s.handleActivateRelationship)
	s.mux.HandleFunc("PATCH /api/v1/relationships/{relationshipId}", s.handleUpdateRelationshipPrefs)
	s.mux.HandleFunc("DELETE /api/v1/relationships/{relationshipId}", s.handleDeleteRelationship)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}/deactivate", s.handleDeactivateRelationship)

	s.mux.HandleFunc("POST /api/v1/conversations", s.handleCreateConversation)
	s.mux.HandleFunc("GET /api/v1/conversations", s.handleListConversations)
	s.mux.HandleFunc("GET /api/v1/conversations/wipe-preview", s.handlePreviewChatWipe)
	s.mux.HandleFunc("POST /api/v1/conversations/wipe", s.handleWipeAllChats)
	s.mux.HandleFunc("DELETE /api/v1/conversations/{conversationId}", s.handleDeleteConversation)
	s.mux.HandleFunc("PATCH /api/v1/conversations/{conversationId}", s.handleRenameConversation)
	s.mux.HandleFunc("POST /api/v1/conversations/{conversationId}/end", s.handleEndConversation)

	s.mux.HandleFunc("GET /api/v1/conversations/{conversationId}/messages", s.handleListMessages)
	s.mux.HandleFunc("DELETE /api/v1/conversations/{conversationId}/messages/{messageId}", s.handleDeleteMessage)
	s.mux.HandleFunc("PATCH /api/v1/conversations/{conversationId}/messages/{messageId}", s.handleSetMessageNoMemory)
}

func (s *Server) corePrincipal(w http.ResponseWriter, r *http.Request, write bool) *auth.Principal {
	if write {
		s.metrics.ObserveCoreWrite()
		if !apiOriginAllowed(r.Header.Get("Origin"), s.cfg.HTTP.AllowedOrigins) {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "origin rejected")
			return nil
		}
		if hasSessionCookie(r) && !csrfMatches(r) {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "csrf rejected")
			return nil
		}
	}
	if s.core == nil || s.core.JWT == nil {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return nil
	}
	p := s.core.JWT.VerifyAccessToken(bearerToken(r))
	if p == nil || p.AccountID <= 0 {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return nil
	}
	return p
}

func (s *Server) decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxCoreBodyBytes)
	dec := json.NewDecoder(r.Body)
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

func (s *Server) writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) writeStoreErr(w http.ResponseWriter, err error) {
	switch {
	case err == nil:
		return
	case errors.Is(err, postgres.ErrNotFound):
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
	case errors.Is(err, postgres.ErrInvalid):
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	default:
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
	}
}

func rfc3339(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
