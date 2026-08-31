package httpapi

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const (
	maxAuthBodyBytes  = 16 << 10
	minPasswordRunes  = 8
	maxUsernameRunes  = 128
	maxPasswordField  = 1024
	sessionCookiePath = "/"
)

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	s.metrics.ObserveCoreWrite()
	if !auth.AllowOrigin(r.Header.Get("Origin"), s.cfg.HTTP.AllowedOrigins) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "origin rejected")
		return
	}
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	username := strings.ToLower(strings.TrimSpace(body.Username))
	password := body.Password
	if !validUsername(username) || !validPasswordInput(password) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !s.admitAuth(w, r, "login", username) {
		return
	}
	if s.core.Passwords == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if retry, ok := s.core.Limiter.Enter(); !ok {
		s.writeRateLimited(w, retry)
		return
	}
	defer s.core.Limiter.Leave()
	ident, known, err := s.core.Store.LookupIdentity(r.Context(), username)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if known && ident.Status != "ACTIVE" {
		_ = s.core.Passwords.MatchStored(password, ident.PasswordHash, true)
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return
	}
	match := known && ident.Status == "ACTIVE"
	if !s.core.Passwords.MatchStored(password, ident.PasswordHash, match) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	expires := time.Now().Add(s.sessionTTL())
	if _, err := s.core.Store.IssueOpaqueSession(r.Context(), ident.AccountID, hash, expires); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.setSessionCookies(w, raw)
	s.writeJSON(w, http.StatusOK, sessionIdentityJSON{
		AccountID:          strconv.FormatInt(ident.AccountID, 10),
		Role:               ident.Role,
		PasswordMustChange: ident.PasswordMustChange,
		ExpiresInSeconds:   int64(s.sessionTTL().Seconds()),
	})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	token := auth.CookieToken(r)
	_ = s.core.Store.RevokeOpaqueSessionHash(r.Context(), auth.TokenHash(token))
	s.clearSessionCookies(w)
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListSessions(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	rows, err := s.core.Store.ListOpaqueSessions(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]sessionJSON, 0, len(rows))
	for _, row := range rows {
		item := sessionJSON{
			ID:                 strconv.FormatInt(row.ID, 10),
			CreatedAt:          rfc3339(row.CreatedAt),
			ExpiresAt:          rfc3339(row.ExpiresAt),
			Current:            row.ID == p.SessionID,
			AccountID:          strconv.FormatInt(p.AccountID, 10),
			Role:               p.Role,
			PasswordMustChange: p.PasswordMustChange,
		}
		out = append(out, item)
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRevokeSession(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	sid, ok := parsePathID(r.PathValue("sessionId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if err := s.core.Store.RevokeOpaqueSession(r.Context(), p.AccountID, sid); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if sid == p.SessionID {
		s.clearSessionCookies(w)
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleRevokeAllSessions(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	n, err := s.core.Store.RevokeAllOpaqueSessions(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.clearSessionCookies(w)
	s.writeJSON(w, http.StatusOK, map[string]int{"revoked": n})
}

func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if !s.admitAuth(w, r, "password", p.Username) {
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	if !s.requireCurrentPassword(w, r, p, body.CurrentPassword) {
		return
	}
	if utf8.RuneCountInString(body.NewPassword) < minPasswordRunes || utf8.RuneCountInString(body.NewPassword) > maxPasswordRunes || len(body.NewPassword) > maxPasswordField {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	hash, err := auth.Hash(body.NewPassword)
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if err := s.core.Store.ChangePasswordHash(r.Context(), p.AccountID, hash); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.clearSessionCookies(w)
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleReauth(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if !s.admitAuth(w, r, "reauth", p.Username) {
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	if !s.requireCurrentPassword(w, r, p, body.Password) {
		return
	}
	if err := s.core.Store.RecordOpaqueReauth(r.Context(), p.AccountID, p.SessionID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) decodeAuthJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return false
	}
	return true
}

func (s *Server) admitAuth(w http.ResponseWriter, r *http.Request, kind, account string) bool {
	if s.core == nil || s.core.Limiter == nil {
		return true
	}
	if retry, ok := s.core.Limiter.Allow(kind, requestSource(r), account); !ok {
		s.writeRateLimited(w, retry)
		return false
	}
	return true
}

func (s *Server) writeRateLimited(w http.ResponseWriter, retry time.Duration) {
	sec := int(retry / time.Second)
	if retry%time.Second != 0 {
		sec++
	}
	if sec < 1 {
		sec = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(sec))
	s.writeAPIError(w, http.StatusTooManyRequests, "AUTH_RATE_LIMITED", "temporarily rate limited")
}

func (s *Server) setSessionCookies(w http.ResponseWriter, raw string) {
	ttl := s.sessionTTL()
	maxAge := int(ttl.Seconds())
	secure := s.cfg.Session.CookieSecure
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    raw,
		Path:     sessionCookiePath,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	csrf, err := auth.NewCSRFToken()
	if err != nil {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CSRFCookieName,
		Value:    csrf,
		Path:     sessionCookiePath,
		MaxAge:   maxAge,
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearSessionCookies(w http.ResponseWriter) {
	secure := s.cfg.Session.CookieSecure
	http.SetCookie(w, &http.Cookie{
		Name:     auth.SessionCookieName,
		Value:    "",
		Path:     sessionCookiePath,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CSRFCookieName,
		Value:    "",
		Path:     sessionCookiePath,
		MaxAge:   -1,
		HttpOnly: false,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) sessionTTL() time.Duration {
	if s.cfg.Session.TTL > 0 {
		return s.cfg.Session.TTL
	}
	return auth.DefaultSessionTTL
}

func requestSource(r *http.Request) string {
	if r == nil {
		return ""
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func validUsername(username string) bool {
	if username == "" || utf8.RuneCountInString(username) > maxUsernameRunes || len(username) > maxUsernameRunes {
		return false
	}
	return true
}

func validPasswordInput(password string) bool {
	if password == "" || utf8.RuneCountInString(password) > maxPasswordField || len(password) > maxPasswordField {
		return false
	}
	return true
}

type sessionIdentityJSON struct {
	AccountID          string `json:"accountId"`
	Role               string `json:"role"`
	PasswordMustChange bool   `json:"passwordMustChange"`
	ExpiresInSeconds   int64  `json:"expiresInSeconds"`
}

type sessionJSON struct {
	ID                 string `json:"id"`
	CreatedAt          string `json:"createdAt"`
	ExpiresAt          string `json:"expiresAt"`
	Current            bool   `json:"current"`
	AccountID          string `json:"accountId"`
	Role               string `json:"role"`
	PasswordMustChange bool   `json:"passwordMustChange"`
}
