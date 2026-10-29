package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/provider/modelhttp"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type providerRouteResolver interface {
	ResolveProviderRoutes(context.Context) ([]postgres.ProviderRoute, error)
}

// providerModelJSON is one profile in both directions. On input a nil
// capabilities / reasoningLevels / generationParams / pricing keeps the stored
// document; profileKey defaults to modelId. Responses always carry all four
// documents, boundPurposes and ledgerPrice. A save ignores ledgerPrice.
type providerModelJSON struct {
	ProfileKey          string                     `json:"profileKey,omitempty"`
	ModelID             string                     `json:"modelId"`
	DisplayName         string                     `json:"displayName"`
	ContextWindowTokens *int                       `json:"contextWindowTokens,omitempty"`
	MaxOutputTokens     int                        `json:"maxOutputTokens"`
	Priority            int                        `json:"priority,omitempty"`
	State               string                     `json:"state"`
	Capabilities        postgres.ModelCapabilities `json:"capabilities"`
	ReasoningLevels     []string                   `json:"reasoningLevels"`
	GenerationParams    *postgres.GenerationParams `json:"generationParams"`
	Pricing             *postgres.ModelPricing     `json:"pricing"`
	BoundPurposes       []string                   `json:"boundPurposes"`
	UpdatedAt           string                     `json:"updatedAt,omitempty"`
	LedgerPrice         string                     `json:"ledgerPrice"`
}

// resolveModelJSON is the pinned profile as the plugin applies it.
type resolveModelJSON struct {
	ProfileKey          string                     `json:"profileKey"`
	ModelID             string                     `json:"modelId"`
	DisplayName         string                     `json:"displayName"`
	ContextWindowTokens *int                       `json:"contextWindowTokens,omitempty"`
	MaxOutputTokens     int                        `json:"maxOutputTokens"`
	State               string                     `json:"state"`
	Capabilities        postgres.ModelCapabilities `json:"capabilities"`
	ReasoningLevels     []string                   `json:"reasoningLevels"`
	GenerationParams    *postgres.GenerationParams `json:"generationParams"`
	Pricing             *postgres.ModelPricing     `json:"pricing"`
}

// providerJSON is the secret-free response shape; it has no credential field.
type providerJSON struct {
	ProviderID           string              `json:"providerId"`
	DisplayName          string              `json:"displayName"`
	Protocol             string              `json:"protocol"`
	BaseURL              string              `json:"baseUrl"`
	EndpointURL          string              `json:"endpointUrl,omitempty"`
	CredentialConfigured bool                `json:"credentialConfigured"`
	State                string              `json:"state"`
	Revision             int64               `json:"revision"`
	UpdatedAt            string              `json:"updatedAt,omitempty"`
	Models               []providerModelJSON `json:"models"`
}

type providerSaveJSON struct {
	DisplayName      string              `json:"displayName"`
	Protocol         string              `json:"protocol"`
	BaseURL          string              `json:"baseUrl"`
	Credential       string              `json:"credential,omitempty"`
	ClearCredential  bool                `json:"clearCredential,omitempty"`
	State            string              `json:"state"`
	ExpectedRevision *int64              `json:"expectedRevision,omitempty"`
	Models           []providerModelJSON `json:"models"`
}

type providerMutationJSON struct {
	OK       bool  `json:"ok"`
	Revision int64 `json:"revision"`
}

type routeOrderJSON struct {
	Routes []postgres.RouteRef `json:"routes"`
}

type providerDiscoveryJSON struct {
	Protocol   string `json:"protocol"`
	BaseURL    string `json:"baseUrl"`
	Credential string `json:"credential,omitempty"`
}

type discoveredModelJSON struct {
	ModelID     string `json:"modelId"`
	DisplayName string `json:"displayName"`
}

type purposeBindingJSON struct {
	Purpose    string  `json:"purpose"`
	ProviderID *string `json:"providerId"`
	ProfileKey *string `json:"profileKey"`
	ModelID    *string `json:"modelId"`
	State      string  `json:"state"`
	Status     string  `json:"status"`
	Revision   int64   `json:"revision"`
	UpdatedAt  string  `json:"updatedAt,omitempty"`
}

