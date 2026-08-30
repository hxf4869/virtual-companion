package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
