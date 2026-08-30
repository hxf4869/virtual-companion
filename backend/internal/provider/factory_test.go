package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDiscoverModelsUsesProtocolAuthenticationAndNormalizesCatalog(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		protocol   string
		wantHeader string
		wantValue  string
	}{
		{name: "chat", protocol: "OPENAI_CHAT_COMPLETIONS", wantHeader: "Authorization", wantValue: "Bearer catalog-secret"},
		{name: "responses", protocol: "OPENAI_RESPONSES", wantHeader: "Authorization", wantValue: "Bearer catalog-secret"},
		{name: "anthropic", protocol: "ANTHROPIC_MESSAGES", wantHeader: "x-api-key", wantValue: "catalog-secret"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodGet || r.URL.Path != "/v1/models" {
					t.Errorf("catalog request %s %s", r.Method, r.URL.Path)
				}
				if got := r.Header.Get(tt.wantHeader); got != tt.wantValue {
					t.Errorf("%s %q", tt.wantHeader, got)
				}
				if tt.protocol == "ANTHROPIC_MESSAGES" && r.Header.Get("anthropic-version") != "2023-06-01" {
					t.Error("missing anthropic-version")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-a"},{"id":"model-b","display_name":"Model B"}]}`))
			}))
			defer server.Close()

			models, err := (Factory{AllowLoopbackHTTP: true}).DiscoverModels(context.Background(), Route{
				Protocol: tt.protocol, BaseURL: server.URL + "/v1", Credential: "catalog-secret",
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(models) != 2 || models[0].DisplayName != "model-a" || models[1].DisplayName != "Model B" {
				t.Fatalf("models %+v", models)
			}
		})
	}
}

func TestDiscoverModelsRejectsUnsupportedProtocol(t *testing.T) {
	t.Parallel()
	_, err := (Factory{}).DiscoverModels(context.Background(), Route{
		Protocol: "CUSTOM", BaseURL: "https://api.example/v1", Credential: "secret",
	})
	if err == nil {
		t.Fatal("unsupported discovery protocol accepted")
	}
}
