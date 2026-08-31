package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

func TestLoginIssuesOpaqueCookieAndNoToken(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	rec := loginJSON(t, s, "alice", testPassword)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"accessToken", "refreshToken", "token"} {
		if _, ok := body[k]; ok {
			t.Fatalf("must not return %s", k)
		}
	}
	if body["accountId"] != "1" || body["role"] != "USER" {
		t.Fatalf("identity %+v", body)
	}
	if sessionCookie(rec) == "" {
		t.Fatal("missing vc_session")
	}
	if csrfCookieValue(rec) == "" {
		t.Fatal("missing vc_csrf")
	}
	joined := strings.ToLower(strings.Join(rec.Header().Values("Set-Cookie"), " "))
	if !strings.Contains(joined, "samesite=lax") || !strings.Contains(joined, "httponly") {
		t.Fatalf("cookie flags %q", rec.Header().Values("Set-Cookie"))
	}
}

func TestLoginUnknownAndWrongPasswordAreHidden(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	store.identities["disabled"] = store.identities["alice"]
	disabled := store.identities["disabled"]
	disabled.AccountID = 3
	disabled.Username = "disabled"
	disabled.Status = "DISABLED"
	store.identities["disabled"] = disabled
	s := newCoreServer(t, "full", store)
	unknown := loginJSON(t, s, "nobody", testPassword)
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown %d", unknown.Code)
	}
	assertEnvelope(t, unknown, "NOT_FOUND_OR_FORBIDDEN")
	wrong := loginJSON(t, s, "alice", "wrong-password")
	if wrong.Code != http.StatusNotFound {
		t.Fatalf("wrong %d", wrong.Code)
	}
	assertEnvelope(t, wrong, "NOT_FOUND_OR_FORBIDDEN")
	inactive := loginJSON(t, s, "disabled", testPassword)
	if inactive.Code != http.StatusNotFound {
		t.Fatalf("inactive %d", inactive.Code)
	}
	assertEnvelope(t, inactive, "NOT_FOUND_OR_FORBIDDEN")
	if unknown.Body.String() != wrong.Body.String() || wrong.Body.String() != inactive.Body.String() {
		t.Fatalf("authentication failures differ: unknown=%q wrong=%q inactive=%q",
			unknown.Body.String(), wrong.Body.String(), inactive.Body.String())
	}
	if strings.Contains(unknown.Body.String(), "nobody") || strings.Contains(wrong.Body.String(), "alice") || strings.Contains(inactive.Body.String(), "disabled") {
		t.Fatal("must not echo identity")
	}
}

func TestBearerDoesNotAuthenticateWriters(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/relationships", nil)
	req.Header.Set("Authorization", "Bearer retired-token")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer %d", rec.Code)
	}
}

func TestLogoutRevokeAndNextRequestFails(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	jar := loginCookies(t, s, "alice", testPassword)
	listed := doJSONCookies(t, s, http.MethodGet, "/api/v1/auth/sessions", "", jar)
	if listed.Code != http.StatusOK {
		t.Fatalf("list %d %s", listed.Code, listed.Body.String())
	}
	logout := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/logout", "", jar)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout %d %s", logout.Code, logout.Body.String())
	}
	again := doJSONCookies(t, s, http.MethodGet, "/api/v1/auth/sessions", "", jar)
	if again.Code != http.StatusUnauthorized {
		t.Fatalf("after logout %d %s", again.Code, again.Body.String())
	}
	assertEnvelope(t, again, "AUTHENTICATION_REQUIRED")
}

func TestLogoutRevokeFailureKeepsCookiesAndSession(t *testing.T) {
	t.Parallel()
	store := &logoutRevokeErrorStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	jar := loginCookies(t, s, "alice", testPassword)

	logout := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/logout", "", jar)
	if logout.Code != http.StatusServiceUnavailable {
		t.Fatalf("logout %d %s", logout.Code, logout.Body.String())
	}
	assertEnvelope(t, logout, "INVALID_REQUEST")
	if cookies := logout.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("failed logout must not clear cookies: %+v", cookies)
	}
	stillValid := doJSONCookies(t, s, http.MethodGet, "/api/v1/auth/sessions", "", jar)
	if stillValid.Code != http.StatusOK {
		t.Fatalf("session after failed logout %d %s", stillValid.Code, stillValid.Body.String())
	}
}

func TestRevokeSessionAndPasswordChangeInvalidate(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	jar := loginCookies(t, s, "alice", testPassword)
	listed := doJSONCookies(t, s, http.MethodGet, "/api/v1/auth/sessions", "", jar)
	var sessions []map[string]any
	if err := json.Unmarshal(listed.Body.Bytes(), &sessions); err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0]["current"] != true {
		t.Fatalf("sessions %v", sessions)
	}
	sid := sessions[0]["id"].(string)
	rev := doJSONCookies(t, s, http.MethodDelete, "/api/v1/auth/sessions/"+sid, "", jar)
	if rev.Code != http.StatusOK {
		t.Fatalf("revoke %d %s", rev.Code, rev.Body.String())
	}
	if doJSONCookies(t, s, http.MethodGet, "/api/v1/relationships", "", jar).Code != http.StatusUnauthorized {
		t.Fatal("revoked cookie must fail")
	}

	jar = loginCookies(t, s, "alice", testPassword)
	chg := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/password", `{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`, jar)
	if chg.Code != http.StatusOK {
		t.Fatalf("password %d %s", chg.Code, chg.Body.String())
	}
	if doJSONCookies(t, s, http.MethodGet, "/api/v1/relationships", "", jar).Code != http.StatusUnauthorized {
		t.Fatal("password change must revoke")
	}
	fresh := loginJSON(t, s, "alice", "test-pass-2")
	if fresh.Code != http.StatusOK {
		t.Fatalf("relogin %d %s", fresh.Code, fresh.Body.String())
	}
}

