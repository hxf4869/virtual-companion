package httpapi

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
)

type staticProbes struct{ live, ready bool }

func (s staticProbes) Live() bool  { return s.live }
func (s staticProbes) Ready() bool { return s.ready }

func TestHealthAndReadiness(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: false})
	assertStatus(t, s, "/actuator/health", http.StatusOK, `"status":"UP"`)
	assertStatus(t, s, "/actuator/health/liveness", http.StatusOK, `"status":"UP"`)
	assertStatus(t, s, "/actuator/health/readiness", http.StatusServiceUnavailable, `"status":"DOWN"`)
}

func TestVersion(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: true})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/version", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["version"] != "test-version" || body["commit"] != "deadbeef" {
		t.Fatalf("body %+v", body)
	}
}

func TestPrometheusProcessMetrics(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: true})
	s.Handler().ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/actuator/health", nil))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/actuator/prometheus", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{
		"go_goroutines",
		"process_cpu_seconds_total",
		`vc_http_requests_total{handler="health"`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %q in:\n%s", want, body)
		}
	}
}

func TestRequestIDEchoAndSanitize(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: true})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("X-Request-Id", "ok_token-1")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Header().Get("X-Request-Id") != "ok_token-1" {
		t.Fatalf("echo %q", rec.Header().Get("X-Request-Id"))
	}

	bad := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	bad.Header.Set("X-Request-Id", "bad\ninject")
	badRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(badRec, bad)
	got := badRec.Header().Get("X-Request-Id")
	if got == "bad\ninject" || got == "" {
		t.Fatalf("sanitized request id %q", got)
	}
}

func TestUnmappedAndWritesAreNotRegistered(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: true})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/generations", strings.NewReader(`{}`)))
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("write route must be unavailable, got %d", rec.Code)
	}
	getRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/v1/conversations", nil))
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("unmapped GET %d", getRec.Code)
	}
}

func newServer(t *testing.T, probes Probes) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "api-migration"
		case "VC_VERSION":
			return "test-version"
		case "VC_COMMIT":
			return "deadbeef"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, observability.NewLogger("error", io.Discard), probes, observability.NewRegistry())
}

func assertStatus(t *testing.T, s *Server, path string, code int, contains string) {
	t.Helper()
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	if rec.Code != code {
		t.Fatalf("%s code %d want %d body %s", path, rec.Code, code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), contains) {
		t.Fatalf("%s body %s want %s", path, rec.Body.String(), contains)
	}
}
