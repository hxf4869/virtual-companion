package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	maxAuthBodyBytes   = 16 << 10
	minPasswordRunes   = 8
	maxLoginIDRunes    = 320
	maxEmailRunes      = 320
	maxPasswordField   = 1024
	sessionCookiePath  = "/"
	authChallengeTTL   = 5 * time.Minute
	trustedDeviceTTL   = 90 * 24 * time.Hour
	maxDeviceNameRunes = 120
	defaultPersonaRef  = "gentle-listener"
)

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !s.beginUnauthenticatedAuthWrite(w, r) {
		return
	}
	var body struct {
		Account  string `json:"account"`
		Password string `json:"password"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	account := strings.ToLower(strings.TrimSpace(body.Account))
	password := body.Password
	if !validLoginIdentifier(account) || !validPasswordInput(password) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !s.admitAuth(w, r, "login", account) {
		return
	}
	if s.core == nil || s.core.Passwords == nil || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if retry, ok := s.core.Limiter.Enter(); !ok {
		s.writeRateLimited(w, retry)
		return
	}
	defer s.core.Limiter.Leave()
	ident, known, err := s.core.Store.LookupIdentity(r.Context(), account)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if !s.core.Passwords.MatchStored(password, ident.PasswordHash, known) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	switch ident.Status {
	case "EMAIL_UNVERIFIED":
		s.writeJSON(w, http.StatusAccepted, authNextStepJSON{NextStep: "EMAIL_VERIFICATION_REQUIRED"})
		return
	case "PENDING_REVIEW":
		s.writeJSON(w, http.StatusAccepted, authNextStepJSON{NextStep: "REVIEW_PENDING"})
		return
	case "DISABLED", "REJECTED":
		s.writeJSON(w, http.StatusForbidden, authNextStepJSON{NextStep: ident.Status})
		return
	case "ACTIVE":
	default:
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if ident.Role == "USER" {
		if _, err := s.core.AuthFlow.EnsureDefaultRelationship(
			r.Context(), ident.AccountID, defaultPersonaRef,
		); err != nil {
			s.writeStoreErr(w, err)
			return
		}
	}

	now := time.Now().UTC()
	if trustedToken := auth.TrustedDeviceToken(r); trustedToken != "" {
		session, ok, err := s.core.AuthFlow.LoginWithTrustedDevice(
			r.Context(), ident.AccountID, trustedToken, now, now.Add(s.sessionTTL()))
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if ok {
			s.writeAuthenticatedSession(w, session.SessionToken, ident.AccountID, ident.Username, ident.Role, ident.PasswordMustChange, true)
			return
		}
		s.clearTrustedDeviceCookie(w)
	}

	enabled, err := s.core.AuthFlow.AuthenticatorEnabled(r.Context(), ident.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	mode := postgres.AuthChallengeTOTPEnroll
	nextStep := "AUTHENTICATOR_SETUP_REQUIRED"
	if enabled {
		mode = postgres.AuthChallengeTOTPVerify
		nextStep = "TOTP_REQUIRED"
	}
	challenge, err := s.core.AuthFlow.CreateAuthChallenge(r.Context(), ident.AccountID, mode, now.Add(authChallengeTTL))
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusAccepted, authNextStepJSON{
		NextStep:    nextStep,
		ChallengeID: challenge.ID,
		ExpiresAt:   rfc3339(challenge.ExpiresAt),
	})
}

func (s *Server) handleRegistrationStatus(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]bool{"enabled": false})
}

func (s *Server) handleRegistrationClosed(w http.ResponseWriter, r *http.Request) {
	if !s.beginUnauthenticatedAuthWrite(w, r) {
		return
	}
	s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "registration is closed")
}

func (s *Server) handleSession(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	if s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	enabled, err := s.core.AuthFlow.AuthenticatorEnabled(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, sessionIdentityJSON{
		NextStep:             "ACTIVE",
		AccountID:            strconv.FormatInt(p.AccountID, 10),
		Email:                accountEmail(p.Username),
		Role:                 p.Role,
		PasswordMustChange:   p.PasswordMustChange,
		AuthenticatorEnabled: enabled,
		ExpiresInSeconds:     int64(s.sessionTTL().Seconds()),
	})
}

func (s *Server) handleAuthenticatorSetup(w http.ResponseWriter, r *http.Request) {
	if !s.beginUnauthenticatedAuthWrite(w, r) {
		return
	}
	challengeID := r.PathValue("challengeId")
	if !validChallengeID(challengeID) || s.core == nil || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	setup, err := s.core.AuthFlow.AuthenticatorSetup(r.Context(), challengeID, time.Now().UTC())
	if err != nil {
		s.writeChallengeErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, setup)
}

func (s *Server) handleAuthenticatorConfirm(w http.ResponseWriter, r *http.Request) {
	s.handleAuthChallengeComplete(w, r, postgres.AuthChallengeTOTPEnroll, postgres.AuthMethodTOTP)
}

func (s *Server) handleTOTPVerify(w http.ResponseWriter, r *http.Request) {
	s.handleAuthChallengeComplete(w, r, postgres.AuthChallengeTOTPVerify, postgres.AuthMethodTOTP)
}

func (s *Server) handleRecoveryCodeVerify(w http.ResponseWriter, r *http.Request) {
	s.handleAuthChallengeComplete(w, r, postgres.AuthChallengeTOTPVerify, postgres.AuthMethodRecoveryCode)
}

func (s *Server) handleAuthChallengeComplete(w http.ResponseWriter, r *http.Request, mode, method string) {
	if !s.beginUnauthenticatedAuthWrite(w, r) {
		return
	}
	challengeID := r.PathValue("challengeId")
	if !validChallengeID(challengeID) || s.core == nil || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	var body struct {
		Code        string `json:"code"`
		TrustDevice bool   `json:"trustDevice"`
		DeviceName  string `json:"deviceName"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	code := strings.TrimSpace(body.Code)
	if code == "" || len(code) > 128 || utf8.RuneCountInString(body.DeviceName) > maxDeviceNameRunes {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !s.admitAuth(w, r, "authenticator", "") {
		return
	}
	now := time.Now().UTC()
	session, valid, err := s.core.AuthFlow.CompleteAuthChallenge(r.Context(), postgres.AuthCompleteInput{
		ChallengeID:            challengeID,
		Mode:                   mode,
		Method:                 method,
		Code:                   code,
		TrustDevice:            body.TrustDevice,
		DeviceName:             body.DeviceName,
		Now:                    now,
		SessionExpiresAt:       now.Add(s.sessionTTL()),
		TrustedDeviceExpiresAt: now.Add(trustedDeviceTTL),
	})
	if err != nil {
		s.writeChallengeErr(w, err)
		return
	}
	if !valid {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if session.TrustedDeviceToken != "" {
		s.setTrustedDeviceCookie(w, session.TrustedDeviceToken)
	}
	s.setSessionCookies(w, session.SessionToken)
	s.writeJSON(w, http.StatusOK, authCompleteJSON{
		NextStep:             "ACTIVE",
		AccountID:            strconv.FormatInt(session.AccountID, 10),
		Email:                accountEmail(session.AccountName),
		Role:                 session.Role,
		PasswordMustChange:   session.PasswordMustChange,
		AuthenticatorEnabled: true,
		ExpiresInSeconds:     int64(s.sessionTTL().Seconds()),
		RecoveryCodes:        session.RecoveryCodes,
	})
}

func (s *Server) handleListTrustedDevices(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	if s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	rows, err := s.core.AuthFlow.ListTrustedDevices(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]trustedDeviceJSON, 0, len(rows))
	for _, row := range rows {
		out = append(out, trustedDeviceJSON{
			ID: strconv.FormatInt(row.ID, 10), DisplayName: row.DisplayName,
			CreatedAt: rfc3339(row.CreatedAt), LastUsedAt: rfc3339(row.LastUsedAt), ExpiresAt: rfc3339(row.ExpiresAt),
		})
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRevokeTrustedDevice(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	deviceID, ok := parsePathID(r.PathValue("deviceId"))
	if !ok || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if err := s.core.AuthFlow.RevokeTrustedDevice(r.Context(), p.AccountID, deviceID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleListAdminAccounts(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	if p.Role != "ADMIN" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "access denied")
		return
	}
	if s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	rows, err := s.core.AuthFlow.ListAdminAccounts(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]adminAccountJSON, 0, len(rows))
	for _, row := range rows {
		item := adminAccountJSON{
			AccountID:            strconv.FormatInt(row.ID, 10),
			Username:             row.Username,
			DisplayName:          row.DisplayName,
			Role:                 row.Role,
			Status:               row.Status,
			EmailVerified:        row.EmailVerified,
			AuthenticatorEnabled: row.AuthenticatorEnabled,
			CreatedAt:            rfc3339(row.CreatedAt),
		}
		if row.Email != nil {
			item.Email = *row.Email
		}
		if row.ReviewedAt != nil {
			item.ReviewedAt = rfc3339(*row.ReviewedAt)
		}
		out = append(out, item)
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleReviewAdminAccount(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if p.Role != "ADMIN" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "access denied")
		return
	}
	if !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "recent reauthentication required")
		return
	}
	targetAccountID, ok := parsePathID(r.PathValue("accountId"))
	if !ok || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	var body struct {
		Decision string `json:"decision"`
	}
	if !s.decodeAuthJSON(w, r, &body) {
		return
	}
	decision := strings.ToUpper(strings.TrimSpace(body.Decision))
	if decision != "APPROVE" && decision != "REJECT" {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if err := s.core.AuthFlow.ReviewAccount(
		r.Context(), p.AccountID, targetAccountID, decision, time.Now().UTC(),
	); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	status := "ACTIVE"
	if decision == "REJECT" {
		status = "REJECTED"
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"ok": true, "status": status})
}

