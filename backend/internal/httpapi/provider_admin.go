package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type providerModelJSON struct {
	ModelID             string `json:"modelId"`
	DisplayName         string `json:"displayName"`
	ContextWindowTokens *int   `json:"contextWindowTokens,omitempty"`
	MaxOutputTokens     int    `json:"maxOutputTokens"`
	Priority            int    `json:"priority,omitempty"`
	State               string `json:"state"`
	UpdatedAt           string `json:"updatedAt,omitempty"`
}

type providerJSON struct {
	ProviderID           string              `json:"providerId"`
	DisplayName          string              `json:"displayName"`
	Protocol             string              `json:"protocol"`
	BaseURL              string              `json:"baseUrl"`
	Credential           string              `json:"credential,omitempty"`
	CredentialConfigured bool                `json:"credentialConfigured"`
	State                string              `json:"state"`
	UpdatedAt            string              `json:"updatedAt,omitempty"`
	Models               []providerModelJSON `json:"models"`
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
			CredentialConfigured: row.CredentialConfigured,
			State:                row.State, UpdatedAt: rfc3339(row.UpdatedAt),
			Models: make([]providerModelJSON, 0, len(row.Models)),
		}
		for _, model := range row.Models {
			item.Models = append(item.Models, providerModelJSON{
				ModelID: model.ModelID, DisplayName: model.DisplayName,
				ContextWindowTokens: model.ContextWindowTokens,
				MaxOutputTokens:     model.MaxOutputTokens, Priority: model.Priority,
				State: model.State, UpdatedAt: rfc3339(model.UpdatedAt),
			})
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
	var body providerJSON
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
			ModelID: model.ModelID, DisplayName: model.DisplayName,
			ContextWindowTokens: model.ContextWindowTokens,
			MaxOutputTokens:     model.MaxOutputTokens, State: model.State,
		})
	}
	err := s.core.Providers.SaveProviderConfig(r.Context(), p.AccountID, postgres.SaveProvider{
		ProviderID: providerID, DisplayName: body.DisplayName,
		Protocol: body.Protocol, BaseURL: body.BaseURL,
		Credential: body.Credential, State: body.State, Models: models,
	})
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
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
