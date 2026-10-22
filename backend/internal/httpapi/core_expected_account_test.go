package httpapi

// VC-R52 regression suite: the shared-cookie stale-tab guard on
// corePrincipal. In one browser cookie jar, a stale tab still rendered for
// account A must not execute business effects with account B's session after
// B logs in from another tab. The server-side contract is the
// X-VC-Expected-Account-ID precondition: writes must carry the header and it
// must equal the cookie principal's account id; reads keep the historical
// header-less behavior but, when a value is present, it must match.
//
// Safety constraints for these tests: assertions only use status codes,
// booleans, counts and field presence; no cookie, CSRF, token or password
// value ever reaches a log or failure message. Failure messages never print
// raw response bodies: a regressed mismatch write answers 200 and its body
// would carry the one-time downloadUrl token.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// issueSessionCookie creates an opaque session for account and returns it as
// a request cookie so a single long-lived session can be reused across
// requests (required to prove a rejected write leaves the session untouched).
func issueSessionCookie(t *testing.T, s *Server, account int64) *http.Cookie {
	t.Helper()
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.core.Store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: auth.SessionCookieName, Value: raw}
}

// sendWithExpectedAccount performs a state-changing core request through the
// real HTTP entry: account's session cookie, the fixture Origin/CSRF pair,
// and the expected-account header set to expected (empty omits the header).
func sendWithExpectedAccount(t *testing.T, s *Server, method, path, body string, session *http.Cookie, expected string) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.AddCookie(session)
	req.Header.Set("Origin", "https://vc.test")
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	req.Header.Set(csrfHeader, "csrf-token")
	if expected != "" {
		req.Header.Set(expectedAccountHeader, expected)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

// assertContextChangedEnvelope checks the 409 envelope without ever printing
// the raw body (known code comparison only).
func assertContextChangedEnvelope(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var env struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal("error envelope was not valid JSON")
	}
	if env.Code != "ACCOUNT_CONTEXT_CHANGED" {
		t.Fatalf("error envelope code %q want %q", env.Code, "ACCOUNT_CONTEXT_CHANGED")
	}
	if env.Message == "" {
		t.Fatal("error envelope message empty")
	}
}

func TestExpectedAccountMismatchAndMissingRejectExportWrite(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	// Tab B holds a live session; the stale tab page is rendered for account 1.
	bobSession := issueSessionCookie(t, s, 2)
	exportBody := `{"currentPassword":"` + testPassword + `"}`

	for name, expected := range map[string]string{"stale page header": "1", "missing header": ""} {
		rec := sendWithExpectedAccount(t, s, http.MethodPost, "/api/v1/exports", exportBody, bobSession, expected)
		if rec.Code != http.StatusConflict {
			t.Fatalf("%s: export status %d", name, rec.Code)
		}
		assertContextChangedEnvelope(t, rec)
		if cookies := rec.Result().Cookies(); len(cookies) != 0 {
			t.Fatalf("%s: rejected write must not set cookies: %d", name, len(cookies))
		}
	}

	store.mu.Lock()
	exports := len(store.exports)
	store.mu.Unlock()
	if exports != 0 {
		t.Fatalf("no export may be created, got %d", exports)
	}

	// B's session is untouched: the guard rejects before any effects and
	// revokes nothing.
	listed := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/auth/sessions", "", bobSession, "2")
	// The GET above is a read: Origin/CSRF headers are harmless extras.
	if listed.Code != http.StatusOK {
		t.Fatalf("session after rejections status %d", listed.Code)
	}

	// The same session with the correct expected account completes the write.
	ok := sendWithExpectedAccount(t, s, http.MethodPost, "/api/v1/exports", exportBody, bobSession, "2")
	if ok.Code != http.StatusOK {
		t.Fatalf("matching export status %d", ok.Code)
	}
	store.mu.Lock()
	exports = len(store.exports)
	store.mu.Unlock()
	if exports != 1 {
		t.Fatalf("matching export must create exactly one export, got %d", exports)
	}
}

func TestExpectedAccountMismatchRejectsPasswordChangeAndAccountDelete(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	bobSession := issueSessionCookie(t, s, 2)

	// A successful password change revokes all of the account's sessions, so
	// the surviving session is the effect witness for the pre-effects reject.
	password := sendWithExpectedAccount(t, s, http.MethodPost, "/api/v1/auth/password",
		`{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`, bobSession, "1")
	if password.Code != http.StatusConflict {
		t.Fatalf("password change status %d", password.Code)
	}
	assertContextChangedEnvelope(t, password)

	deleted := sendWithExpectedAccount(t, s, http.MethodDelete, "/api/v1/auth/account",
		`{"currentPassword":"`+testPassword+`"}`, bobSession, "1")
	if deleted.Code != http.StatusConflict {
		t.Fatalf("account delete status %d", deleted.Code)
	}
	assertContextChangedEnvelope(t, deleted)
	intent, err := store.DeletionIntentActive(context.Background(), 2)
	if err != nil || intent {
		t.Fatalf("no deletion intent may be recorded: active=%v err=%v", intent, err)
	}

	listed := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/auth/sessions", "", bobSession, "2")
	if listed.Code != http.StatusOK {
		t.Fatalf("session after rejected sensitive writes status %d", listed.Code)
	}
}

func TestExpectedAccountHeaderKeepsForcedPasswordChangeFlow(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	ident := store.identities["alice@example.com"]
	ident.PasswordMustChange = true
	store.identities["alice@example.com"] = ident
	s := newCoreServer(t, "full", store)
	jar := loginCookies(t, s, "alice", testPassword)
	session := &http.Cookie{Name: auth.SessionCookieName, Value: jar[auth.SessionCookieName]}

	// A context mismatch wins over the password-change gate even while the
	// must-change flag is set, and must not consume the forced change.
	foreign := sendWithExpectedAccount(t, s, http.MethodPost, "/api/v1/auth/password",
		`{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`, session, "2")
	if foreign.Code != http.StatusConflict {
		t.Fatalf("forced password change with foreign header status %d", foreign.Code)
	}
	assertContextChangedEnvelope(t, foreign)

	// The first-login forced password change still completes when the page
	// states its own account id (doJSONCookies derives header "1" from the
	// session).
	changed := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/password",
		`{"currentPassword":"`+testPassword+`","newPassword":"test-pass-2"}`, jar)
	if changed.Code != http.StatusOK {
		t.Fatalf("forced password change status %d", changed.Code)
	}
}

func TestExpectedAccountHeaderOnReads(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	alice := issueSessionCookie(t, s, 1)

	matching := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/relationships", "", alice, "1")
	if matching.Code != http.StatusOK {
		t.Fatalf("read with matching header status %d", matching.Code)
	}

	foreign := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/relationships", "", alice, "2")
	if foreign.Code != http.StatusConflict {
		t.Fatalf("read with foreign header status %d", foreign.Code)
	}
	assertContextChangedEnvelope(t, foreign)

	absent := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/relationships", "", alice, "")
	if absent.Code != http.StatusOK {
		t.Fatalf("header-less read status %d", absent.Code)
	}
}
