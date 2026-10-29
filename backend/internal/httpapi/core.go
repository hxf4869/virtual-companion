package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/jobs"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const maxPasswordRunes = 128

const maxCoreBodyBytes = 64 << 10

// expectedAccountHeader carries the account id the page believes it is acting
// for (auth.accountId as a decimal string). It is a precondition only: the
// principal, roles, RLS and current-password checks keep using the cookie
// principal as the sole authority; the header never selects an owner.
const expectedAccountHeader = "X-VC-Expected-Account-ID"

// expectedSessionHeader carries the opaque session id (decimal string of the
// existing identity_opaque_session id) the page committed to when it received
// or renewed its identity. Like the account header it is a precondition only:
// the cookie session remains the sole authority. A same-account relogin in the
// shared cookie jar installs a newer session, so a page still committed to the
// previous session id must not run effects with the newer cookie.
const expectedSessionHeader = "X-VC-Expected-Session-ID"

// CompanionStore is the G7/G8 owner-scoped persistence surface. The production
// implementation is *postgres.Store; tests may substitute a fake.
type CompanionStore interface {
	ResolveSTBinding(ctx context.Context, owner int64, input postgres.STBindingInput) (postgres.STBinding, error)
	ReconcileSTSources(ctx context.Context, owner int64, chats []string) ([]postgres.STSourceState, error)
	CreateRelationship(ctx context.Context, owner int64, personaRef string) (postgres.Relationship, error)
	ListRelationships(ctx context.Context, owner int64) ([]postgres.Relationship, error)
	ActivateRelationship(ctx context.Context, owner, id int64) (postgres.Relationship, error)
	DeactivateRelationship(ctx context.Context, owner, id int64) (postgres.Relationship, error)
	UpdateRelationshipPrefs(ctx context.Context, owner, id int64, prefs postgres.RelationshipPrefs) (postgres.Relationship, error)
	PreviewRelationshipClearance(ctx context.Context, owner, id int64) (postgres.RelationshipClearancePreview, error)
	ResetRelationship(ctx context.Context, owner, id int64, retainImportable bool) (postgres.Relationship, error)
	DeleteRelationship(ctx context.Context, owner, id int64, retainImportable bool) error
	CreateConversation(ctx context.Context, owner, relationshipID int64, incognito bool) (int64, error)
	ListConversations(ctx context.Context, owner int64, relationshipID, after *int64, limit *int) ([]postgres.Conversation, error)
	DeleteConversation(ctx context.Context, owner, id int64) error
	RenameConversation(ctx context.Context, owner, id int64, title string) error
	EndConversation(ctx context.Context, owner, id int64) (postgres.ConversationEnd, error)
	PreviewChatWipe(ctx context.Context, owner int64) (postgres.ChatWipePreview, error)
	WipeAllChats(ctx context.Context, owner int64) (postgres.ChatWipeResult, error)
	ListMessages(ctx context.Context, owner, conversationID int64, after *int64, limit *int) ([]postgres.Message, error)
	ListRecentMessages(ctx context.Context, owner, conversationID int64, before *int64, limit int) ([]postgres.Message, error)
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
	GetAgeState(ctx context.Context, owner int64) (postgres.AgeState, error)
	VerifyAge(ctx context.Context, owner int64) (postgres.AgeState, error)

	CreateReport(ctx context.Context, owner int64, messageID *int64, reason, note string) (postgres.Report, error)
	ListReports(ctx context.Context, owner int64, after *int64, limit *int) ([]postgres.Report, error)

	CreateExport(ctx context.Context, owner int64, token string) (postgres.Export, error)
	GetExport(ctx context.Context, owner, exportID int64) (postgres.Export, error)
	ConsumeExport(ctx context.Context, owner, exportID int64, token string) (postgres.ExportDownload, error)
	RecoverExport(ctx context.Context, owner int64, token string) (postgres.Export, error)
	CompleteExport(ctx context.Context, owner, exportID int64, payload string, expiresAt time.Time) error
	CompleteExportObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, expiresAt time.Time) error
	FailExportWithObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, errMsg string) error
	RecordExportUploadIntent(ctx context.Context, owner, exportID int64, objectKey string, leaseSeconds int) (int64, error)
	ListOwnerExportObjects(ctx context.Context, owner int64) ([]postgres.ExportObject, error)
	ClearExportObject(ctx context.Context, owner, exportID int64, objectKey string) error

	LookupIdentity(ctx context.Context, username string) (postgres.Identity, bool, error)
	RequestAccountDeletion(ctx context.Context, owner int64) error
	RecordAccountDeletionCancelSignals(ctx context.Context, owner int64, count int) error
	DeletionIntentActive(ctx context.Context, owner int64) (bool, error)
	DeleteAccount(ctx context.Context, owner int64) error
	ClearSTAccountData(ctx context.Context, owner int64) (bool, error)
	ClearMemoryCoreAccountData(ctx context.Context, owner int64) (bool, error)
	RegisterSTProfile(ctx context.Context, owner int64, handle string) error

	IssueOpaqueSession(ctx context.Context, accountID int64, tokenHash string, expires time.Time) (int64, error)
	LookupOpaqueSession(ctx context.Context, tokenHash string) (*auth.Principal, error)
	ListOpaqueSessions(ctx context.Context, accountID int64) ([]postgres.OpaqueSession, error)
	RevokeOpaqueSession(ctx context.Context, accountID, sessionID int64) error
	RevokeOpaqueSessionHash(ctx context.Context, tokenHash string) error
	RevokeAllOpaqueSessions(ctx context.Context, accountID int64) (int, error)
	RecordOpaqueReauth(ctx context.Context, accountID, sessionID int64) error
	ChangePasswordHash(ctx context.Context, accountID int64, passwordHash string) error
}

