package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

// SessionCookieName is the Go v1 opaque session cookie (ADR-0007).
const SessionCookieName = "vc_session"

// CSRFCookieName is the JS-readable double-submit CSRF cookie.
const CSRFCookieName = "vc_csrf"

// CSRFHeader is the header that must match CSRFCookieName.
const CSRFHeader = "X-CSRF-Token"

const (
	sessionTokenBytes     = 32
	csrfTokenBytes        = 32
	maxSessionCookieBytes = 128
	DefaultSessionTTL     = 7 * 24 * time.Hour
	DefaultReauthWindow   = 15 * time.Minute
)

// Sessions looks up a process-verified principal from the opaque cookie value.
// A missing, revoked, expired or unknown token returns nil.
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

// NewSessionToken returns a ≥256-bit raw cookie value and its SHA-256 hex hash.
// Only the hash is persisted. The raw value is never logged.
func NewSessionToken() (raw, hash string, err error) {
	var b [sessionTokenBytes]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", "", err
	}
	raw = base64.RawURLEncoding.EncodeToString(b[:])
	return raw, TokenHash(raw), nil
}

// NewCSRFToken returns a 256-bit hex CSRF value for the double-submit cookie.
func NewCSRFToken() (string, error) {
	var b [csrfTokenBytes]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

// TokenHash is the lowercase SHA-256 hex of the raw cookie value.
func TokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// FreshReauth reports whether principal.ReauthAt is within window of now.
func FreshReauth(p *Principal, now time.Time, window time.Duration) bool {
	if p == nil || p.ReauthAt.IsZero() || window <= 0 {
		return false
	}
	if now.IsZero() {
		now = time.Now()
	}
	return !p.ReauthAt.After(now) && now.Sub(p.ReauthAt) <= window
}