type purposeBindingSaveJSON struct {
	ProviderID       *string `json:"providerId"`
	ProfileKey       *string `json:"profileKey"`
	State            string  `json:"state"`
	ExpectedRevision *int64  `json:"expectedRevision,omitempty"`
}

// purposeResolveRequestJSON carries ownerAccountId as a decimal string: the
// SillyTavern plugin forwards the Go session's accountId verbatim, and the
// string form keeps IDs above the JS safe-integer range exact end to end.
type purposeResolveRequestJSON struct {
	OwnerAccountID   string `json:"ownerAccountId"`
	ProviderID       string `json:"providerId,omitempty"`
	ProfileKey       string `json:"profileKey,omitempty"`
	ProviderRevision *int64 `json:"providerRevision,omitempty"`
	BindingRevision  *int64 `json:"bindingRevision,omitempty"`
}

type purposeResolveProviderJSON struct {
	ProviderID  string `json:"providerId"`
	DisplayName string `json:"displayName"`
	Protocol    string `json:"protocol"`
	BaseURL     string `json:"baseUrl"`
	EndpointURL string `json:"endpointUrl,omitempty"`
	Revision    int64  `json:"revision"`
	Credential  string `json:"credential"`
}

type purposeResolveResponseJSON struct {
	Purpose         string                     `json:"purpose"`
	BindingRevision int64                      `json:"bindingRevision"`
	Provider        purposeResolveProviderJSON `json:"provider"`
	Model           resolveModelJSON           `json:"model"`
}

func (s *Server) handleServiceMode(w http.ResponseWriter, r *http.Request) {
	if s.corePrincipal(w, r, false) == nil {
		return
	}

	fullAI := s.cfg.Provider.Enabled
	if resolver, ok := s.core.Providers.(providerRouteResolver); ok {
		routes, err := resolver.ResolveProviderRoutes(r.Context())
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		fullAI = fullAI || len(routes) > 0
	}

	if fullAI {
		s.writeJSON(w, http.StatusOK, map[string]string{
			"mode":    "FULL_AI",
			"summary": "已配置可用的模型路由，生成式聊天已启用。",
		})
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]string{
		"mode":    "ZERO_LLM",
		"summary": "当前没有可用的模型路由，生成式聊天保持关闭。",
	})
}

func (s *Server) providerAdminPrincipal(w http.ResponseWriter, r *http.Request, write bool) *auth.Principal {
	p := s.corePrincipal(w, r, write)
	if p == nil {
		return nil
	}
	if p.Role != "ADMIN" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "access denied")
		return nil
	}
	if s.core == nil || s.core.Providers == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil
	}
	if write && !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "recent reauthentication required")
		return nil
	}
	return p
}

// endpointURL is the normalized final request address shown next to a base
// URL; an address that cannot be resolved is simply omitted.
func (s *Server) endpointURL(baseURL, protocol string) string {
	u, err := modelhttp.ResolveEndpoint(baseURL, protocol, s.cfg.Provider.AllowLoopbackHTTP)
	if err != nil {
		return ""
	}
	return u.String()
}