// BlobStore is the HTTP read/delete surface of the configured export object
// store. Isolation tests use an in-memory fake that never reaches MinIO.
type BlobStore interface {
	Get(ctx context.Context, key string) ([]byte, error)
	Delete(ctx context.Context, key string) error
}

// GenerationAPI is the G10 send/cancel/snapshot/feedback surface.
type GenerationAPI interface {
	StartTurn(ctx context.Context, owner int64, in postgres.StartTurn) (postgres.GenerationView, error)
	CancelTurn(ctx context.Context, owner, generationID int64) (postgres.GenerationView, error)
	GenerationSnapshot(ctx context.Context, owner, generationID int64) (postgres.GenerationSnapshot, error)
	RecordGenerationFeedback(ctx context.Context, owner, generationID int64, kind, note string) (postgres.GenerationFeedback, error)
}

// ProviderAdminStore is the small platform-level configuration surface used by
// ADMIN, plus the service-channel resolution the SillyTavern server plugin
// uses. It stays separate from CompanionStore because it is not owner data.
type ProviderAdminStore interface {
	ListProviderConfigs(ctx context.Context, actingAccountID int64) ([]postgres.ProviderConfig, error)
	GetProviderCredential(ctx context.Context, actingAccountID int64, providerID string) (string, error)
	SaveProviderConfig(ctx context.Context, actingAccountID int64, in postgres.SaveProvider) (int64, error)
	ReorderProviderModels(ctx context.Context, actingAccountID int64, order []postgres.RouteRef) error
	ListPurposeBindings(ctx context.Context, actingAccountID int64) ([]postgres.PurposeBinding, error)
	SavePurposeBinding(ctx context.Context, actingAccountID int64, in postgres.SavePurposeBinding) (postgres.PurposeBinding, error)
	ResolvePurpose(ctx context.Context, in postgres.ResolvePurpose) (postgres.ResolvedPurpose, error)
	MarkModelToolCallsVerified(ctx context.Context, actingAccountID int64, providerID, profileKey string) (postgres.ToolCallVerification, error)
}

