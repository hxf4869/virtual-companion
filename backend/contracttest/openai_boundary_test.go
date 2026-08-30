package contracttest

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
)

func TestRedirectDoesNotFollowOrMoveCredential(t *testing.T) {
	t.Parallel()
	var evilCalls atomic.Int32
	var evilAuth atomic.Value
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		evilCalls.Add(1)
		evilAuth.Store(r.Header.Get("Authorization"))
		writeJSON(w, completionJSON("from-evil", "stop", 1, 1))
	}))
	t.Cleanup(evil.Close)

	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, evil.URL+"/v1/chat/completions", http.StatusFound)
	})
	_, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "redirect"))
	if result != (companion.AttemptResult{}) {
		t.Fatalf("result %+v", result)
	}
	requireCode(t, err, companion.CodeMalformed)
	mustNoSecret(t, err.Error())
	if evilCalls.Load() != 0 {
		t.Fatalf("followed redirect, auth=%v", evilAuth.Load())
	}
}

func TestResponseAndOutputLimits(t *testing.T) {
	t.Parallel()
	t.Run("singleEvent", func(t *testing.T) {
		t.Parallel()
		oversized := sse(choiceChunk(ptr(strings.Repeat("a", 80)), nil))
		m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
			writeSSE(w, oversized+sse(choiceChunk(nil, ptr("stop")))+sse(usageChunk(1, 1))+done())
		})
		a := testAdapter(t, m.endpoint(), func(cfg *openai.Config) {
			cfg.MaxResponseBytes = 64
		})
		_, result, err := collect(t, a, textReq(true, "limit"))
		if result != (companion.AttemptResult{}) {
			t.Fatalf("result %+v", result)
		}
		requireCode(t, err, companion.CodeMalformed)
	})
	t.Run("cumulativeOutput", func(t *testing.T) {
		t.Parallel()
		m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
			writeSSE(w, sse(choiceChunk(ptr(strings.Repeat("a", 40)), nil))+
				sse(choiceChunk(ptr(strings.Repeat("b", 40)), nil))+
				sse(choiceChunk(nil, ptr("stop")))+
				sse(usageChunk(1, 1))+
				done())
		})
		a := testAdapter(t, m.endpoint(), func(cfg *openai.Config) {
			cfg.MaxResponseBytes = 64
		})
		_, result, err := collect(t, a, textReq(true, "limit"))
		if result != (companion.AttemptResult{}) {
			t.Fatalf("result %+v", result)
		}
		requireCode(t, err, companion.CodeMalformed)
	})
	t.Run("nonStreamBody", func(t *testing.T) {
		t.Parallel()
		body := completionJSON(strings.Repeat("x", 200), "stop", 1, 1)
		m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, body)
		})
		a := testAdapter(t, m.endpoint(), func(cfg *openai.Config) {
			cfg.MaxResponseBytes = 64
		})
		_, result, err := collect(t, a, textReq(false, "limit"))
		if result != (companion.AttemptResult{}) {
			t.Fatalf("result %+v", result)
		}
		requireCode(t, err, companion.CodeMalformed)
	})
}

func TestInvalidRequestDoesNotHitNetwork(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("adapter must not send an invalid request")
		w.WriteHeader(http.StatusInternalServerError)
	})
	a := testAdapter(t, m.endpoint(), nil)
	_, _, err := collect(t, a, companion.ModelRequest{
		Messages: []companion.Message{{Role: companion.RoleUser, Content: strings.Repeat("m", 64<<10+1)}},
	})
	requireCode(t, err, companion.CodeInvalidRequest)
	if m.calls.Load() != 0 {
		t.Fatalf("network calls %d", m.calls.Load())
	}
}

func TestAdapterSourcesHaveNoDefaultEndpointOrCredential(t *testing.T) {
	t.Parallel()
	root := findRepoRoot(t)
	dir := filepath.Join(root, "backend", "internal", "provider", "openai")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".go") || strings.HasSuffix(e.Name(), "_test.go") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		src := string(raw)
		if strings.Contains(src, "api.openai.com") || strings.Contains(src, "sk-") {
			t.Fatalf("%s must not hard-code a supplier host or key prefix", e.Name())
		}
		if strings.Contains(src, "os.Getenv") || strings.Contains(src, "os.LookupEnv") {
			t.Fatalf("%s must not read the environment", e.Name())
		}
	}
	for _, rel := range []string{
		filepath.Join("backend", "cmd", "companiond", "main.go"),
		filepath.Join("backend", "internal", "app", "app.go"),
	} {
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "internal/provider/openai") {
			t.Fatalf("%s must not wire the provider adapter in G4", rel)
		}
	}
}

func TestCredentialNotInLogsOrErrors(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":"`+offlineToken+`"}`)
	})
	_, _, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "auth"))
	requireCode(t, err, companion.CodeMalformed)
	mustNoSecret(t, err.Error())
}

func findRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "backend", "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatal("repository root not found")
	return ""
}