func modelToJSON(model postgres.ProviderModel) providerModelJSON {
	return providerModelJSON{
		ProfileKey: model.ProfileKey, ModelID: model.ModelID, DisplayName: model.DisplayName,
		ContextWindowTokens: model.ContextWindowTokens,
		MaxOutputTokens:     model.MaxOutputTokens, Priority: model.Priority,
		State: model.State, Capabilities: model.Capabilities,
		ReasoningLevels: model.ReasoningLevels, GenerationParams: model.GenerationParams,
		Pricing: model.Pricing, BoundPurposes: model.BoundPurposes,
		UpdatedAt: rfc3339(model.UpdatedAt), LedgerPrice: model.LedgerPrice,
	}
}

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, false)
	if p == nil {
		return
	}
	rows, err := s.core.Providers.ListProviderConfigs(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]providerJSON, 0, len(rows))
	for _, row := range rows {
		item := providerJSON{
			ProviderID: row.ProviderID, DisplayName: row.DisplayName,
			Protocol: row.Protocol, BaseURL: row.BaseURL,
			EndpointURL:          s.endpointURL(row.BaseURL, row.Protocol),
			CredentialConfigured: row.CredentialConfigured,
			State:                row.State, Revision: row.Revision,
			UpdatedAt: rfc3339(row.UpdatedAt),
			Models:    make([]providerModelJSON, 0, len(row.Models)),
		}
		for _, model := range row.Models {
			item.Models = append(item.Models, modelToJSON(model))
		}
		out = append(out, item)
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSaveProvider(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("providerId"))
	var body providerSaveJSON
	if modelprovider.ValidateProviderID(providerID) != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if err := modelprovider.ValidateBaseURL(
		body.BaseURL, body.Protocol, s.cfg.Provider.AllowLoopbackHTTP,
	); err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	models := make([]postgres.ProviderModel, 0, len(body.Models))
	for _, model := range body.Models {
		models = append(models, postgres.ProviderModel{
			ProfileKey: model.ProfileKey, ModelID: model.ModelID, DisplayName: model.DisplayName,
			ContextWindowTokens: model.ContextWindowTokens,
			MaxOutputTokens:     model.MaxOutputTokens, State: model.State,
			Capabilities:     model.Capabilities,
			ReasoningLevels:  model.ReasoningLevels,
			GenerationParams: model.GenerationParams,
			Pricing:          model.Pricing,
		})
	}
	revision, err := s.core.Providers.SaveProviderConfig(r.Context(), p.AccountID, postgres.SaveProvider{
		ProviderID: providerID, DisplayName: body.DisplayName,
		Protocol: body.Protocol, BaseURL: body.BaseURL,
		Credential: body.Credential, ClearCredential: body.ClearCredential,
		State: body.State, ExpectedRevision: body.ExpectedRevision, Models: models,
	})
	if err != nil {
		s.writeCatalogErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, providerMutationJSON{OK: true, Revision: revision})
}

func (s *Server) handleDiscoverProviderModels(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("providerId"))
	var body providerDiscoveryJSON
	if modelprovider.ValidateProviderID(providerID) != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if err := modelprovider.ValidateBaseURL(
		body.BaseURL, body.Protocol, s.cfg.Provider.AllowLoopbackHTTP,
	); err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	credential := body.Credential
	if credential == "" {
		var err error
		credential, err = s.core.Providers.GetProviderCredential(r.Context(), p.AccountID, providerID)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
	}
	factory := modelprovider.Factory{
		ConnectTimeout:    s.cfg.Provider.ConnectTimeout,
		FirstTokenTimeout: s.cfg.Provider.FirstTokenTimeout,
		TotalTimeout:      s.cfg.Provider.TotalTimeout,
		MaxResponseBytes:  s.cfg.Provider.MaxResponseBytes,
		AllowLoopbackHTTP: s.cfg.Provider.AllowLoopbackHTTP,
	}
	models, err := factory.DiscoverModels(r.Context(), modelprovider.Route{
		ProviderID: providerID,
		Protocol:   body.Protocol,
		BaseURL:    body.BaseURL,
		Credential: credential,
	})
	if err != nil {
		s.writeAPIError(w, http.StatusBadGateway, "INVALID_REQUEST", "provider catalog unavailable")
		return
	}
	out := make([]discoveredModelJSON, 0, len(models))
	for _, model := range models {
		out = append(out, discoveredModelJSON{ModelID: model.ModelID, DisplayName: model.DisplayName})
	}
	s.writeJSON(w, http.StatusOK, out)
}

type toolCallVerificationJSON struct {
	OK         bool   `json:"ok"`
	ToolCalls  string `json:"toolCalls"`
	VerifiedAt string `json:"verifiedAt"`
	Protocol   string `json:"protocol"`
}

func (s *Server) providerFactory() modelprovider.Factory {
	return modelprovider.Factory{
		ConnectTimeout: s.cfg.Provider.ConnectTimeout, FirstTokenTimeout: s.cfg.Provider.FirstTokenTimeout,
		TotalTimeout: s.cfg.Provider.TotalTimeout, MaxResponseBytes: s.cfg.Provider.MaxResponseBytes,
		AllowLoopbackHTTP: s.cfg.Provider.AllowLoopbackHTTP,
	}
}

