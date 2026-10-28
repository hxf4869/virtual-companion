package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
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
// documents and boundPurposes, so they are not omitempty.
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
		UpdatedAt: rfc3339(model.UpdatedAt),
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