// AuthFlowStore owns the short-lived login challenge, authenticator and
// trusted-device transitions. It is separate from CompanionStore so the
// authentication state machine does not expand the business-data interface.
type AuthFlowStore interface {
	EnsureDefaultRelationship(ctx context.Context, accountID int64, personaRef string) (postgres.Relationship, error)
	AuthenticatorEnabled(ctx context.Context, accountID int64) (bool, error)
	CreateAuthChallenge(ctx context.Context, accountID int64, mode string, expiresAt time.Time) (postgres.AuthChallenge, error)
	AuthenticatorSetup(ctx context.Context, challengeID string, now time.Time) (auth.TOTPProvisioning, error)
	CompleteAuthChallenge(ctx context.Context, in postgres.AuthCompleteInput) (postgres.AuthenticatedSession, bool, error)
	LoginWithTrustedDevice(ctx context.Context, accountID int64, deviceToken string, now, sessionExpiresAt time.Time) (postgres.AuthenticatedSession, bool, error)
	ListTrustedDevices(ctx context.Context, accountID int64) ([]postgres.TrustedDevice, error)
	RevokeTrustedDevice(ctx context.Context, accountID, deviceID int64) error
	ResetAuthenticator(ctx context.Context, actingAccountID, targetAccountID int64) error
	ListAdminAccounts(ctx context.Context, actingAccountID int64) ([]postgres.AdminAccount, error)
	ReviewAccount(ctx context.Context, actingAccountID, targetAccountID int64, decision string, now time.Time) error
}

// Core is the G7/G9/G10 command surface. companiond wires it only in full mode
// against an isolation or cutover database. api-migration never registers
// these routes (Phase 4 write hard-ban).
type Core struct {
	MemoryCore *memorycore.Broker
	Store      CompanionStore
	Sessions   auth.Sessions
	Passwords  *auth.Password
	Blobs      BlobStore
	Limiter    *auth.Limiter
	Turns      GenerationAPI
	Providers  ProviderAdminStore
	AuthFlow   AuthFlowStore
	Cancels    *jobs.Cancels
	Hub        *realtime.Hub
}

