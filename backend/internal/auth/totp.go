package auth

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"image/png"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	TOTPIssuer        = "Virtual Companion"
	RecoveryCodeCount = 10
)

// TOTPProvisioning is shown only during an active authenticator setup challenge.
type TOTPProvisioning struct {
	ManualKey       string `json:"manualKey"`
	ProvisioningURI string `json:"provisioningUri"`
	QRCodeDataURL   string `json:"qrCodeDataUrl"`
}

// NewTOTP creates one RFC 6238 secret compatible with common authenticator apps.
func NewTOTP(accountName string) (TOTPProvisioning, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      TOTPIssuer,
		AccountName: accountName,
		Period:      30,
		SecretSize:  20,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return TOTPProvisioning{}, fmt.Errorf("generate TOTP: %w", err)
	}
	return provisioningFromKey(key)
}

// TOTPFromSecret restores the same provisioning response for an existing
// unexpired setup challenge instead of silently rotating its pending secret.
func TOTPFromSecret(accountName, secret string) (TOTPProvisioning, error) {
	rawSecret, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return TOTPProvisioning{}, fmt.Errorf("decode TOTP secret: %w", err)
	}
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      TOTPIssuer,
		AccountName: accountName,
		Period:      30,
		SecretSize:  20,
		Secret:      rawSecret,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
	if err != nil {
		return TOTPProvisioning{}, fmt.Errorf("restore TOTP provisioning: %w", err)
	}
	return provisioningFromKey(key)
}

func provisioningFromKey(key *otp.Key) (TOTPProvisioning, error) {
	qrImage, err := key.Image(220, 220)
	if err != nil {
		return TOTPProvisioning{}, fmt.Errorf("render TOTP QR: %w", err)
	}
	var qr bytes.Buffer
	if err := png.Encode(&qr, qrImage); err != nil {
		return TOTPProvisioning{}, fmt.Errorf("encode TOTP QR: %w", err)
	}
	return TOTPProvisioning{
		ManualKey:       key.Secret(),
		ProvisioningURI: key.URL(),
		QRCodeDataURL:   "data:image/png;base64," + base64.StdEncoding.EncodeToString(qr.Bytes()),
	}, nil
}

// ValidateTOTP accepts the current 30-second code and one adjacent step for
// ordinary clock drift.
func ValidateTOTP(secret, code string, now time.Time) bool {
	valid, err := totp.ValidateCustom(code, secret, now, totp.ValidateOpts{
		Period:    30,
		Skew:      1,
		Digits:    otp.DigitsSix,
		Algorithm: otp.AlgorithmSHA1,
	})
	return err == nil && valid
}

// NewRecoveryCodes returns user-visible one-time codes and their persisted hashes.
func NewRecoveryCodes(count int) ([]string, []string, error) {
	if count <= 0 {
		return nil, nil, fmt.Errorf("recovery code count must be positive")
	}
	plain := make([]string, 0, count)
	hashes := make([]string, 0, count)
	for range count {
		random := make([]byte, 10)
		if _, err := rand.Read(random); err != nil {
			return nil, nil, fmt.Errorf("generate recovery code: %w", err)
		}
		encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(random)
		code := strings.Join([]string{encoded[0:4], encoded[4:8], encoded[8:12], encoded[12:16]}, "-")
		plain = append(plain, code)
		hashes = append(hashes, RecoveryCodeHash(code))
	}
	return plain, hashes, nil
}

// RecoveryCodeHash is the only persisted recovery-code representation.
func RecoveryCodeHash(code string) string {
	normalized := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
	sum := sha256.Sum256([]byte("recovery:v1:" + normalized))
	return hex.EncodeToString(sum[:])
}
