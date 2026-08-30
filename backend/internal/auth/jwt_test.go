package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestVerifierAcceptsJavaGoldenToken(t *testing.T) {
	t.Parallel()
	v := loadCryptoVectors(t)
	ver, err := NewVerifier(v.JWT.Secret, v.JWT.Issuer)
	if err != nil {
		t.Fatal(err)
	}
	if v.JWT.JavaToken == "" {
		t.Fatal("java JWT golden vector missing")
	}
	p := ver.VerifyAccessToken(v.JWT.JavaToken)
	if p == nil {
		t.Fatal("java token rejected")
	}
	if p.AccountID != v.JWT.AccountID || p.Role != v.JWT.Role || p.Username != v.JWT.Username || p.SessionEpoch != v.JWT.SessionEpoch {
		t.Fatalf("principal %+v", p)
	}
}

func TestVerifierAcceptsGoCompactMatchingJavaClaims(t *testing.T) {
	t.Parallel()
	v := loadCryptoVectors(t)
	ver, err := NewVerifier(v.JWT.Secret, v.JWT.Issuer)
	if err != nil {
		t.Fatal(err)
	}
	if v.JWT.GoToken == "" {
		t.Fatal("go JWT golden vector missing")
	}
	p := ver.VerifyAccessToken(v.JWT.GoToken)
	if p == nil {
		t.Fatal("go token rejected")
	}
	if p.AccountID != v.JWT.AccountID || p.SessionEpoch != v.JWT.SessionEpoch {
		t.Fatalf("principal %+v", p)
	}
}

func TestVerifierRejectsTamperedExpiredBlankAndWrongIssuer(t *testing.T) {
	t.Parallel()
	secret := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	ver, err := NewVerifier(secret, "virtual-companion")
	if err != nil {
		t.Fatal(err)
	}
	token := compactHS256(t, []byte(secret), map[string]any{
		"iss":      "virtual-companion",
		"sub":      "7",
		"role":     "USER",
		"username": "alice",
		"se":       1,
		"iat":      time.Now().Unix(),
		"exp":      time.Now().Add(2 * time.Hour).Unix(),
	})
	if ver.VerifyAccessToken(token) == nil {
		t.Fatal("valid token")
	}
	tampered := token[:len(token)-3] + "xyz"
	if ver.VerifyAccessToken(tampered) != nil {
		t.Fatal("tampered")
	}
	if ver.VerifyAccessToken("") != nil || ver.VerifyAccessToken("   ") != nil {
		t.Fatal("blank")
	}
	other := compactHS256(t, []byte(secret), map[string]any{
		"iss":      "other-issuer",
		"sub":      "7",
		"role":     "USER",
		"username": "alice",
		"se":       1,
		"exp":      time.Now().Add(2 * time.Hour).Unix(),
	})
	if ver.VerifyAccessToken(other) != nil {
		t.Fatal("wrong issuer")
	}
	expired := compactHS256(t, []byte(secret), map[string]any{
		"iss":      "virtual-companion",
		"sub":      "7",
		"role":     "USER",
		"username": "alice",
		"se":       1,
		"exp":      time.Now().Add(-2 * time.Hour).Unix(),
	})
	if ver.VerifyAccessToken(expired) != nil {
		t.Fatal("expired")
	}
	none := compactHS256(t, []byte(secret), map[string]any{
		"iss":  "virtual-companion",
		"sub":  "7",
		"role": "USER",
		"se":   1,
		"exp":  time.Now().Add(2 * time.Hour).Unix(),
	})
	// alg=none is rejected by header check in Verify; craft one manually.
	noneTok := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`)) + "." + strings.Split(none, ".")[1] + "." + strings.Split(none, ".")[2]
	if ver.VerifyAccessToken(noneTok) != nil {
		t.Fatal("alg none")
	}
}

func TestVerifierRejectsShortSecret(t *testing.T) {
	t.Parallel()
	if _, err := NewVerifier("short-secret", "vc"); err == nil {
		t.Fatal("short secret")
	}
}

func TestProductionVerifierSourceDoesNotIssue(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("jwt.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, needle := range []string{"func Issue", "func (v *Verifier) Issue", "func Sign", "Compact("} {
		if strings.Contains(string(src), needle) {
			t.Fatalf("verifier must not issue JWT, found %q", needle)
		}
	}
}

func compactHS256(t *testing.T, secret []byte, claims map[string]any) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	body, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	signing := header + "." + payload
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(signing))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signing + "." + sig
}