func (s *Server) registerCore() {
	s.mux.HandleFunc("POST /api/v1/service/memorycore/llm", s.handleMemoryCoreLLM)
	s.mux.HandleFunc("GET /api/v1/admin/embedding-config", s.handleGetEmbeddingConfig)
	s.mux.HandleFunc("PUT /api/v1/admin/embedding-config", s.handleSaveEmbeddingConfig)
	s.mux.HandleFunc("POST /api/v1/st/bindings", s.handleResolveSTBinding)
	s.mux.HandleFunc("POST /api/v1/st/sources/reconcile", s.handleReconcileSTSources)
	s.mux.HandleFunc("POST /api/v1/st/memory/recall", s.handleSTMemoryRecall)
	s.mux.HandleFunc("POST /api/v1/st/tools/execute", s.handleExecuteTool)
	s.mux.HandleFunc("POST /api/v1/story/runs", s.handleStartStoryRun)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/actions", s.handleStoryAction)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/rewind", s.handleStoryRewind)
	s.mux.HandleFunc("GET /api/v1/story/runs/{runId}/projections", s.handleListPendingStoryProjections)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/projections/{eventId}/confirm", s.handleStoryProjectionConfirm)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/participants/{actorId}", s.handleStoryParticipant)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/epilogue", s.handleStoryEpilogue)
	s.mux.HandleFunc("GET /api/v1/story/runs/{runId}/actors/{actorId}/view", s.handleStoryActorView)
	s.mux.HandleFunc("POST /api/v1/story/runs/{runId}/actors/{actorId}/outbound-check", s.handleStoryOutboundCheck)
	s.mux.HandleFunc("POST /api/v1/service/st/profile", s.handleRegisterSTProfile)
	s.mux.HandleFunc("POST /api/v1/relationships", s.handleCreateRelationship)
	s.mux.HandleFunc("GET /api/v1/relationships", s.handleListRelationships)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}", s.handleActivateRelationship)
	s.mux.HandleFunc("PATCH /api/v1/relationships/{relationshipId}", s.handleUpdateRelationshipPrefs)
	s.mux.HandleFunc("DELETE /api/v1/relationships/{relationshipId}", s.handleDeleteRelationship)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}/deactivate", s.handleDeactivateRelationship)
	s.mux.HandleFunc("GET /api/v1/relationships/{relationshipId}/clearance-preview", s.handlePreviewRelationshipClearance)
	s.mux.HandleFunc("POST /api/v1/relationships/{relationshipId}/reset", s.handleResetRelationship)

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

	s.mux.HandleFunc("GET /api/v1/relationships/{relationshipId}/proactive-policy", s.handleGetProactivePolicy)
	s.mux.HandleFunc("PUT /api/v1/relationships/{relationshipId}/proactive-policy", s.handlePutProactivePolicy)
	s.mux.HandleFunc("GET /api/v1/relationships/{relationshipId}/follow-ups", s.handleListFollowUps)
	s.mux.HandleFunc("GET /api/v1/follow-ups/{followUpId}", s.handleGetFollowUp)
	s.mux.HandleFunc("POST /api/v1/follow-ups/{followUpId}/cancel", s.handleCancelFollowUp)

	s.mux.HandleFunc("GET /api/v1/incognito-pref", s.handleGetIncognitoPref)
	s.mux.HandleFunc("PUT /api/v1/incognito-pref", s.handleUpdateIncognitoPref)
	s.mux.HandleFunc("GET /api/v1/memory-auto-save-pref", s.handleGetMemoryAutoSavePref)
	s.mux.HandleFunc("PUT /api/v1/memory-auto-save-pref", s.handleUpdateMemoryAutoSavePref)
	s.mux.HandleFunc("GET /api/v1/consents", s.handleListConsents)
	s.mux.HandleFunc("PUT /api/v1/consents", s.handleRecordConsent)
	s.mux.HandleFunc("GET /api/v1/age/state", s.handleGetAgeState)
	s.mux.HandleFunc("POST /api/v1/age/verification", s.handleVerifyAge)

	s.mux.HandleFunc("POST /api/v1/reports", s.handleCreateReport)
	s.mux.HandleFunc("GET /api/v1/reports", s.handleListReports)

	s.mux.HandleFunc("POST /api/v1/exports", s.handleCreateExport)
	s.mux.HandleFunc("POST /api/v1/exports/recover", s.handleRecoverExport)
	s.mux.HandleFunc("GET /api/v1/exports/{exportId}", s.handleGetExport)
	s.mux.HandleFunc("GET /api/v1/exports/{exportId}/download", s.handleDownloadExport)

	s.mux.HandleFunc("POST /api/v1/auth/login", s.handleLogin)
	s.mux.HandleFunc("GET /api/v1/auth/registration-status", s.handleRegistrationStatus)
	s.mux.HandleFunc("POST /api/v1/auth/register", s.handleRegistrationClosed)
	s.mux.HandleFunc("GET /api/v1/auth/session", s.handleSession)
	s.mux.HandleFunc("POST /api/v1/auth/challenges/{challengeId}/authenticator-setup", s.handleAuthenticatorSetup)
	s.mux.HandleFunc("POST /api/v1/auth/challenges/{challengeId}/authenticator-confirm", s.handleAuthenticatorConfirm)
	s.mux.HandleFunc("POST /api/v1/auth/challenges/{challengeId}/totp", s.handleTOTPVerify)
	s.mux.HandleFunc("POST /api/v1/auth/challenges/{challengeId}/recovery-code", s.handleRecoveryCodeVerify)
	s.mux.HandleFunc("POST /api/v1/auth/logout", s.handleLogout)
	s.mux.HandleFunc("GET /api/v1/auth/sessions", s.handleListSessions)
	s.mux.HandleFunc("DELETE /api/v1/auth/sessions/{sessionId}", s.handleRevokeSession)
	s.mux.HandleFunc("POST /api/v1/auth/sessions/revoke-all", s.handleRevokeAllSessions)
	s.mux.HandleFunc("GET /api/v1/auth/trusted-devices", s.handleListTrustedDevices)
	s.mux.HandleFunc("DELETE /api/v1/auth/trusted-devices/{deviceId}", s.handleRevokeTrustedDevice)
	s.mux.HandleFunc("POST /api/v1/auth/password", s.handleChangePassword)
	s.mux.HandleFunc("POST /api/v1/auth/reauth", s.handleReauth)
	s.mux.HandleFunc("DELETE /api/v1/auth/account", s.handleDeleteAccount)
	s.mux.HandleFunc("GET /api/v1/service-mode", s.handleServiceMode)
	s.mux.HandleFunc("GET /api/v1/admin/providers", s.handleListProviders)
	s.mux.HandleFunc("GET /api/v1/admin/accounts", s.handleListAdminAccounts)
	s.mux.HandleFunc("POST /api/v1/admin/accounts/{accountId}/review", s.handleReviewAdminAccount)
	s.mux.HandleFunc("POST /api/v1/admin/accounts/{accountId}/authenticator-reset", s.handleAdminResetAuthenticator)
	s.mux.HandleFunc("PUT /api/v1/admin/providers/{providerId}", s.handleSaveProvider)
	s.mux.HandleFunc("POST /api/v1/admin/providers/{providerId}/models/discover", s.handleDiscoverProviderModels)
	s.mux.HandleFunc("POST /api/v1/admin/providers/{providerId}/models/{profileKey}/verify-tool-calls", s.handleVerifyModelToolCalls)
	s.mux.HandleFunc("PUT /api/v1/admin/model-routing-order", s.handleReorderProviderModels)
	s.mux.HandleFunc("GET /api/v1/admin/model-purposes", s.handleListPurposeBindings)
	s.mux.HandleFunc("PUT /api/v1/admin/model-purposes/{purpose}", s.handleSavePurposeBinding)
	s.mux.HandleFunc("POST /api/v1/service/model-purposes/{purpose}/resolve", s.handleResolvePurpose)
	s.mux.HandleFunc("POST /api/v1/service/model-usage/reservations", s.handleReserveModelUsage)
	s.mux.HandleFunc("POST /api/v1/service/model-usage/reservations/{reservationId}/settle", s.handleSettleModelUsage)
	s.mux.HandleFunc("POST /api/v1/service/model-usage/reservations/{reservationId}/cancel", s.handleCancelModelUsage)
	s.mux.HandleFunc("POST /api/v1/service/model-usage/local-embeddings", s.handleRecordLocalEmbedding)
	s.mux.HandleFunc("GET /api/v1/auth/admin/usage", s.handleAdminModelUsage)
	s.mux.HandleFunc("GET /api/v1/inbox", s.handleListInbox)
	s.mux.HandleFunc("POST /api/v1/inbox/{eventId}/claim", s.handleClaimInbox)
	s.mux.HandleFunc("POST /api/v1/inbox/{eventId}/ack", s.handleAckInbox)
	s.mux.HandleFunc("POST /api/v1/inbox/{eventId}/read", s.handleMarkInboxRead)
	s.mux.HandleFunc("GET /api/v1/notification-channels", s.handleListNotificationChannels)
	s.mux.HandleFunc("PUT /api/v1/notification-channels", s.handlePutNotificationChannel)
	s.mux.HandleFunc("GET /api/v1/notification-deliveries", s.handleListNotificationDeliveries)
	s.registerGeneration()
}

