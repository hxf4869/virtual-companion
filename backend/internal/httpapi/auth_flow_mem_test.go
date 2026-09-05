package httpapi

import (
	"context"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) EnsureDefaultRelationship(
	ctx context.Context,
	accountID int64,
	personaRef string,
) (postgres.Relationship, error) {
	m.mu.Lock()
	if id, ok := m.active[accountID]; ok {
		rel := m.rels[id]
		m.mu.Unlock()
		return rel, nil
	}
	m.mu.Unlock()
	return m.CreateRelationship(ctx, accountID, personaRef)
}

func (m *memStore) AuthenticatorEnabled(_ context.Context, accountID int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.authenticators[accountID], nil
}

func (m *memStore) CreateAuthChallenge(_ context.Context, accountID int64, mode string, expiresAt time.Time) (postgres.AuthChallenge, error) {
	raw, _, err := auth.NewSessionToken()
	if err != nil {
		return postgres.AuthChallenge{}, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.identityByAccount(accountID); !ok ||
		(mode == postgres.AuthChallengeTOTPVerify) != m.authenticators[accountID] {
		return postgres.AuthChallenge{}, postgres.ErrNotFound
	}
	m.authChallenges[raw] = memAuthChallenge{AccountID: accountID, Mode: mode, ExpiresAt: expiresAt.UTC()}
	return postgres.AuthChallenge{ID: raw, Mode: mode, ExpiresAt: expiresAt.UTC()}, nil
}

func (m *memStore) AuthenticatorSetup(_ context.Context, challengeID string, now time.Time) (auth.TOTPProvisioning, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	challenge, ok := m.authChallenges[challengeID]
	if !ok || challenge.Mode != postgres.AuthChallengeTOTPEnroll || challenge.Consumed || !challenge.ExpiresAt.After(now) {
		return auth.TOTPProvisioning{}, postgres.ErrNotFound
	}
	ident, ok := m.identityByAccount(challenge.AccountID)
	if !ok {
		return auth.TOTPProvisioning{}, postgres.ErrNotFound
	}
	accountName := ident.Username + "@example.com"
	if challenge.Secret == "" {
		setup, err := auth.NewTOTP(accountName)
		if err != nil {
			return auth.TOTPProvisioning{}, err
		}
		challenge.Secret = setup.ManualKey
		m.authChallenges[challengeID] = challenge
		return setup, nil
	}
	return auth.TOTPFromSecret(accountName, challenge.Secret)
}

func (m *memStore) CompleteAuthChallenge(_ context.Context, in postgres.AuthCompleteInput) (postgres.AuthenticatedSession, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	challenge, ok := m.authChallenges[in.ChallengeID]
	if !ok || challenge.Mode != in.Mode || challenge.Consumed || !challenge.ExpiresAt.After(in.Now) {
		return postgres.AuthenticatedSession{}, false, nil
	}
	valid := in.Code == "123456" && in.Method == postgres.AuthMethodTOTP
	if in.Mode == postgres.AuthChallengeTOTPEnroll && challenge.Secret == "" {
		valid = false
	}
	if in.Mode == postgres.AuthChallengeTOTPVerify && in.Method == postgres.AuthMethodRecoveryCode {
		valid = strings.EqualFold(strings.ReplaceAll(in.Code, "-", ""), "RECOVERYCODE")
	}
	if !valid {
		return postgres.AuthenticatedSession{}, false, nil
	}
	ident, ok := m.identityByAccount(challenge.AccountID)
	if !ok || ident.Status != "ACTIVE" {
		return postgres.AuthenticatedSession{}, false, nil
	}
	sessionRaw, sessionHash, err := auth.NewSessionToken()
	if err != nil {
		return postgres.AuthenticatedSession{}, false, err
	}
	sessionID := m.next
	m.next++
	m.sessions[sessionID] = memSession{
		ID: sessionID, AccountID: challenge.AccountID, TokenHash: sessionHash,
		CreatedAt: in.Now.UTC(), ExpiresAt: in.SessionExpiresAt.UTC(),
	}
	m.byHash[sessionHash] = sessionID
	challenge.Consumed = true
	m.authChallenges[in.ChallengeID] = challenge
	result := postgres.AuthenticatedSession{
		AccountID: challenge.AccountID, Role: ident.Role, AccountName: ident.Username,
		PasswordMustChange: ident.PasswordMustChange, SessionID: sessionID, SessionToken: sessionRaw,
	}
	if in.Mode == postgres.AuthChallengeTOTPEnroll {
		m.authenticators[challenge.AccountID] = true
		result.RecoveryCodes = []string{"ABCD-EFGH-IJKL-MNOP"}
	}
	if in.TrustDevice {
		deviceRaw, deviceHash, err := auth.NewSessionToken()
		if err != nil {
			return postgres.AuthenticatedSession{}, false, err
		}
		deviceID := m.nextTrustedID
		m.nextTrustedID++
		name := strings.TrimSpace(in.DeviceName)
		if name == "" {
			name = "当前设备"
		}
		m.trustedDevices[deviceID] = memTrustedDevice{
			ID: deviceID, AccountID: challenge.AccountID, TokenHash: deviceHash,
			DisplayName: name, CreatedAt: in.Now.UTC(), LastUsedAt: in.Now.UTC(),
			ExpiresAt: in.TrustedDeviceExpiresAt.UTC(),
		}
		result.TrustedDeviceID = &deviceID
		result.TrustedDeviceToken = deviceRaw
	}
	return result, true, nil
}

func (m *memStore) LoginWithTrustedDevice(
	_ context.Context,
	accountID int64,
	deviceToken string,
	now, sessionExpiresAt time.Time,
) (postgres.AuthenticatedSession, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	hash := auth.TokenHash(deviceToken)
	var device memTrustedDevice
	found := false
	for id, candidate := range m.trustedDevices {
		if candidate.AccountID == accountID && candidate.TokenHash == hash && !candidate.Revoked && candidate.ExpiresAt.After(now) {
			candidate.LastUsedAt = now.UTC()
			m.trustedDevices[id] = candidate
			device = candidate
			found = true
			break
		}
	}
	if !found || !m.authenticators[accountID] {
		return postgres.AuthenticatedSession{}, false, nil
	}
	raw, tokenHash, err := auth.NewSessionToken()
	if err != nil {
		return postgres.AuthenticatedSession{}, false, err
	}
	sessionID := m.next
	m.next++
	m.sessions[sessionID] = memSession{
		ID: sessionID, AccountID: accountID, TokenHash: tokenHash,
		CreatedAt: now.UTC(), ExpiresAt: sessionExpiresAt.UTC(),
	}
	m.byHash[tokenHash] = sessionID
	return postgres.AuthenticatedSession{
		AccountID: accountID, SessionID: sessionID, SessionToken: raw, TrustedDeviceID: &device.ID,
	}, true, nil
}

func (m *memStore) ListTrustedDevices(_ context.Context, accountID int64) ([]postgres.TrustedDevice, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	out := make([]postgres.TrustedDevice, 0)
	for _, device := range m.trustedDevices {
		if device.AccountID != accountID || device.Revoked || !device.ExpiresAt.After(now) {
			continue
		}
		out = append(out, postgres.TrustedDevice{
			ID: device.ID, DisplayName: device.DisplayName, CreatedAt: device.CreatedAt,
			LastUsedAt: device.LastUsedAt, ExpiresAt: device.ExpiresAt,
		})
	}
	return out, nil
}

func (m *memStore) RevokeTrustedDevice(_ context.Context, accountID, deviceID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	device, ok := m.trustedDevices[deviceID]
	if !ok || device.AccountID != accountID || device.Revoked {
		return postgres.ErrNotFound
	}
	device.Revoked = true
	m.trustedDevices[deviceID] = device
	return nil
}

func (m *memStore) ResetAuthenticator(_ context.Context, actingAccountID, targetAccountID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	acting, ok := m.identityByAccount(actingAccountID)
	if !ok || acting.Role != "ADMIN" {
		return postgres.ErrNotFound
	}
	if _, ok := m.identityByAccount(targetAccountID); !ok {
		return postgres.ErrNotFound
	}
	delete(m.authenticators, targetAccountID)
	now := time.Now()
	for id, session := range m.sessions {
		if session.AccountID == targetAccountID && session.RevokedAt.IsZero() {
			session.RevokedAt = now
			m.sessions[id] = session
		}
	}
	for id, device := range m.trustedDevices {
		if device.AccountID == targetAccountID {
			device.Revoked = true
			m.trustedDevices[id] = device
		}
	}
	return nil
}

func (m *memStore) ListAdminAccounts(_ context.Context, actingAccountID int64) ([]postgres.AdminAccount, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	acting, ok := m.identityByAccount(actingAccountID)
	if !ok || acting.Role != "ADMIN" || acting.Status != "ACTIVE" {
		return nil, postgres.ErrNotFound
	}
	out := make([]postgres.AdminAccount, 0, len(m.identities))
	seen := make(map[int64]bool)
	for identifier, identity := range m.identities {
		if seen[identity.AccountID] {
			continue
		}
		seen[identity.AccountID] = true
		var email *string
		if strings.Contains(identifier, "@") {
			value := identifier
			email = &value
		}
		out = append(out, postgres.AdminAccount{
			ID: identity.AccountID, Email: email, Username: identity.Username,
			DisplayName: identity.Username, Role: identity.Role, Status: identity.Status,
			EmailVerified: email != nil, AuthenticatorEnabled: m.authenticators[identity.AccountID],
			CreatedAt: time.Unix(identity.AccountID, 0).UTC(),
		})
	}
	return out, nil
}

func (m *memStore) ReviewAccount(
	_ context.Context,
	actingAccountID, targetAccountID int64,
	decision string,
	_ time.Time,
) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	acting, ok := m.identityByAccount(actingAccountID)
	if !ok || acting.Role != "ADMIN" || acting.Status != "ACTIVE" {
		return postgres.ErrNotFound
	}
	if decision != "APPROVE" && decision != "REJECT" {
		return postgres.ErrInvalid
	}
	found := false
	for identifier, identity := range m.identities {
		if identity.AccountID != targetAccountID || identity.Status != "PENDING_REVIEW" {
			continue
		}
		found = true
		if decision == "APPROVE" {
			identity.Status = "ACTIVE"
		} else {
			identity.Status = "REJECTED"
		}
		m.identities[identifier] = identity
	}
	if !found {
		return postgres.ErrNotFound
	}
	return nil
}
