package httpapi

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const (
	csrfCookie = auth.CSRFCookieName
	csrfHeader = auth.CSRFHeader
)

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

func csrfMatches(r *http.Request) bool {
	return constantTimeString(cookieValue(r, csrfCookie), r.Header.Get(csrfHeader))
}

func constantTimeString(a, b string) bool {
	if a == "" || b == "" || len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
