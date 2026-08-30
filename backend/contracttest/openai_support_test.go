package contracttest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
)

const (
	offlineToken = "offline-token-sentinel"
	offlineModel = "offline-model-sentinel"
)

type capturedRequest struct {
	method string
	path   string
	auth   string
	accept string
	ctype  string
	body   string
}

type mockServer struct {
	srv   *httptest.Server
	calls atomic.Int32
	last  atomic.Value
}

func startMock(t *testing.T, h http.HandlerFunc) *mockServer {
	t.Helper()
	m := &mockServer{}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		m.calls.Add(1)
		raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		m.last.Store(capturedRequest{
			method: r.Method,
			path:   r.URL.EscapedPath(),
			auth:   r.Header.Get("Authorization"),
			accept: r.Header.Get("Accept"),
			ctype:  r.Header.Get("Content-Type"),
			body:   string(raw),
		})
		h(w, r)
	})
	m.srv = httptest.NewServer(mux)
	t.Cleanup(m.srv.Close)
	return m
}

func (m *mockServer) endpoint() string {
	return m.srv.URL + "/v1/chat/completions"
}

func (m *mockServer) captured() capturedRequest {
	v, _ := m.last.Load().(capturedRequest)
	return v
}

func testAdapter(t *testing.T, endpoint string, mutate func(*openai.Config)) *openai.Adapter {
	t.Helper()
	cfg := openai.Config{
		Endpoint:          endpoint,
		BearerToken:       offlineToken,
		Model:             offlineModel,
		MaxTokens:         128,
		Temperature:       1,
		ConnectTimeout:    2 * time.Second,
		FirstTokenTimeout: 2 * time.Second,
		TotalTimeout:      5 * time.Second,
		MaxResponseBytes:  256 << 10,
		AllowLoopbackHTTP: true,
	}
	if mutate != nil {
		mutate(&cfg)
	}
	a, err := openai.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Close)
	return a
}

func textReq(stream bool, content string) companion.ModelRequest {
	return companion.ModelRequest{
		Messages: []companion.Message{
			{Role: companion.RoleSystem, Content: "synthetic-system"},
			{Role: companion.RoleUser, Content: content},
			{Role: companion.RoleAssistant, Content: "synthetic-prior"},
		},
		Stream: stream,
		Timeouts: companion.TimeoutBudget{
			Connect:    2 * time.Second,
			FirstToken: 2 * time.Second,
			Total:      5 * time.Second,
		},
	}
}

func collect(t *testing.T, a *openai.Adapter, req companion.ModelRequest) (deltas []string, result companion.AttemptResult, err error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	result, err = a.Stream(ctx, req, func(d companion.OutputDelta) error {
		deltas = append(deltas, d.Text)
		return nil
	})
	return deltas, result, err
}

func requireCode(t *testing.T, err error, code companion.Code) *companion.Error {
	t.Helper()
	pe := companion.AsError(err)
	if pe == nil || pe.Code != code {
		t.Fatalf("got %#v (%v), want %s", pe, err, code)
	}
	return pe
}

func completionJSON(content, finish string, prompt, completionTok int64) string {
	payload := map[string]any{
		"id":     "chatcmpl-offline",
		"object": "chat.completion",
		"model":  offlineModel,
		"choices": []any{
			map[string]any{
				"index": 0,
				"message": map[string]any{
					"role":    "assistant",
					"content": content,
				},
				"finish_reason": finish,
			},
		},
		"usage": map[string]any{
			"prompt_tokens":     prompt,
			"completion_tokens": completionTok,
			"total_tokens":      prompt + completionTok,
		},
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func choiceChunk(content *string, finish *string) string {
	delta := map[string]any{}
	if content != nil {
		delta["content"] = *content
	}
	choice := map[string]any{
		"index":         0,
		"delta":         delta,
		"finish_reason": nil,
	}
	if finish != nil {
		choice["finish_reason"] = *finish
	}
	payload := map[string]any{
		"id":      "chatcmpl-offline",
		"object":  "chat.completion.chunk",
		"model":   offlineModel,
		"choices": []any{choice},
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func usageChunk(prompt, completionTok int64) string {
	payload := map[string]any{
		"id":      "chatcmpl-offline",
		"object":  "chat.completion.chunk",
		"model":   offlineModel,
		"choices": []any{},
		"usage": map[string]any{
			"prompt_tokens":     prompt,
			"completion_tokens": completionTok,
			"total_tokens":      prompt + completionTok,
		},
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

func sse(data string) string { return "data: " + data + "\n\n" }

func sseCrLf(data string) string { return "data: " + data + "\r\n\r\n" }

func done() string { return "data: [DONE]\n\n" }

func ptr[T any](v T) *T { return &v }

func writeJSON(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, body)
}

func writeSSE(w http.ResponseWriter, body string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, body)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
}

func mustNoSecret(t *testing.T, s string) {
	t.Helper()
	if strings.Contains(s, offlineToken) || strings.Contains(strings.ToLower(s), "bearer "+offlineToken) {
		t.Fatalf("credential leaked: %s", s)
	}
}
