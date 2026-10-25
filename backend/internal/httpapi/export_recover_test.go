package httpapi

// R214-C: POST /api/v1/exports/recover re-arms the caller's most recent
// unclaimed export with a fresh one-time token. The route shares create's
// write gates and password check; these tests pin the user-visible contract:
// the SELECTED request is re-armed in place (id / status / requestedAt
// unchanged, nothing new created), the superseded token is dead, status reads
// stay token-less, a consumed copy is never revived, and every rejection shape
// leaves the stored token untouched. Assertions compare tokens, never print
// them.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const exportRecoverBody = `{"currentPassword":"` + testPassword + `"}`

// storedExportToken reads the fake's at-rest one-time token so tests can
// assert rotation (or its absence) without ever printing the value.
func storedExportToken(store *memStore, id int64) string {
	store.mu.Lock()
	defer store.mu.Unlock()
	return store.exportTok[id]
}

func TestExportRecoverReissuesTokenForSameRequest(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)

	created := doJSON(t, s, http.MethodPost, "/api/v1/exports", exportRecoverBody, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("export create %d", created.Code)
	}
	var first exportJSON
	if err := json.Unmarshal(created.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	id := mustParseID(t, first.ExportID)

	recovered := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", exportRecoverBody, 1)
	if recovered.Code != http.StatusOK {
		t.Fatalf("recover %d", recovered.Code)
	}
	var again exportJSON
	if err := json.Unmarshal(recovered.Body.Bytes(), &again); err != nil {
		t.Fatal(err)
	}
	// Same request, not a new copy: id, status and requestedAt are unchanged
	// (requestedAt is what the UI shows to recognise the request); only the
	// one-time token and therefore the URL differ.
	if again.ExportID != first.ExportID || again.Status != "PENDING" || again.RequestedAt != first.RequestedAt {
		t.Fatalf("recover must re-arm the same PENDING request: id=%s status=%s", again.ExportID, again.Status)
	}
	if again.DownloadToken == nil || *again.DownloadToken == "" || *again.DownloadToken == *first.DownloadToken {
		t.Fatal("recover must issue a fresh one-time token")
	}
	if again.DownloadURL == nil || !strings.Contains(*again.DownloadURL, "/api/v1/exports/"+first.ExportID+"/download?token=") {
		t.Fatal("recover must return the one-time download url of the same export")
	}
	if storedExportToken(store, id) != *again.DownloadToken {
		t.Fatal("stored token must be the re-issued one")
	}

	// Status reads never carry a token or URL, recovery or not.
	status := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+first.ExportID, "", 1)
	if status.Code != http.StatusOK {
		t.Fatalf("status %d", status.Code)
	}
	if strings.Contains(status.Body.String(), "downloadToken") || strings.Contains(status.Body.String(), "downloadUrl") {
		t.Fatal("status leaked token or url")
	}

	if err := store.CompleteExport(context.Background(), 1, id, `{"exportId":"1","conversations":[]}`, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	old := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+first.ExportID+"/download?token="+*first.DownloadToken, "", 1)
	if old.Code != http.StatusNotFound {
		t.Fatalf("superseded token download %d", old.Code)
	}
	assertEnvelope(t, old, "NOT_FOUND_OR_FORBIDDEN")
	fresh := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+first.ExportID+"/download?token="+*again.DownloadToken, "", 1)
	if fresh.Code != http.StatusOK {
		t.Fatalf("re-issued token download %d", fresh.Code)
	}
	twice := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+first.ExportID+"/download?token="+*again.DownloadToken, "", 1)
	if twice.Code != http.StatusNotFound {
		t.Fatalf("second download %d", twice.Code)
	}

	// A consumed copy cannot be re-armed.
	consumed := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", exportRecoverBody, 1)
	if consumed.Code != http.StatusNotFound {
		t.Fatalf("recover after consume %d", consumed.Code)
	}
	assertEnvelope(t, consumed, "NOT_FOUND_OR_FORBIDDEN")
	if storedExportToken(store, id) != "" {
		t.Fatal("consumed export must stay consumed")
	}
}