func toolProbeAttemptID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return "tool-probe-" + hex.EncodeToString(buf[:]), nil
}

func findProviderProfile(configs []postgres.ProviderConfig, providerID, profileKey string) (postgres.ProviderConfig, postgres.ProviderModel, bool) {
	for _, cfg := range configs {
		if cfg.ProviderID != providerID {
			continue
		}
		for _, model := range cfg.Models {
			key := model.ProfileKey
			if key == "" {
				key = model.ModelID
			}
			if key == profileKey {
				return cfg, model, true
			}
		}
	}
	return postgres.ProviderConfig{}, postgres.ProviderModel{}, false
}

// handleVerifyModelToolCalls is the only administrator path that writes
// toolCalls=VERIFIED. The probe is one small forced tool call. Usage is
// reserved as FOREGROUND_CHAT so an unpriced model still records tokens.
func (s *Server) handleVerifyModelToolCalls(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	providerID := strings.TrimSpace(r.PathValue("providerId"))
	profileKey := strings.TrimSpace(r.PathValue("profileKey"))
	if modelprovider.ValidateProviderID(providerID) != nil || profileKey == "" || len(profileKey) > 200 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	configs, err := s.core.Providers.ListProviderConfigs(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	cfg, model, ok := findProviderProfile(configs, providerID, profileKey)
	if !ok || strings.TrimSpace(model.ModelID) == "" {
		s.writeAPIError(w, http.StatusNotFound, "MODEL_NOT_FOUND", "model profile not found")
		return
	}
	credential, err := s.core.Providers.GetProviderCredential(r.Context(), p.AccountID, providerID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) || errors.Is(err, postgres.ErrInvalid) {
			s.writeAPIError(w, http.StatusBadRequest, "CREDENTIAL_MISSING", "provider credential is not configured")
			return
		}
		s.writeStoreErr(w, err)
		return
	}
	usage, ok := s.modelUsage(w)
	if !ok {
		return
	}
	attempt, err := toolProbeAttemptID()
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	hold, err := usage.ReserveModelUsage(r.Context(), postgres.ModelUsageReserve{
		Owner: p.AccountID, Purpose: postgres.PurposeForegroundChat, AttemptID: attempt,
		ProviderID: providerID, ModelID: model.ModelID,
		InputTokens: 32, OutputTokens: modelprovider.ToolProbeMaxTokens,
	})
	if err != nil {
		s.writeModelUsageErr(w, err)
		return
	}
	probed := modelprovider.Route{
		ProviderID: providerID, SupplierName: cfg.DisplayName, Protocol: cfg.Protocol,
		BaseURL: cfg.BaseURL, Credential: credential, ModelID: model.ModelID,
		MaxOutputTokens: model.MaxOutputTokens,
	}
	probedRevision := cfg.Revision
	probe, probeErr := s.providerFactory().ProbeToolCalls(r.Context(), probed)
	if probeErr != nil {
		s.meterToolProbe(r.Context(), usage, p.AccountID, hold.ReservationID, probe, false)
		code := modelprovider.ToolProbeCodeUnavailable
		var coded *modelprovider.ToolProbeError
		if errors.As(probeErr, &coded) && coded.Code != "" {
			code = coded.Code
		}
		status := http.StatusBadGateway
		if code == modelprovider.ToolProbeCodeMismatch || code == modelprovider.ToolProbeCodeMalformed {
			status = http.StatusUnprocessableEntity
		}
		s.writeAPIError(w, status, code, "tool call verification failed")
		return
	}
	if !s.meterToolProbe(r.Context(), usage, p.AccountID, hold.ReservationID, probe, true) {
		s.writeAPIError(w, http.StatusConflict, "USAGE_REJECTED", "usage was not recorded")
		return
	}
	marked, err := s.core.Providers.MarkModelToolCallsVerified(
		r.Context(), p.AccountID, providerID, profileKey, probed.Protocol, probed.BaseURL, probed.ModelID, probedRevision)
	if errors.Is(err, postgres.ErrToolVerificationStale) {
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "tool call verification is stale")
		return
	}
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, toolCallVerificationJSON{
		OK: true, ToolCalls: postgres.CapabilityVerified,
		VerifiedAt: marked.VerifiedAt.UTC().Format(time.RFC3339Nano),
		Protocol:   marked.Protocol,
	})
}