func (s *Server) corePrincipal(w http.ResponseWriter, r *http.Request, write bool) *auth.Principal {
	if write {
		s.metrics.ObserveCoreWrite()
		if !auth.AllowOrigin(r.Header.Get("Origin"), s.cfg.HTTP.AllowedOrigins) {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "origin rejected")
			return nil
		}
		if !csrfMatches(r) {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "csrf rejected")
			return nil
		}
	}
	if s.core == nil || s.core.Sessions == nil {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return nil
	}
	token := auth.CookieToken(r)
	if token == "" {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return nil
	}
	p, err := s.core.Sessions.Lookup(r.Context(), token)
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	if p == nil || p.AccountID <= 0 {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return nil
	}
	// Shared-cookie stale-tab guard: a page rendered for another account must
	// not run business effects under this cookie principal. Checked after the
	// cookie principal is resolved and before any handler effects (including
	// the password-change gate, so a context mismatch wins over it).
	if !expectedAccountMatches(r, p.AccountID, write) {
		s.writeAPIError(w, http.StatusConflict, "ACCOUNT_CONTEXT_CHANGED", "account context changed")
		return nil
	}
	// VC-R169: same session precondition, checked after the account context so
	// a mismatched account wins; same rejection code — from the page's point
	// of view the identity context changed either way.
	if !expectedSessionMatches(r, p.SessionID, write) {
		s.writeAPIError(w, http.StatusConflict, "ACCOUNT_CONTEXT_CHANGED", "account context changed")
		return nil
	}
	if write && p.PasswordMustChange && !passwordChangeAllowed(r.URL.Path) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "password change required")
		return nil
	}
	// An active deletion intent freezes late writes before any handler effect.
	// The answer stays NOT_FOUND_OR_FORBIDDEN, the same code the SQL barrier
	// maps to: OpenAPI resource writes do not publish ACCOUNT_DELETION_PENDING.
	// Deletion state is disclosed on GET /api/v1/auth/session (deletionPending).
	// Export recovery stays on its password path so a deletion answer matches
	// a wrong password or an absent export.
	if write && r.URL.Path != "/api/v1/auth/account" && r.URL.Path != "/api/v1/auth/logout" && r.URL.Path != "/api/v1/exports/recover" {
		deleting, err := s.core.Store.DeletionIntentActive(r.Context(), p.AccountID)
		if err != nil {
			s.writeStoreErr(w, err)
			return nil
		}
		if deleting {
			s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
			return nil
		}
	}
	return p
}

