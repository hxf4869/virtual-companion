package postgres

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

const (
	AuthChallengeTOTPVerify = "TOTP_VERIFY"
	AuthChallengeTOTPEnroll = "TOTP_ENROLL"
	AuthMethodTOTP          = "totp"
	AuthMethodRecoveryCode  = "recovery_code"
)

type AuthChallenge struct {
	ID        string
	Mode      string
	ExpiresAt time.Time
}

type AuthCompleteInput struct {
	ChallengeID            string
	Mode                   string
	Method                 string
	Code                   string
	TrustDevice            bool
	DeviceName             string
	Now                    time.Time
	SessionExpiresAt       time.Time
	TrustedDeviceExpiresAt time.Time
}

type AuthenticatedSession struct {
	AccountID          int64
	Role               string
	AccountName        string
	PasswordMustChange bool
	SessionID          int64
	SessionToken       string
	TrustedDeviceID    *int64
	TrustedDeviceToken string
	RecoveryCodes      []string
}

type TrustedDevice struct {
	ID          int64
	DisplayName string
	CreatedAt   time.Time
	LastUsedAt  time.Time
	ExpiresAt   time.Time
}

type AdminAccount struct {
	ID                   int64
	Email                *string
	Username             string
	DisplayName          string
	Role                 string
	Status               string
	EmailVerified        bool
	AuthenticatorEnabled bool
	CreatedAt            time.Time
	ReviewedAt           *time.Time
}

func (s *Store) AuthenticatorEnabled(ctx context.Context, accountID int64) (bool, error) {
	var enabled bool
	err := s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.identity_authenticator_enabled_current()`).Scan(&enabled)
	})
	return enabled, mapStoreErr(err)
}

func (s *Store) CreateAuthChallenge(ctx context.Context, accountID int64, mode string, expiresAt time.Time) (AuthChallenge, error) {
	raw, _, err := auth.NewSessionToken()
	if err != nil {
		return AuthChallenge{}, errStore
	}
	challenge := AuthChallenge{ID: raw, Mode: mode, ExpiresAt: expiresAt.UTC()}
	err = s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		var created bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.identity_auth_challenge_create_current($1, $2, $3)`,
			challenge.ID, challenge.Mode, challenge.ExpiresAt).Scan(&created); err != nil {
			return err
		}
		if !created {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		return AuthChallenge{}, mapStoreErr(err)
	}
	return challenge, nil
}

