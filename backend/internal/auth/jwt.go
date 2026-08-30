// Package auth holds credential checks and the Go v1 opaque session.
//
// JWT verifier: only verifies HMAC access tokens issued by the Java
// runtime (JwtTokenService). Go must not issue JWT. The verifier is the
// api-migration read path; G9 opaque session is the full-mode writer.
// Deletion: Phase 5 / G13 after Owner re-login. Do not grow this into a
// second issuer (redesign §13.2, §17.2, G9, G13).
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash"
	"strconv"
	"strings"
	"time"
)

// Verifier checks Java-issued HMAC access tokens. It has no Issue/Sign method.
type Verifier struct {
	key    []byte
	issuer string
	now    func() time.Time
}

// Principal is the server-verified identity bound to a session or, during
// api-migration, a Java access token. AccountID is both the identity id and
// the owner_user_id used for RLS.
type Principal struct {
	AccountID          int64
	Role               string
	Username           string
	SessionEpoch       int64
	SessionID          int64
	ReauthAt           time.Time
	PasswordMustChange bool
}

// NewVerifier fails closed if the secret is shorter than 256 bits or issuer is blank.
func NewVerifier(secret, issuer string) (*Verifier, error) {
	if len(secret) < 32 {
		return nil, fmt.Errorf("JWT secret must be at least 256 bits")
	}
	if strings.TrimSpace(issuer) == "" {
		return nil, fmt.Errorf("issuer is required")
	}
	return &Verifier{
		key:    []byte(secret),
		issuer: issuer,
		now:    time.Now,
	}, nil
}

// VerifyAccessToken checks signature, issuer, expiry and required claims.
// Any failure returns nil (fail closed, never throws, never logs the token).
func (v *Verifier) VerifyAccessToken(token string) *Principal {
	if v == nil || strings.TrimSpace(token) == "" {
		return nil
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil
	}
	headerJSON, err := b64URL(parts[0])
	if err != nil {
		return nil
	}
	var header struct {
		Alg string `json:"alg"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil {
		return nil
	}
	hfn := hmacHash(header.Alg)
	if hfn == nil {
		return nil
	}
	mac := hmac.New(hfn, v.key)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	want := mac.Sum(nil)
	got, err := b64URL(parts[2])
	if err != nil || len(got) != len(want) {
		return nil
	}
	if subtle.ConstantTimeCompare(got, want) != 1 {
		return nil
	}
	payloadJSON, err := b64URL(parts[1])
	if err != nil {
		return nil
	}
	var claims struct {
		Iss      string `json:"iss"`
		Sub      string `json:"sub"`
		Role     string `json:"role"`
		Username string `json:"username"`
		Se       *int64 `json:"se"`
		Exp      *int64 `json:"exp"`
	}
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return nil
	}
	if claims.Iss != v.issuer {
		return nil
	}
	if claims.Role == "" || claims.Se == nil || *claims.Se < 1 {
		return nil
	}
	if claims.Exp == nil {
		return nil
	}
	now := v.now()
	if now.Unix() > *claims.Exp {
		return nil
	}
	accountID, err := strconv.ParseInt(claims.Sub, 10, 64)
	if err != nil || accountID <= 0 {
		return nil
	}
	return &Principal{
		AccountID:    accountID,
		Role:         claims.Role,
		Username:     claims.Username,
		SessionEpoch: *claims.Se,
	}
}

func hmacHash(alg string) func() hash.Hash {
	// jjwt Keys.hmacShaKeyFor + signWith(key) selects HS256/HS384/HS512 from
	// key length. The Java class comment says HS256; the shipped issuer
	// actually emits HS512 when the secret is >= 64 bytes (the test secret).
	switch strings.ToUpper(alg) {
	case "HS256":
		return sha256.New
	case "HS384":
		return sha512.New384
	case "HS512":
		return sha512.New
	default:
		return nil
	}
}

func b64URL(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(s)
}
