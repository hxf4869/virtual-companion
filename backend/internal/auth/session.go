package auth

import (
	"context"
	"net/http"
	"strings"
)

// SessionCookieName is the Go v1 opaque session cookie (ADR-0007).
const SessionCookieName = "vc_session"

const maxSessionCookieBytes = 128

// Sessions looks up a process-verified principal from the opaque cookie value.
// G6 only reads; G9 is the writer. A missing or unknown token returns nil.
type Sessions interface {
	Lookup(ctx context.Context, token string) (*Principal, error)
}

// CookieToken returns the vc_session value or empty. The value is never logged.
func CookieToken(r *http.Request) string {
	if r == nil {
		return ""
	}
	c, err := r.Cookie(SessionCookieName)
	if err != nil || c == nil {
		return ""
	}
	token := strings.TrimSpace(c.Value)
	if token == "" || len(token) > maxSessionCookieBytes {
		return ""
	}
	for i := 0; i < len(token); i++ {
		b := token[i]
		switch {
		case b >= 'A' && b <= 'Z', b >= 'a' && b <= 'z', b >= '0' && b <= '9':
		case b == '-' || b == '_' || b == '.':
		default:
			return ""
		}
	}
	return token
}