func passwordChangeAllowed(path string) bool {
	switch path {
	case "/api/v1/auth/password", "/api/v1/auth/logout", "/api/v1/auth/reauth":
		return true
	default:
		return false
	}
}

// expectedAccountMatches enforces the page-known account precondition on
// corePrincipal-authenticated requests. Writes must carry the header and it
// must equal the cookie principal's account id; reads keep working without
// the header (identity discovery and resource-id/token readers) but, when a
// value is present, it must match. A mismatch means the shared-browser cookie
// now belongs to a different account than the page issuing the request.
func expectedAccountMatches(r *http.Request, accountID int64, write bool) bool {
	expected := strings.TrimSpace(r.Header.Get(expectedAccountHeader))
	if expected == "" {
		return !write
	}
	return expected == strconv.FormatInt(accountID, 10)
}

// expectedSessionMatches is the VC-R169 session-level twin of
// expectedAccountMatches: authenticated writes must carry the committed
// session id and it must equal the cookie session; reads stay header-less but
// compare when a value is present.
func expectedSessionMatches(r *http.Request, sessionID int64, write bool) bool {
	expected := strings.TrimSpace(r.Header.Get(expectedSessionHeader))
	if expected == "" {
		return !write
	}
	return expected == strconv.FormatInt(sessionID, 10)
}

// authRequestSource returns the direct peer unless this runtime is explicitly
// behind the one trusted reverse proxy configured by deployment. Proxy chains
// are intentionally unsupported: only one header value containing one IP is
// accepted.
func (s *Server) authRequestSource(r *http.Request) string {
	trust := s != nil && s.cfg.HTTP.TrustProxyHeaders
	return requestSourceFrom(r, trust)
}

func requestSourceFrom(r *http.Request, trustProxyHeaders bool) string {
	if r == nil {
		return ""
	}
	direct := remoteHost(r.RemoteAddr)
	if !trustProxyHeaders {
		return direct
	}
	values := r.Header.Values("X-Forwarded-For")
	if len(values) != 1 {
		return direct
	}
	raw := strings.TrimSpace(values[0])
	if raw == "" || strings.Contains(raw, ",") {
		return direct
	}
	ip := net.ParseIP(raw)
	if ip == nil {
		return direct
	}
	return ip.String()
}

func remoteHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return remoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
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
	case errors.Is(err, postgres.ErrRateLimited):
		// §19.5: the outstanding-cap admission rejection carries Retry-After: 2.
		w.Header().Set("Retry-After", "2")
		s.writeAPIError(w, http.StatusTooManyRequests, "RATE_LIMITED", "rate limited")
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
