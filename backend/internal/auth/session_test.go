package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCookieToken(t *testing.T) {
	t.Parallel()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "abc_DEF-123"})
	if CookieToken(req) != "abc_DEF-123" {
		t.Fatal("ok")
	}
	bad := httptest.NewRequest(http.MethodGet, "/", nil)
	bad.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "has space"})
	if CookieToken(bad) != "" {
		t.Fatal("space")
	}
	long := httptest.NewRequest(http.MethodGet, "/", nil)
	long.AddCookie(&http.Cookie{Name: SessionCookieName, Value: strings.Repeat("a", maxSessionCookieBytes+1)})
	if CookieToken(long) != "" {
		t.Fatal("long")
	}
}

func TestNewSessionTokenIs256BitAndHashed(t *testing.T) {
	t.Parallel()
	raw, hash, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(raw) < 43 {
		t.Fatalf("raw too short %d", len(raw))
	}
	if TokenHash(raw) != hash {
		t.Fatal("hash mismatch")
	}
	if hash == raw || len(hash) != 64 {
		t.Fatal("must persist only sha256 hex")
	}
	other, _, err := NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	if other == raw {
		t.Fatal("tokens must be unique")
	}
}

func TestFreshReauthWindow(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC)
	p := &Principal{ReauthAt: now.Add(-5 * time.Minute)}
	if !FreshReauth(p, now, DefaultReauthWindow) {
		t.Fatal("fresh")
	}
	p.ReauthAt = now.Add(-16 * time.Minute)
	if FreshReauth(p, now, DefaultReauthWindow) {
		t.Fatal("stale")
	}
	if FreshReauth(nil, now, DefaultReauthWindow) || FreshReauth(&Principal{}, now, DefaultReauthWindow) {
		t.Fatal("missing")
	}
}
