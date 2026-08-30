// Package provider constructs one concrete adapter from an administrator route.
// It is a closed three-protocol switch, not a runtime plugin registry.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/provider/anthropic"
	"github.com/hxf4869/virtual-companion/internal/provider/modelhttp"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
	"github.com/hxf4869/virtual-companion/internal/provider/responses"
)

type Route struct {
	ProviderID      string
	SupplierName    string
	Protocol        string
	BaseURL         string
	Credential      string
	ModelID         string
	MaxOutputTokens int
	Priority        int
}

type Factory struct {
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxResponseBytes  int64
	Temperature       float64
	AllowLoopbackHTTP bool
}

type DiscoveredModel struct {
	ModelID     string
	DisplayName string
}

func ValidateBaseURL(baseURL, protocol string, allowLoopbackHTTP bool) error {
	_, err := modelhttp.ResolveEndpoint(baseURL, protocol, allowLoopbackHTTP)
	return err
}

func ValidateProviderID(value string) error {
	if len(value) < 1 || len(value) > 64 || value[0] < 'a' || value[0] > 'z' {
		return errors.New("provider id is invalid")
	}
	for i := 1; i < len(value); i++ {
		c := value[i]
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return errors.New("provider id is invalid")
		}
	}
	return nil
}

func (f Factory) Build(route Route) (companion.Provider, error) {
	if ValidateProviderID(route.ProviderID) != nil || strings.TrimSpace(route.SupplierName) == "" ||
		strings.TrimSpace(route.ModelID) == "" || route.MaxOutputTokens < 1 ||
		!modelhttp.CredentialValid(route.Credential) {
		return nil, errors.New("provider route is invalid")
	}
	endpoint, err := modelhttp.ResolveEndpoint(route.BaseURL, route.Protocol, f.AllowLoopbackHTTP)
	if err != nil {
		return nil, err
	}
	switch route.Protocol {
	case "OPENAI_CHAT_COMPLETIONS":
		return openai.New(openai.Config{
			Endpoint: endpoint.String(), BearerToken: route.Credential,
			Model: route.ModelID, MaxTokens: route.MaxOutputTokens,
			Temperature: f.Temperature, ConnectTimeout: f.ConnectTimeout,
			FirstTokenTimeout: f.FirstTokenTimeout, TotalTimeout: f.TotalTimeout,
			MaxResponseBytes:  f.MaxResponseBytes,
			AllowLoopbackHTTP: f.AllowLoopbackHTTP,
		})
	case "OPENAI_RESPONSES":
		return responses.New(responses.Config{
			BaseURL: route.BaseURL, BearerToken: route.Credential,
			Model: route.ModelID, MaxTokens: route.MaxOutputTokens,
			ConnectTimeout: f.ConnectTimeout, FirstTokenTimeout: f.FirstTokenTimeout,
			TotalTimeout: f.TotalTimeout, MaxResponseBytes: f.MaxResponseBytes,
			AllowLoopbackHTTP: f.AllowLoopbackHTTP,
		})
	case "ANTHROPIC_MESSAGES":
		return anthropic.New(anthropic.Config{
			BaseURL: route.BaseURL, APIKey: route.Credential,
			Model: route.ModelID, MaxTokens: route.MaxOutputTokens,
			ConnectTimeout: f.ConnectTimeout, FirstTokenTimeout: f.FirstTokenTimeout,
			TotalTimeout: f.TotalTimeout, MaxResponseBytes: f.MaxResponseBytes,
			AllowLoopbackHTTP: f.AllowLoopbackHTTP,
		})
	default:
		return nil, errors.New("provider protocol is unsupported")
	}
}

// DiscoverModels performs the administrator-triggered standard /v1/models
// lookup. Results are bounded candidates and are never persisted here.
func (f Factory) DiscoverModels(ctx context.Context, route Route) ([]DiscoveredModel, error) {
	if route.Protocol != "OPENAI_CHAT_COMPLETIONS" &&
		route.Protocol != "OPENAI_RESPONSES" && route.Protocol != "ANTHROPIC_MESSAGES" {
		return nil, errors.New("provider protocol is unsupported")
	}
	if !modelhttp.CredentialValid(route.Credential) {
		return nil, errors.New("provider credential is invalid")
	}
	endpoint, err := modelhttp.ResolveModelsEndpoint(route.BaseURL, f.AllowLoopbackHTTP)
	if err != nil {
		return nil, err
	}
	client, err := modelhttp.New(modelhttp.Config{
		Endpoint: endpoint, ConnectTimeout: f.ConnectTimeout,
		FirstTokenTimeout: f.FirstTokenTimeout, TotalTimeout: f.TotalTimeout,
		MaxResponseBytes: f.MaxResponseBytes,
	})
	if err != nil {
		return nil, err
	}
	defer client.Close()
	headers := make(http.Header)
	if route.Protocol == "ANTHROPIC_MESSAGES" {
		headers.Set("x-api-key", route.Credential)
		headers.Set("anthropic-version", "2023-06-01")
	} else {
		headers.Set("Authorization", "Bearer "+route.Credential)
	}
	body, err := client.GetJSON(ctx, headers)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Data []struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || len(payload.Data) > 1000 {
		return nil, errors.New("provider catalog response is invalid")
	}
	out := make([]DiscoveredModel, 0, min(len(payload.Data), 100))
	seen := make(map[string]struct{}, len(payload.Data))
	for _, item := range payload.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" || len(id) > 200 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		name := strings.TrimSpace(item.DisplayName)
		if name == "" {
			name = id
		}
		if len(name) > 100 {
			name = id
		}
		out = append(out, DiscoveredModel{ModelID: id, DisplayName: name})
		if len(out) == 100 {
			break
		}
	}
	return out, nil
}
