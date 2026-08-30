package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const (
	csrfCookie    = "vc_csrf"
	csrfHeader    = "X-CSRF-Token"
	refreshCookie = "vc_refresh"
)

func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) < 8 {
		return ""
	}
	if !strings.EqualFold(h[:7], "Bearer ") {
		return ""
	}
	return strings.TrimSpace(h[7:])
}

func isStateChanging(method string) bool {
	switch strings.ToUpper(method) {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func apiOriginAllowed(origin string, allowed []string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	return auth.AllowOrigin(origin, allowed)
}

func cookieValue(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil || c == nil {
		return ""
	}
	return c.Value
}

func hasSessionCookie(r *http.Request) bool {
	return cookieValue(r, refreshCookie) != "" || cookieValue(r, csrfCookie) != ""
}

func csrfMatches(r *http.Request) bool {
	return constantTimeString(cookieValue(r, csrfCookie), r.Header.Get(csrfHeader))
}

func constantTimeString(a, b string) bool {
	if a == "" || b == "" || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
