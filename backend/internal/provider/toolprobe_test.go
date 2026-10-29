package provider

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestProbeToolCallsAcceptsThreeProtocolsAndRejectsABadCall(t *testing.T) {
	t.Parallel()
	const marker = "UPSTREAM_SECRET_MARKER"
	cases := []struct {
		protocol string
		path     string
		body     string
		header   string
	}{
		{
			protocol: "OPENAI_CHAT_COMPLETIONS", path: "/v1/chat/completions", header: "Authorization",
			body: `{"note":"` + marker + `","choices":[{"message":{"tool_calls":[{"function":{"name":"get_current_weather","arguments":"{\"city\":\"北京\"}"}}]}}],"usage":{"prompt_tokens":4,"completion_tokens":5,"prompt_tokens_details":{"cached_tokens":1}}}`,
		},
		{
			protocol: "OPENAI_RESPONSES", path: "/v1/responses", header: "Authorization",
			body: `{"note":"` + marker + `","output":[{"type":"function_call","name":"get_current_weather","arguments":"{\"city\":\"上海\"}"}],"usage":{"input_tokens":6,"output_tokens":7}}`,
		},
		{
			protocol: "ANTHROPIC_MESSAGES", path: "/v1/messages", header: "x-api-key",
			body: `{"note":"` + marker + `","content":[{"type":"tool_use","name":"get_current_weather","input":{"city":"广州"}}],"usage":{"input_tokens":8,"output_tokens":9,"cache_read_input_tokens":2}}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.protocol, func(t *testing.T) {
			var got []byte
			var header string
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got, _ = io.ReadAll(r.Body)
				header = r.Header.Get(tc.header)
				if r.URL.Path != tc.path {
					t.Errorf("path %s", r.URL.Path)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.body))
			}))
			defer upstream.Close()
			result, err := (Factory{AllowLoopbackHTTP: true}).ProbeToolCalls(context.Background(), Route{
				Protocol: tc.protocol, BaseURL: upstream.URL + "/v1", Credential: "probe-secret", ModelID: "m",
			})
			if err != nil || !result.HasUsage || !result.Sent || result.InputTokens == 0 || result.OutputTokens == 0 {
				t.Fatalf("probe %+v err=%v", result, err)
			}
			if tc.protocol == "ANTHROPIC_MESSAGES" {
				if header != "probe-secret" || result.CachedInputTokens == nil || *result.CachedInputTokens != 2 {
					t.Fatalf("anthropic header %q cached %v", header, result.CachedInputTokens)
				}
			} else if header != "Bearer probe-secret" {
				t.Fatalf("authorization %q", header)
			}
			var payload map[string]any
			if err := json.Unmarshal(got, &payload); err != nil {
				t.Fatal(err)
			}
			limit := payload["max_tokens"]
			if tc.protocol == "OPENAI_RESPONSES" {
				limit = payload["max_output_tokens"]
			}
			if limit != float64(ToolProbeMaxTokens) {
				t.Fatalf("output cap %#v", limit)
			}
			tools, _ := payload["tools"].([]any)
			if len(tools) != 1 || payload["tool_choice"] == nil {
				t.Fatalf("tools %#v choice %#v", payload["tools"], payload["tool_choice"])
			}
		})
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"tool_calls":[{"function":{"name":"other","arguments":"{\"city\":\"北京\"}"}}]}}],"usage":{"prompt_tokens":1,"completion_tokens":1},"note":"` + marker + `"}`))
	}))
	defer bad.Close()
	result, err := (Factory{AllowLoopbackHTTP: true}).ProbeToolCalls(context.Background(), Route{
		Protocol: "OPENAI_CHAT_COMPLETIONS", BaseURL: bad.URL + "/v1", Credential: "probe-secret", ModelID: "m",
	})
	probe, _ := err.(*ToolProbeError)
	if probe == nil || probe.Code != ToolProbeCodeMismatch || !result.HasUsage || !result.Sent ||
		strings.Contains(err.Error(), marker) || strings.Contains(err.Error(), "北京") {
		t.Fatalf("mismatch %+v err=%v", result, err)
	}
}
