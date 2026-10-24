package httpapi

// VC-R169 regression suite: the stale-tab guard extends from the account
// precondition to the concrete opaque session. In one browser cookie jar a
// same-account relogin installs session S2; a page still committed to S1 must
// not run business effects with the S2 cookie. The server-side contract is the
// X-VC-Expected-Session-ID precondition: authenticated writes must carry the
// header and it must equal the cookie session id; reads keep the historical
// header-less behavior but, when a value is present, it must match. The
// session id is the existing non-credential identity_opaque_session id, and
// identity responses expose it as a decimal string so the page can commit to
// it.
//
// Safety constraints: assertions only use status codes, booleans, counts and
// field presence; no cookie, CSRF, token or password value ever reaches a log
// or failure message.

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const expectedSessionHeaderName = "X-VC-Expected-Session-ID"

// issueSessionWithID creates an opaque session for account and returns the
// request cookie together with the session id (decimal string) the page would
// commit to.
func issueSessionWithID(t *testing.T, s *Server, account int64) (*http.Cookie, string) {
	t.Helper()
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	sessionID, err := s.core.Store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	cookie := &http.Cookie{Name: auth.SessionCookieName, Value: raw}
	return cookie, strconv.FormatInt(sessionID, 10)
}

// sendWithExpectedSession performs a core request through the real HTTP entry
// with the given expected-session value (empty omits the header).
func sendWithExpectedSession(t *testing.T, s *Server, method, path, body string, session *http.Cookie, account, expectedSession string) *httptest.ResponseRecorder {
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
	if account != "" {
		req.Header.Set(expectedAccountHeader, account)
	}
	if expectedSession != "" {
		req.Header.Set(expectedSessionHeaderName, expectedSession)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestExpectedSessionStaleIDRejectsWriteWithoutEffects(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	// Same account, two sessions: the relogin installed S2; the stale page is
	// still committed to S1.
	_, staleID := issueSessionWithID(t, s, 2)
	liveCookie, liveID := issueSessionWithID(t, s, 2)
	if staleID == liveID {
		t.Fatal("fixture sessions must have distinct ids")
	}
	exportBody := `{"currentPassword":"` + testPassword + `"}`

	// Both rejecting shapes run unconditionally (no map short-circuit): the
	// stale committed id and the missing header each must 409 without
	// cookies, and the checks below observe both.
	rejections := []struct {
		name     string
		expected string
	}{
		{"stale session id", staleID},
		{"missing header", ""},
	}
	for _, tc := range rejections {
		rec := sendWithExpectedSession(t, s, http.MethodPost, "/api/v1/exports", exportBody, liveCookie, "2", tc.expected)
		if rec.Code != http.StatusConflict {
			t.Errorf("%s: export status %d", tc.name, rec.Code)
			continue
		}
		assertContextChangedEnvelope(t, rec)
		if cookies := rec.Result().Cookies(); len(cookies) != 0 {
			t.Errorf("%s: rejected write must not set cookies: %d", tc.name, len(cookies))
		}
	}

	store.mu.Lock()
	exports := len(store.exports)
	store.mu.Unlock()
	if exports != 0 {
		t.Fatalf("no export may be created, got %d", exports)
	}

	// The live session is untouched: the guard rejects before any effects.
	listed := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/auth/sessions", "", liveCookie, "2", liveID)
	if listed.Code != http.StatusOK {
		t.Fatalf("session list after rejections status %d", listed.Code)
	}

	// The same session with the matching expected session id completes the
	// write (control: S2 remains fully usable).
	ok := sendWithExpectedSession(t, s, http.MethodPost, "/api/v1/exports", exportBody, liveCookie, "2", liveID)
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

func TestExpectedSessionHeaderOnReads(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	cookie, sessionID := issueSessionWithID(t, s, 1)

	matching := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/relationships", "", cookie, "1", sessionID)
	if matching.Code != http.StatusOK {
		t.Fatalf("read with matching session header status %d", matching.Code)
	}

	stale := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/relationships", "", cookie, "1", "999999")
	if stale.Code != http.StatusConflict {
		t.Fatalf("read with stale session header status %d", stale.Code)
	}
	assertContextChangedEnvelope(t, stale)

	absent := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/relationships", "", cookie, "1", "")
	if absent.Code != http.StatusOK {
		t.Fatalf("header-less read status %d", absent.Code)
	}
}

func TestSessionIdentityCarriesSessionID(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	jar := loginCookies(t, s, "alice", testPassword)
	cookie := &http.Cookie{Name: auth.SessionCookieName, Value: jar[auth.SessionCookieName]}

	identity := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/auth/session", "", cookie, "1", "")
	if identity.Code != http.StatusOK {
		t.Fatalf("session identity status %d", identity.Code)
	}
	var body struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(identity.Body.Bytes(), &body); err != nil {
		t.Fatal("identity response was not valid JSON")
	}
	if body.SessionID == "" {
		t.Fatal("identity response must expose the non-credential sessionId")
	}
	if _, err := strconv.ParseInt(body.SessionID, 10, 64); err != nil {
		t.Fatal("identity sessionId must be a decimal string")
	}

	// The exposed id is the live session itself: it matches the current
	// entry of the public sessions list.
	listed := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/auth/sessions", "", cookie, "1", body.SessionID)
	if listed.Code != http.StatusOK {
		t.Fatalf("sessions list status %d", listed.Code)
	}
	var sessions []struct {
		ID      string `json:"id"`
		Current bool   `json:"current"`
	}
	if err := json.Unmarshal(listed.Body.Bytes(), &sessions); err != nil {
		t.Fatal("sessions list was not valid JSON")
	}
	current := ""
	for _, entry := range sessions {
		if entry.Current {
			current = entry.ID
		}
	}
	if current == "" {
		t.Fatal("sessions list has no current entry")
	}
	if current != body.SessionID {
		t.Fatal("identity sessionId does not match the current list session")
	}

	// Committing to the exposed id lets the read pass, which is the exact
	// value a page holds after login/discovery.
	ok := sendWithExpectedSession(t, s, http.MethodGet, "/api/v1/relationships", "", cookie, "1", body.SessionID)
	if ok.Code != http.StatusOK {
		t.Fatalf("read committed to exposed session id status %d", ok.Code)
	}
}