func TestReauthRecordsFreshness(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	jar := loginCookies(t, s, "alice", testPassword)
	rec := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/reauth", `{"password":"`+testPassword+`"}`, jar)
	if rec.Code != http.StatusOK {
		t.Fatalf("reauth %d %s", rec.Code, rec.Body.String())
	}
	token := jar[auth.SessionCookieName]
	p, err := store.Lookup(t.Context(), token)
	if err != nil || p == nil {
		t.Fatalf("lookup %v %v", p, err)
	}
	if p.ReauthAt.IsZero() {
		t.Fatal("reauth_at")
	}
	if !auth.FreshReauth(p, p.ReauthAt.Add(time.Minute), auth.DefaultReauthWindow) {
		t.Fatal("fresh window")
	}
}

func TestLoginRequiresExactOrigin(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"alice","password":"`+testPassword+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("origin %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
}

func TestAuthErrorEnvelopeHasNoDetails(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	rec := loginJSON(t, s, "alice", "nope")
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if _, ok := env["details"]; ok {
		t.Fatalf("details %v", env)
	}
	if env["code"] != "NOT_FOUND_OR_FORBIDDEN" {
		t.Fatalf("%v", env)
	}
}

func TestWriteRateLimitedRoundsRetryAfterUp(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name  string
		retry time.Duration
		want  string
	}{
		{name: "fractional second", retry: 1500 * time.Millisecond, want: "2"},
		{name: "exact second", retry: time.Second, want: "1"},
		{name: "subsecond", retry: time.Millisecond, want: "1"},
		{name: "zero", retry: 0, want: "1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			(&Server{}).writeRateLimited(rec, tt.retry)
			if rec.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusTooManyRequests)
			}
			if got := rec.Header().Get("Retry-After"); got != tt.want {
				t.Fatalf("Retry-After = %q, want %q", got, tt.want)
			}
			assertEnvelope(t, rec, "AUTH_RATE_LIMITED")
		})
	}
}

func TestAdmitAuthUsesConfiguredRequestSource(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		trustProxy  bool
		wantAllowed int
	}{
		{name: "direct peer remains one source", trustProxy: false, wantAllowed: 10},
		{name: "trusted forwarded peers are distinct sources", trustProxy: true, wantAllowed: 11},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newCoreServer(t, "full", newMemStore())
			s.cfg.HTTP.TrustProxyHeaders = tt.trustProxy
			allowed := 0
			for i := 0; i < 11; i++ {
				req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
				req.RemoteAddr = "10.0.0.10:1234"
				req.Header.Set("X-Forwarded-For", fmt.Sprintf("192.0.2.%d", i+1))
				rec := httptest.NewRecorder()
				if s.admitAuth(rec, req, "login", fmt.Sprintf("account-%d", i)) {
					allowed++
				}
			}
			if allowed != tt.wantAllowed {
				t.Fatalf("allowed=%d want=%d", allowed, tt.wantAllowed)
			}
		})
	}
}

func TestAPIMigrationDoesNotServeAuthWriters(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "api-migration", newMemStore())
	rec := loginJSON(t, s, "alice", testPassword)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration login %d", rec.Code)
	}
}

func loginJSON(t *testing.T, s *Server, username, password string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"username":"` + username + `","password":"` + password + `"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://vc.test")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func loginCookies(t *testing.T, s *Server, username, password string) map[string]string {
	t.Helper()
	rec := loginJSON(t, s, username, password)
	if rec.Code != http.StatusOK {
		t.Fatalf("login %d %s", rec.Code, rec.Body.String())
	}
	jar := map[string]string{}
	for _, c := range rec.Result().Cookies() {
		jar[c.Name] = c.Value
	}
	if jar[auth.SessionCookieName] == "" {
		t.Fatal("session cookie")
	}
	return jar
}

func doJSONCookies(t *testing.T, s *Server, method, path, body string, jar map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr *strings.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	var req *http.Request
	if rdr != nil {
		req = httptest.NewRequest(method, path, rdr)
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	for name, val := range jar {
		req.AddCookie(&http.Cookie{Name: name, Value: val})
	}
	if isStateChanging(method) {
		req.Header.Set("Origin", "https://vc.test")
		if csrf := jar[csrfCookie]; csrf != "" {
			req.Header.Set(csrfHeader, csrf)
		}
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func sessionCookie(rec *httptest.ResponseRecorder) string {
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.SessionCookieName {
			return c.Value
		}
	}
	return ""
}

func csrfCookieValue(rec *httptest.ResponseRecorder) string {
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.CSRFCookieName {
			return c.Value
		}
	}
	return ""
}

type logoutRevokeErrorStore struct {
	*memStore
}

func (s *logoutRevokeErrorStore) RevokeOpaqueSessionHash(context.Context, string) error {
	return errors.New("synthetic revoke failure")
}