func (s *Store) AuthenticatorSetup(ctx context.Context, challengeID string, now time.Time) (auth.TOTPProvisioning, error) {
	if s == nil || s.cipher == nil {
		return auth.TOTPProvisioning{}, errStore
	}
	candidate, err := auth.NewTOTP("pending")
	if err != nil {
		return auth.TOTPProvisioning{}, errStore
	}
	encrypted, err := s.cipher.Encrypt(candidate.ManualKey)
	if err != nil {
		return auth.TOTPProvisioning{}, errStore
	}
	var accountName, stored string
	err = s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT out_account_name, out_pending_ciphertext
			   FROM vc.identity_auth_challenge_setup($1, $2, $3)`,
			challengeID, encrypted, now.UTC()).Scan(&accountName, &stored)
	})
	if err != nil {
		if err == pgx.ErrNoRows {
			return auth.TOTPProvisioning{}, ErrNotFound
		}
		return auth.TOTPProvisioning{}, mapStoreErr(err)
	}
	secret, err := s.cipher.Decrypt(stored)
	if err != nil {
		return auth.TOTPProvisioning{}, errStore
	}
	provisioning, err := auth.TOTPFromSecret(accountName, secret)
	if err != nil {
		return auth.TOTPProvisioning{}, errStore
	}
	return provisioning, nil
}

func (s *Store) CompleteAuthChallenge(ctx context.Context, in AuthCompleteInput) (AuthenticatedSession, bool, error) {
	if s == nil || s.cipher == nil {
		return AuthenticatedSession{}, false, errStore
	}
	now := in.Now.UTC()
	var result AuthenticatedSession
	valid := false
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var currentCipher, pendingCipher *string
		if err := tx.QueryRow(ctx,
			`SELECT out_account_id, out_role, out_account_name, out_password_must_change,
			        out_current_totp_ciphertext, out_pending_totp_ciphertext
			   FROM vc.identity_auth_challenge_lock($1, $2, $3)`,
			in.ChallengeID, in.Mode, now).Scan(
			&result.AccountID, &result.Role, &result.AccountName, &result.PasswordMustChange,
			&currentCipher, &pendingCipher); err != nil {
			if err == pgx.ErrNoRows {
				return nil
			}
			return err
		}
		if err := s.bindOwner(ctx, tx, result.AccountID); err != nil {
			return err
		}

		var recoveryID *int64
		switch {
		case in.Mode == AuthChallengeTOTPEnroll && in.Method == AuthMethodTOTP && pendingCipher != nil:
			secret, err := s.cipher.Decrypt(*pendingCipher)
			if err != nil {
				return err
			}
			valid = auth.ValidateTOTP(secret, in.Code, now)
		case in.Mode == AuthChallengeTOTPVerify && in.Method == AuthMethodTOTP && currentCipher != nil:
			secret, err := s.cipher.Decrypt(*currentCipher)
			if err != nil {
				return err
			}
			valid = auth.ValidateTOTP(secret, in.Code, now)
		case in.Mode == AuthChallengeTOTPVerify && in.Method == AuthMethodRecoveryCode:
			if err := tx.QueryRow(ctx,
				`SELECT vc.identity_auth_recovery_code_lock_current($1)`,
				auth.RecoveryCodeHash(in.Code)).Scan(&recoveryID); err != nil {
				return err
			}
			valid = recoveryID != nil
		}
		if !valid {
			var attempts *int16
			if err := tx.QueryRow(ctx,
				`SELECT vc.identity_auth_challenge_fail_current($1, $2)`,
				in.ChallengeID, now).Scan(&attempts); err != nil {
				return err
			}
			return nil
		}

		sessionRaw, sessionHash, err := auth.NewSessionToken()
		if err != nil {
			return err
		}
		result.SessionToken = sessionRaw

		var recoveryHashes []string
		if in.Mode == AuthChallengeTOTPEnroll {
			result.RecoveryCodes, recoveryHashes, err = auth.NewRecoveryCodes(auth.RecoveryCodeCount)
			if err != nil {
				return err
			}
		}

		var deviceHash *string
		var deviceName *string
		var deviceExpires *time.Time
		if in.TrustDevice {
			deviceRaw, hash, err := auth.NewSessionToken()
			if err != nil {
				return err
			}
			name := normalizeDeviceName(in.DeviceName)
			expires := in.TrustedDeviceExpiresAt.UTC()
			result.TrustedDeviceToken = deviceRaw
			deviceHash = &hash
			deviceName = &name
			deviceExpires = &expires
		}

		return tx.QueryRow(ctx,
			`SELECT out_session_id, out_trusted_device_id
			   FROM vc.identity_auth_challenge_complete_current(
			       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			in.ChallengeID, in.Mode, sessionHash, in.SessionExpiresAt.UTC(), recoveryID,
			recoveryHashes, deviceHash, deviceName, deviceExpires, now).Scan(
			&result.SessionID, &result.TrustedDeviceID)
	})
	if err != nil {
		return AuthenticatedSession{}, false, mapStoreErr(err)
	}
	if !valid {
		return AuthenticatedSession{}, false, nil
	}
	return result, true, nil
}

