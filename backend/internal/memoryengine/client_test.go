package memoryengine

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientDoesNotReplayTimeoutOrExposeBody(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer private" {
			t.Error("missing authentication")
		}
		w.WriteHeader(409)
		_, _ = w.Write([]byte("secret source"))
	}))
	defer srv.Close()
	c, err := New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	err = c.Call(context.Background(), "commit", map[string]string{}, nil)
	if err != ErrConflict || calls != 1 {
		t.Fatalf("result %v calls %d", err, calls)
	}
}
func TestClientKeepsOnlyClosedEngineCodes(t *testing.T) {
	secret := "secret dialogue"
	accepted := "MEMORYCORE_" + strings.Repeat("A", 53)
	if len(accepted) != 64 {
		t.Fatalf("fixture length %d", len(accepted))
	}
	cases := []struct {
		name string
		body string
		want string
	}{
		{"tool", `{"code":"MEMORYCORE_TOOL_PATH","detail":"` + secret + `"}`, "MEMORYCORE_TOOL_PATH"},
		{"max", `{"code":"` + accepted + `"}`, accepted},
		{"long", `{"code":"` + accepted + `A"}`, ""},
		{"lower", `{"code":"MEMORYCORE_tool_path"}`, ""},
		{"path", `{"code":"../etc/passwd"}`, ""},
		{"text", secret, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(422)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			c, err := New(srv.URL, "private")
			if err != nil {
				t.Fatal(err)
			}
			err = c.Call(context.Background(), "rebuild-profile", map[string]string{}, nil)
			if ClosedCode(err) != tc.want || strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "passwd") {
				t.Fatalf("code %q err %q", ClosedCode(err), err.Error())
			}
			if tc.want == "" && !errors.Is(err, ErrUnavailable) {
				t.Fatalf("open code not discarded: %v", err)
			}
			if tc.want != "" && errors.Is(err, ErrUnavailable) {
				t.Fatal("closed code collapsed")
			}
		})
	}
}
func TestConflictResponseKeepsClosedProfileCode(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(409)
		_, _ = w.Write([]byte(`{"code":"MEMORYCORE_PROFILE_VERIFICATION","detail":"secret dialogue"}`))
	}))
	defer srv.Close()
	c, err := New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	err = c.Call(context.Background(), "rebuild-profile", map[string]string{}, nil)
	if ClosedCode(err) != "MEMORYCORE_PROFILE_VERIFICATION" || errors.Is(err, ErrConflict) || strings.Contains(err.Error(), "secret") {
		t.Fatalf("code %q err %v", ClosedCode(err), err)
	}
}

func TestLocalModelsReadsBoundedStatus(t *testing.T) {
	var method, path, auth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		method, path, auth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"embedding":{"model":"qwen3-embedding:0.6b","dimensions":1024,"healthy":true,"endpoint":"http://127.0.0.1:11438"},"rerank":{"model":"bge-reranker-v2-m3","deploymentEnabled":false,"healthy":false},"note":"folded bicycle downstairs"}`))
	}))
	defer srv.Close()
	c, err := New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.LocalModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if method != http.MethodGet || path != "/internal/local-models" || auth != "Bearer private" {
		t.Fatalf("request %s %s %s", method, path, auth)
	}
	if got.Embedding.Model != LocalEmbeddingModel || got.Embedding.Dimensions != LocalEmbeddingDimensions || !got.Embedding.Healthy {
		t.Fatalf("embedding %+v", got.Embedding)
	}
	if got.Rerank.Model != LocalRerankModel || got.Rerank.DeploymentEnabled || got.Rerank.Healthy {
		t.Fatalf("rerank %+v", got.Rerank)
	}
}

func TestLocalModelsDropsUpstreamFailureText(t *testing.T) {
	secret := "private memory sentence"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(secret))
	}))
	defer srv.Close()
	c, err := New(srv.URL, "private")
	if err != nil {
		t.Fatal(err)
	}
	_, err = c.LocalModels(context.Background())
	if !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), secret) {
		t.Fatalf("err %v", err)
	}
}

func TestClientRejectsRemoteEndpoint(t *testing.T) {
	if _, err := New("https://example.org", "private"); err == nil {
		t.Fatal("remote engine accepted")
	}
}
