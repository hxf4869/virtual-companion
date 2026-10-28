package provider

import (
	"context"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProfileParametersReachProtocol(t *testing.T) {
	temp, top, effort := 0.3, 0.8, "low"
	for _, protocol := range []string{"OPENAI_CHAT_COMPLETIONS", "OPENAI_RESPONSES", "ANTHROPIC_MESSAGES"} {
		t.Run(protocol, func(t *testing.T) {
			var payload map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_ = json.NewDecoder(r.Body).Decode(&payload)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{}`))
			}))
			defer srv.Close()
			route := Route{ProviderID: "synthetic", SupplierName: "Synthetic", Protocol: protocol, BaseURL: srv.URL, Credential: "synthetic", ModelID: "synthetic", MaxOutputTokens: 64, UseProfileParams: true, Temperature: &temp, TopP: &top}
			if protocol != "ANTHROPIC_MESSAGES" {
				route.ReasoningEffort = &effort
			}
			p, err := (Factory{AllowLoopbackHTTP: true}).Build(route)
			if err != nil {
				t.Fatal(err)
			}
			defer p.(interface{ Close() }).Close()
			_, _ = p.Stream(context.Background(), companion.ModelRequest{Messages: []companion.Message{{Role: companion.RoleUser, Content: "synthetic"}}}, func(companion.OutputDelta) error { return nil })
			if payload["temperature"] != temp || payload["top_p"] != top {
				t.Fatalf("parameter mapping missing: %+v", payload)
			}
			if protocol == "OPENAI_CHAT_COMPLETIONS" && payload["reasoning_effort"] != effort {
				t.Fatal("chat reasoning")
			}
			if protocol == "OPENAI_RESPONSES" && payload["reasoning"].(map[string]any)["effort"] != effort {
				t.Fatal("responses reasoning")
			}
		})
	}
}
func TestProfileNoTemperatureDoesNotInjectDefault(t *testing.T) {
	var payload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&payload)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	p, err := (Factory{AllowLoopbackHTTP: true, Temperature: 0.7}).Build(Route{ProviderID: "synthetic", SupplierName: "Synthetic", Protocol: "OPENAI_CHAT_COMPLETIONS", BaseURL: srv.URL, Credential: "synthetic", ModelID: "synthetic", MaxOutputTokens: 64, UseProfileParams: true})
	if err != nil {
		t.Fatal(err)
	}
	defer p.(interface{ Close() }).Close()
	_, _ = p.Stream(context.Background(), companion.ModelRequest{Messages: []companion.Message{{Role: companion.RoleUser, Content: "synthetic"}}}, func(companion.OutputDelta) error { return nil })
	if _, ok := payload["temperature"]; ok {
		t.Fatal("unset profile temperature silently defaulted")
	}
}