// meterToolProbe settles a probe that reported usage. A successful probe
// without usage is cancelled as UNKNOWN and still counts. A failed settle of
// a successful probe refuses verification. Metering failures on a rejected
// probe are best-effort and do not change the reason code.
const (
	toolProbeMeterTimeout   = 5 * time.Second
	toolProbeCancelAttempts = 3
)

func (s *Server) meterToolProbe(ctx context.Context, usage modelUsageStore, owner, reservationID int64, probe modelprovider.ToolProbeResult, accept bool) bool {
	meterCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), toolProbeMeterTimeout)
	defer cancel()
	if probe.HasUsage {
		cached := probe.CachedInputTokens
		if _, err := usage.SettleModelUsage(meterCtx, owner, reservationID, probe.InputTokens, probe.OutputTokens, cached); err != nil {
			_ = s.cancelModelUsage(meterCtx, usage, owner, reservationID, "UNKNOWN")
			return !accept
		}
		return true
	}
	disposition := "NOT_SENT"
	if probe.Sent {
		disposition = "UNKNOWN"
	}
	_ = s.cancelModelUsage(meterCtx, usage, owner, reservationID, disposition)
	return !accept || probe.Sent
}

func (s *Server) cancelModelUsage(ctx context.Context, usage modelUsageStore, owner, reservationID int64, disposition string) error {
	var err error
	for attempt := 1; attempt <= toolProbeCancelAttempts; attempt++ {
		if ctx.Err() != nil {
			err = ctx.Err()
			break
		}
		if _, err = usage.CancelModelUsage(ctx, owner, reservationID, disposition); err == nil {
			return nil
		}
	}
	if s.log != nil {
		s.log.Info("model usage cancel",
			slog.String("operation", "tool_probe_meter"),
			slog.String("outcome", "error"),
			slog.String("error_code", "CANCEL_FAILED"),
			slog.String("disposition", disposition),
			slog.Int("attempts", toolProbeCancelAttempts),
		)
	}
	return err
}

func (s *Server) handleReorderProviderModels(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	var body routeOrderJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if err := s.core.Providers.ReorderProviderModels(r.Context(), p.AccountID, body.Routes); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func optionalString(v string) *string {
	if v == "" {
		return nil
	}
	return &v
}

func bindingToJSON(b postgres.PurposeBinding) purposeBindingJSON {
	return purposeBindingJSON{
		Purpose: b.Purpose, ProviderID: optionalString(b.ProviderID),
		ProfileKey: optionalString(b.ProfileKey), ModelID: optionalString(b.ModelID),
		State: b.State, Status: b.Status, Revision: b.Revision, UpdatedAt: rfc3339(b.UpdatedAt),
	}
}

func (s *Server) handleListPurposeBindings(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, false)
	if p == nil {
		return
	}
	rows, err := s.core.Providers.ListPurposeBindings(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]purposeBindingJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, bindingToJSON(row))
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSavePurposeBinding(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	purpose := strings.TrimSpace(r.PathValue("purpose"))
	var body purposeBindingSaveJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	in := postgres.SavePurposeBinding{Purpose: purpose, State: body.State, ExpectedRevision: body.ExpectedRevision}
	if body.ProviderID != nil {
		in.ProviderID = *body.ProviderID
	}
	if body.ProfileKey != nil {
		in.ProfileKey = *body.ProfileKey
	}
	saved, err := s.core.Providers.SavePurposeBinding(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeCatalogErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, bindingToJSON(saved))
}

// serviceCaller authenticates the SillyTavern server plugin on the private
// resolution channel. The shared token is compared in constant time, a
// browser-originated request (Origin header) is refused, and nothing here
// grants an administrator session: the admin surface ignores this token.
func (s *Server) serviceCaller(w http.ResponseWriter, r *http.Request) bool {
	token := s.cfg.STPlugin.ServiceToken
	if token == "" || s.core == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "service channel not configured")
		return false
	}
	if r.Header.Get("Origin") != "" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "browser origin rejected")
		return false
	}
	presented := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if presented == "" || len(presented) != len(token) ||
		subtle.ConstantTimeCompare([]byte(presented), []byte(token)) != 1 {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "service authentication required")
		return false
	}
	return true
}