func (s *Server) handleAdminResetAuthenticator(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	if p.Role != "ADMIN" {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "access denied")
		return
	}
	if !auth.FreshReauth(p, time.Now(), s.cfg.Session.ReauthWindow) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "recent reauthentication required")
		return
	}
	targetAccountID, ok := parsePathID(r.PathValue("accountId"))
	if !ok || s.core.AuthFlow == nil {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	if err := s.core.AuthFlow.ResetAuthenticator(r.Context(), p.AccountID, targetAccountID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	token := auth.CookieToken(r)
	if err := s.core.Store.RevokeOpaqueSessionHash(r.Context(), auth.TokenHash(token)); err != nil {
		s.writeStoreErr(w, err)
		return
	}
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
	s.clearAllAuthCookies(w)
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
	s.clearAllAuthCookies(w)
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
	if retry, ok := s.core.Limiter.Allow(kind, s.authRequestSource(r), account); !ok {
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

func (s *Server) beginUnauthenticatedAuthWrite(w http.ResponseWriter, r *http.Request) bool {
	s.metrics.ObserveCoreWrite()
	if !auth.AllowOrigin(r.Header.Get("Origin"), s.cfg.HTTP.AllowedOrigins) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "origin rejected")
		return false
	}
	return true
}

func (s *Server) writeChallengeErr(w http.ResponseWriter, err error) {
	if errors.Is(err, postgres.ErrNotFound) || errors.Is(err, postgres.ErrInvalid) {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	s.writeStoreErr(w, err)
}

func (s *Server) writeAuthenticatedSession(
	w http.ResponseWriter,
	raw string,
	accountID int64,
	accountName string,
	role string,
	passwordMustChange bool,
	authenticatorEnabled bool,
) {
	s.setSessionCookies(w, raw)
	s.writeJSON(w, http.StatusOK, sessionIdentityJSON{
		NextStep:             "ACTIVE",
		AccountID:            strconv.FormatInt(accountID, 10),
		Email:                accountEmail(accountName),
		Role:                 role,
		PasswordMustChange:   passwordMustChange,
		AuthenticatorEnabled: authenticatorEnabled,
		ExpiresInSeconds:     int64(s.sessionTTL().Seconds()),
	})
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

func (s *Server) setTrustedDeviceCookie(w http.ResponseWriter, raw string) {
	secure := s.cfg.Session.CookieSecure
	http.SetCookie(w, &http.Cookie{
		Name:     auth.TrustedDeviceCookieName,
		Value:    raw,
		Path:     sessionCookiePath,
		MaxAge:   int(trustedDeviceTTL.Seconds()),
		Expires:  time.Now().UTC().Add(trustedDeviceTTL),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearTrustedDeviceCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.TrustedDeviceCookieName,
		Value:    "",
		Path:     sessionCookiePath,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0).UTC(),
		HttpOnly: true,
		Secure:   s.cfg.Session.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearAllAuthCookies(w http.ResponseWriter) {
	s.clearSessionCookies(w)
	s.clearTrustedDeviceCookie(w)
}

func (s *Server) sessionTTL() time.Duration {
	if s.cfg.Session.TTL > 0 {
		return s.cfg.Session.TTL
	}
	return auth.DefaultSessionTTL
}

func validEmailInput(email string) bool {
	if email == "" || utf8.RuneCountInString(email) > maxEmailRunes || len(email) > maxEmailRunes {
		return false
	}
	at := strings.LastIndexByte(email, '@')
	return at > 0 && at < len(email)-1
}

func validLoginIdentifier(account string) bool {
	return account != "" && utf8.RuneCountInString(account) <= maxLoginIDRunes && len(account) <= maxLoginIDRunes
}

func accountEmail(accountName string) string {
	email := strings.ToLower(strings.TrimSpace(accountName))
	if !validEmailInput(email) {
		return ""
	}
	return email
}

func validPasswordInput(password string) bool {
	if password == "" || utf8.RuneCountInString(password) > maxPasswordField || len(password) > maxPasswordField {
		return false
	}
	return true
}

type sessionIdentityJSON struct {
	NextStep             string `json:"nextStep"`
	AccountID            string `json:"accountId"`
	Email                string `json:"email,omitempty"`
	Role                 string `json:"role"`
	PasswordMustChange   bool   `json:"passwordMustChange"`
	AuthenticatorEnabled bool   `json:"authenticatorEnabled"`
	ExpiresInSeconds     int64  `json:"expiresInSeconds"`
}

type authNextStepJSON struct {
	NextStep    string `json:"nextStep"`
	ChallengeID string `json:"challengeId,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

type authCompleteJSON struct {
	NextStep             string   `json:"nextStep"`
	AccountID            string   `json:"accountId"`
	Email                string   `json:"email,omitempty"`
	Role                 string   `json:"role"`
	PasswordMustChange   bool     `json:"passwordMustChange"`
	AuthenticatorEnabled bool     `json:"authenticatorEnabled"`
	ExpiresInSeconds     int64    `json:"expiresInSeconds"`
	RecoveryCodes        []string `json:"recoveryCodes,omitempty"`
}

type trustedDeviceJSON struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
	LastUsedAt  string `json:"lastUsedAt"`
	ExpiresAt   string `json:"expiresAt"`
}

type adminAccountJSON struct {
	AccountID            string `json:"accountId"`
	Email                string `json:"email,omitempty"`
	Username             string `json:"username"`
	DisplayName          string `json:"displayName"`
	Role                 string `json:"role"`
	Status               string `json:"status"`
	EmailVerified        bool   `json:"emailVerified"`
	AuthenticatorEnabled bool   `json:"authenticatorEnabled"`
	CreatedAt            string `json:"createdAt"`
	ReviewedAt           string `json:"reviewedAt,omitempty"`
}

func validChallengeID(value string) bool {
	if len(value) != 43 {
		return false
	}
	for i := 0; i < len(value); i++ {
		b := value[i]
		if (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z') || (b >= '0' && b <= '9') || b == '-' || b == '_' {
			continue
		}
		return false
	}
	return true
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