func (s *Store) LoginWithTrustedDevice(
	ctx context.Context,
	accountID int64,
	deviceToken string,
	now, sessionExpiresAt time.Time,
) (AuthenticatedSession, bool, error) {
	if deviceToken == "" {
		return AuthenticatedSession{}, false, nil
	}
	sessionRaw, sessionHash, err := auth.NewSessionToken()
	if err != nil {
		return AuthenticatedSession{}, false, errStore
	}
	var sessionID, deviceID int64
	found := false
	err = s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx,
			`SELECT out_session_id, out_trusted_device_id
			   FROM vc.identity_trusted_device_login_current($1, $2, $3, $4)`,
			auth.TokenHash(deviceToken), sessionHash, sessionExpiresAt.UTC(), now.UTC()).Scan(
			&sessionID, &deviceID)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		return nil
	})
	if err != nil {
		return AuthenticatedSession{}, false, mapStoreErr(err)
	}
	if !found {
		return AuthenticatedSession{}, false, nil
	}
	return AuthenticatedSession{
		AccountID: accountID, SessionID: sessionID, SessionToken: sessionRaw,
		TrustedDeviceID: &deviceID,
	}, true, nil
}

func (s *Store) ListTrustedDevices(ctx context.Context, accountID int64) ([]TrustedDevice, error) {
	devices := make([]TrustedDevice, 0)
	err := s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_display_name, out_created_at, out_last_used_at, out_expires_at
			   FROM vc.identity_trusted_device_list_current()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var device TrustedDevice
			if err := rows.Scan(&device.ID, &device.DisplayName, &device.CreatedAt, &device.LastUsedAt, &device.ExpiresAt); err != nil {
				return err
			}
			devices = append(devices, device)
		}
		return rows.Err()
	})
	return devices, mapStoreErr(err)
}

func (s *Store) RevokeTrustedDevice(ctx context.Context, accountID, deviceID int64) error {
	err := s.WithOwner(ctx, accountID, func(ctx context.Context, tx pgx.Tx) error {
		var revoked bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.identity_trusted_device_revoke_current($1)`, deviceID).Scan(&revoked); err != nil {
			return err
		}
		if !revoked {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) ResetAuthenticator(ctx context.Context, actingAccountID, targetAccountID int64) error {
	err := s.WithOwner(ctx, actingAccountID, func(ctx context.Context, tx pgx.Tx) error {
		var reset bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.identity_admin_reset_authenticator_current($1)`, targetAccountID).Scan(&reset); err != nil {
			return err
		}
		if !reset {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) ListAdminAccounts(ctx context.Context, actingAccountID int64) ([]AdminAccount, error) {
	accounts := make([]AdminAccount, 0)
	err := s.WithOwner(ctx, actingAccountID, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_account_id, out_email, out_username, out_display_name,
			        out_role, out_status, out_email_verified,
			        out_authenticator_enabled, out_created_at, out_reviewed_at
			   FROM vc.identity_admin_account_list_current()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var account AdminAccount
			if err := rows.Scan(
				&account.ID, &account.Email, &account.Username, &account.DisplayName,
				&account.Role, &account.Status, &account.EmailVerified,
				&account.AuthenticatorEnabled, &account.CreatedAt, &account.ReviewedAt,
			); err != nil {
				return err
			}
			accounts = append(accounts, account)
		}
		return rows.Err()
	})
	return accounts, mapStoreErr(err)
}

func (s *Store) ReviewAccount(
	ctx context.Context,
	actingAccountID, targetAccountID int64,
	decision string,
	now time.Time,
) error {
	err := s.WithOwner(ctx, actingAccountID, func(ctx context.Context, tx pgx.Tx) error {
		var reviewed bool
		if err := tx.QueryRow(ctx,
			`SELECT vc.identity_admin_review_account_current($1, $2, $3)`,
			targetAccountID, decision, now.UTC()).Scan(&reviewed); err != nil {
			return err
		}
		if !reviewed {
			return ErrNotFound
		}
		return nil
	})
	return mapStoreErr(err)
}

func normalizeDeviceName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "当前设备"
	}
	if utf8.RuneCountInString(value) <= 120 {
		return value
	}
	runes := []rune(value)
	return string(runes[:120])
}