func (s *Server) handleResolvePurpose(w http.ResponseWriter, r *http.Request) {
	if s.core == nil || s.core.Providers == nil {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "service channel not configured")
		return
	}
	if !s.serviceCaller(w, r) {
		return
	}
	var body purposeResolveRequestJSON
	if !s.decodeJSON(w, r, &body) {
		return
	}
	ownerAccountID, err := strconv.ParseInt(strings.TrimSpace(body.OwnerAccountID), 10, 64)
	if err != nil || ownerAccountID <= 0 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	resolved, err := s.core.Providers.ResolvePurpose(r.Context(), postgres.ResolvePurpose{
		OwnerAccountID: ownerAccountID, Purpose: strings.TrimSpace(r.PathValue("purpose")),
		ProviderID: body.ProviderID, ProfileKey: body.ProfileKey,
		ProviderRevision: body.ProviderRevision, BindingRevision: body.BindingRevision,
	})
	if err != nil {
		s.writeCatalogErr(w, err)
		return
	}
	model := resolved.Model
	s.writeJSON(w, http.StatusOK, purposeResolveResponseJSON{
		Purpose: resolved.Purpose, BindingRevision: resolved.BindingRevision,
		Provider: purposeResolveProviderJSON{
			ProviderID: resolved.ProviderID, DisplayName: resolved.ProviderName,
			Protocol: resolved.Protocol, BaseURL: resolved.BaseURL,
			EndpointURL: s.endpointURL(resolved.BaseURL, resolved.Protocol),
			Revision:    resolved.ProviderRevision, Credential: resolved.Credential,
		},
		Model: resolveModelJSON{
			ProfileKey: model.ProfileKey, ModelID: model.ModelID, DisplayName: model.DisplayName,
			ContextWindowTokens: model.ContextWindowTokens, MaxOutputTokens: model.MaxOutputTokens,
			State: model.State, Capabilities: model.Capabilities, ReasoningLevels: model.ReasoningLevels,
			GenerationParams: model.GenerationParams, Pricing: model.Pricing,
		},
	})
}

// writeCatalogErr maps the catalog-specific store errors to their stable codes
// and falls back to the shared store mapping.
func (s *Server) writeCatalogErr(w http.ResponseWriter, err error) {
	var revision *postgres.RevisionConflictError
	var inUse *postgres.ProfileInUseError
	var unavailable *postgres.PurposeUnavailableError
	var stale *postgres.ResolveConflictError
	switch {
	case errors.As(err, &revision):
		s.writeAPIErrorDetails(w, http.StatusConflict, "REVISION_CONFLICT", "revision conflict",
			map[string]any{"currentRevision": revision.Current})
	case errors.As(err, &inUse):
		s.writeAPIErrorDetails(w, http.StatusConflict, "MODEL_PROFILE_IN_USE", "model profile is bound to a purpose",
			map[string]any{"purposes": inUse.Purposes})
	case errors.As(err, &unavailable):
		s.writeAPIErrorDetails(w, http.StatusConflict, "MODEL_NO_ELIGIBLE_DEPLOYMENT", "purpose binding is not ready",
			map[string]any{"status": unavailable.Status})
	case errors.As(err, &stale):
		s.writeAPIErrorDetails(w, http.StatusConflict, "REVISION_CONFLICT", "projection is stale",
			map[string]any{
				"providerId": stale.ProviderID, "profileKey": stale.ProfileKey,
				"providerRevision": stale.ProviderRevision, "bindingRevision": stale.BindingRevision,
			})
	case errors.Is(err, postgres.ErrServiceOwnerRejected):
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "owner account rejected")
	default:
		s.writeStoreErr(w, err)
	}
}

func (s *Server) writeAPIErrorDetails(w http.ResponseWriter, status int, code, message string, details map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"code": code, "message": message, "details": details})
}