func TestExportRecoverPasswordAndEligibilityShareNotFound(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)

	// Nothing claimable yet: the correct password still answers the
	// undisclosed 404, exactly like a consumed or absent export would.
	none := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", exportRecoverBody, 1)
	if none.Code != http.StatusNotFound {
		t.Fatalf("recover with nothing claimable %d", none.Code)
	}
	assertEnvelope(t, none, "NOT_FOUND_OR_FORBIDDEN")

	created := doJSON(t, s, http.MethodPost, "/api/v1/exports", exportRecoverBody, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("export create %d", created.Code)
	}
	var exp exportJSON
	if err := json.Unmarshal(created.Body.Bytes(), &exp); err != nil {
		t.Fatal(err)
	}
	id := mustParseID(t, exp.ExportID)
	before := storedExportToken(store, id)

	// A missing or empty password is a malformed request, never a rotation.
	for _, body := range []string{``, `{}`, `{"currentPassword":""}`} {
		rec := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", body, 1)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %q: status %d", body, rec.Code)
		}
		assertEnvelope(t, rec, "INVALID_REQUEST")
	}
	// A wrong password answers the same 404 as a wrong-password create.
	wrong := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", `{"currentPassword":"nope"}`, 1)
	if wrong.Code != http.StatusNotFound {
		t.Fatalf("wrong password %d", wrong.Code)
	}
	assertEnvelope(t, wrong, "NOT_FOUND_OR_FORBIDDEN")
	if strings.Contains(wrong.Body.String(), "nope") || strings.Contains(wrong.Body.String(), testPassword) {
		t.Fatal("password leaked")
	}
	if storedExportToken(store, id) != before {
		t.Fatal("rejected recover must not rotate the token")
	}

	// An account under deletion is refused with the same code and no effect.
	store.mu.Lock()
	store.deleting = true
	store.mu.Unlock()
	deleting := doJSON(t, s, http.MethodPost, "/api/v1/exports/recover", exportRecoverBody, 1)
	if deleting.Code != http.StatusNotFound {
		t.Fatalf("recover during deletion %d", deleting.Code)
	}
	assertEnvelope(t, deleting, "NOT_FOUND_OR_FORBIDDEN")
	if storedExportToken(store, id) != before {
		t.Fatal("recover during deletion must not rotate the token")
	}
}

func TestExportRecoverWriteGatesRejectBeforeEffects(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	exp, err := store.CreateExport(context.Background(), 1, "fixture-token-1")
	if err != nil {
		t.Fatal(err)
	}
	before := storedExportToken(store, exp.ID)

	// Foreign Origin on the write.
	origin := httptest.NewRequest(http.MethodPost, "/api/v1/exports/recover", strings.NewReader(exportRecoverBody))
	origin.Header.Set("Content-Type", "application/json")
	attachAuth(t, s, origin, 1, false)
	origin.Header.Set("Origin", "https://evil.example")
	origin.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	origin.Header.Set(csrfHeader, "csrf-token")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, origin)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")

	// CSRF cookie present without the matching header.
	csrf := httptest.NewRequest(http.MethodPost, "/api/v1/exports/recover", strings.NewReader(exportRecoverBody))
	csrf.Header.Set("Content-Type", "application/json")
	attachAuth(t, s, csrf, 1, false)
	csrf.Header.Set("Origin", "https://vc.test")
	csrf.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, csrf)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing csrf header %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")

	// No session cookie at all (Origin and the CSRF pair are valid, so the
	// authentication gate is the one that answers).
	anon := httptest.NewRequest(http.MethodPost, "/api/v1/exports/recover", strings.NewReader(exportRecoverBody))
	anon.Header.Set("Content-Type", "application/json")
	anon.Header.Set("Origin", "https://vc.test")
	anon.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	anon.Header.Set(csrfHeader, "csrf-token")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous %d", rec.Code)
	}
	assertEnvelope(t, rec, "AUTHENTICATION_REQUIRED")

	if storedExportToken(store, exp.ID) != before {
		t.Fatal("rejected writes must not rotate the token")
	}
}

func TestExportRecoverBlockedByForcedPasswordChange(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	ident := store.identities["alice@example.com"]
	ident.PasswordMustChange = true
	store.identities["alice@example.com"] = ident
	s := newCoreServer(t, "full", store)
	exp, err := store.CreateExport(context.Background(), 1, "fixture-token-1")
	if err != nil {
		t.Fatal(err)
	}
	before := storedExportToken(store, exp.ID)

	jar := loginCookies(t, s, "alice", testPassword)
	session := &http.Cookie{Name: auth.SessionCookieName, Value: jar[auth.SessionCookieName]}
	identity := sendWithExpectedAccount(t, s, http.MethodGet, "/api/v1/auth/session", "", session, "1", "")
	if identity.Code != http.StatusOK {
		t.Fatalf("session identity status %d", identity.Code)
	}
	var identityBody struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(identity.Body.Bytes(), &identityBody); err != nil || identityBody.SessionID == "" {
		t.Fatal("identity response must expose sessionId")
	}

	// The forced-change gate applies to recover like every other core write.
	rec := sendWithExpectedAccount(t, s, http.MethodPost, "/api/v1/exports/recover", exportRecoverBody, session, "1", identityBody.SessionID)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("recover under forced password change %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
	if storedExportToken(store, exp.ID) != before {
		t.Fatal("gated recover must not rotate the token")
	}
}
