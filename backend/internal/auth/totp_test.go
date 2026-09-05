package auth

import (
	"strings"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func TestTOTPProvisioningRoundTrip(t *testing.T) {
	t.Parallel()
	created, err := NewTOTP("alice@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if created.ManualKey == "" || !strings.HasPrefix(created.ProvisioningURI, "otpauth://totp/") ||
		!strings.HasPrefix(created.QRCodeDataURL, "data:image/png;base64,") {
		t.Fatalf("provisioning %+v", created)
	}
	restored, err := TOTPFromSecret("alice@example.com", created.ManualKey)
	if err != nil {
		t.Fatal(err)
	}
	if restored.ManualKey != created.ManualKey || restored.ProvisioningURI != created.ProvisioningURI {
		t.Fatal("restored provisioning changed the pending secret")
	}
	now := time.Unix(1_800_000_000, 0).UTC()
	code, err := totp.GenerateCode(created.ManualKey, now)
	if err != nil {
		t.Fatal(err)
	}
	if !ValidateTOTP(created.ManualKey, code, now) || ValidateTOTP(created.ManualKey, "000000", now) {
		t.Fatal("TOTP validation mismatch")
	}
}

func TestRecoveryCodesAreOneWayAndNormalized(t *testing.T) {
	t.Parallel()
	codes, hashes, err := NewRecoveryCodes(RecoveryCodeCount)
	if err != nil {
		t.Fatal(err)
	}
	if len(codes) != RecoveryCodeCount || len(hashes) != RecoveryCodeCount {
		t.Fatalf("counts %d/%d", len(codes), len(hashes))
	}
	seen := map[string]bool{}
	for i, code := range codes {
		if len(code) != 19 || seen[hashes[i]] {
			t.Fatalf("code %q hash duplicate=%v", code, seen[hashes[i]])
		}
		seen[hashes[i]] = true
		if RecoveryCodeHash(strings.ToLower(strings.ReplaceAll(code, "-", ""))) != hashes[i] {
			t.Fatal("recovery code normalization mismatch")
		}
		if strings.Contains(hashes[i], code) {
			t.Fatal("plaintext leaked into stored hash")
		}
	}
}
