package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const maxPasswordRunes = 128

const maxCoreBodyBytes = 64 << 10

// CompanionStore is the G7/G8 owner-scoped persistence surface. The production
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

	CreateMemoryCandidate(ctx context.Context, owner int64, in postgres.MemoryCreate) (postgres.Memory, error)
	ListMemories(ctx context.Context, owner, relationshipID int64, includeDeleted bool) ([]postgres.Memory, error)
	GetMemory(ctx context.Context, owner, memoryID int64) (postgres.Memory, error)
	UpdateMemory(ctx context.Context, owner, memoryID int64, summary string, eventAt *time.Time, eventStatus *string, eventExpiresAt *time.Time) (postgres.Memory, error)
	DeleteMemory(ctx context.Context, owner, memoryID int64) (postgres.Memory, error)
	ConfirmMemory(ctx context.Context, owner, memoryID int64, supersede *int64) (postgres.Memory, error)
	RejectMemory(ctx context.Context, owner, memoryID int64) (postgres.Memory, error)
	ListMemoryEvidence(ctx context.Context, owner, memoryID int64) ([]postgres.MemoryEvidence, error)

	ListConsents(ctx context.Context, owner int64) ([]postgres.Consent, error)
	RecordConsent(ctx context.Context, owner int64, consentType, version string, granted bool) (postgres.Consent, error)
	GetIncognitoPref(ctx context.Context, owner int64) (bool, error)
	UpdateIncognitoPref(ctx context.Context, owner int64, defaultIncognito bool) (bool, error)
	OutboundCheck(ctx context.Context, owner int64) (postgres.OutboundDecision, error)

	CreateReport(ctx context.Context, owner int64, messageID *int64, reason, note string) (postgres.Report, error)
	ListReports(ctx context.Context, owner int64, after *int64, limit *int) ([]postgres.Report, error)

	CreateExport(ctx context.Context, owner int64, token string) (postgres.Export, error)
	GetExport(ctx context.Context, owner, exportID int64) (postgres.Export, error)
	ConsumeExport(ctx context.Context, owner, exportID int64, token string) (postgres.ExportDownload, error)
	CompleteExport(ctx context.Context, owner, exportID int64, payload string, expiresAt time.Time) error
	CompleteExportObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, expiresAt time.Time) error
	FailExportWithObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, errMsg string) error
	RecordExportUploadIntent(ctx context.Context, owner, exportID int64, objectKey string, leaseSeconds int) (int64, error)
	ListOwnerExportObjects(ctx context.Context, owner int64) ([]postgres.ExportObject, error)
	ClearExportObject(ctx context.Context, owner, exportID int64, objectKey string) error

	LookupIdentity(ctx context.Context, username string) (postgres.Identity, bool, error)
	RequestAccountDeletion(ctx context.Context, owner int64) error
	DeletionIntentActive(ctx context.Context, owner int64) (bool, error)
	DeleteAccount(ctx context.Context, owner int64) error
}

// BlobStore is the isolation object store for export envelopes. Production
// G8 leaves this nil; G10 wires approved export storage. Isolation tests
// use an in-memory fake that never reaches MinIO or a provider.
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte) error
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// Core is the G7/G8 command surface. companiond wires it only in full mode
// against an isolation or cutover database. api-migration never registers
// these routes (Phase 4 write hard-ban).
type Core struct {
	Store     CompanionStore
	JWT       *auth.Verifier
	Passwords *auth.Password
	Blobs     BlobStore
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

	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}/memories/candidates", s.handleCreateMemoryCandidate)
	s.mux.HandleFunc("GET /api/v1/relationships/{relationshipId}/memories", s.handleListMemories)
	s.mux.HandleFunc("GET /api/v1/memories/{memoryId}", s.handleGetMemory)
	s.mux.HandleFunc("PATCH /api/v1/memories/{memoryId}", s.handleUpdateMemory)
	s.mux.HandleFunc("DELETE /api/v1/memories/{memoryId}", s.handleDeleteMemory)
	s.mux.HandleFunc("POST /api/v1/memories/{memoryId}/confirm", s.handleConfirmMemory)
	s.mux.HandleFunc("POST /api/v1/memories/{memoryId}/reject", s.handleRejectMemory)
	s.mux.HandleFunc("GET /api/v1/memories/{memoryId}/evidence", s.handleListMemoryEvidence)

	s.mux.HandleFunc("GET /api/v1/incognito-pref", s.handleGetIncognitoPref)
	s.mux.HandleFunc("PUT /api/v1/incognito-pref", s.handleUpdateIncognitoPref)
	s.mux.HandleFunc("GET /api/v1/consents", s.handleListConsents)
	s.mux.HandleFunc("PUT /api/v1/consents", s.handleRecordConsent)

	s.mux.HandleFunc("POST /api/v1/reports", s.handleCreateReport)
	s.mux.HandleFunc("GET /api/v1/reports", s.handleListReports)

	s.mux.HandleFunc("POST /api/v1/exports", s.handleCreateExport)
	s.mux.HandleFunc("GET /api/v1/exports/{exportId}", s.handleGetExport)
	s.mux.HandleFunc("GET /api/v1/exports/{exportId}/download", s.handleDownloadExport)

	s.mux.HandleFunc("DELETE /api/v1/auth/account", s.handleDeleteAccount)
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
	case errors.Is(err, postgres.ErrConflict):
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
	case errors.Is(err, postgres.ErrOwnerContextRejected):
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
	default:
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
	}
}

func (s *Server) requireCurrentPassword(w http.ResponseWriter, r *http.Request, p *auth.Principal, raw string) bool {
	if p == nil || p.Username == "" {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return false
	}
	if raw == "" || utf8.RuneCountInString(raw) > maxPasswordRunes || len(raw) > maxPasswordRunes {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	if s.core.Passwords == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return false
	}
	ident, known, err := s.core.Store.LookupIdentity(r.Context(), p.Username)
	if err != nil {
		s.writeStoreErr(w, err)
		return false
	}
	matchKnown := known && ident.AccountID == p.AccountID && ident.Status == "ACTIVE"
	if !s.core.Passwords.MatchStored(raw, ident.PasswordHash, matchKnown) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return false
	}
	return true
}

func rfc3339(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339Nano)
}
