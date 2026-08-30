package postgres

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

// V27 domain tag; must equal vc._owner_binding_message's prefix.
const bindingDomain = "vc-owner-binding-v1"

const nonceBytes = 16

// BindingMessage is the canonical domain-separated message for one
// (owner, backend pid, transaction id, nonce) tuple. Java OwnerContext and
// vc._owner_binding_message must produce the same UTF-8 bytes.
func BindingMessage(ownerUserID int64, backendPID, xactID, nonce string) string {
	var b strings.Builder
	b.Grow(len(bindingDomain) + 64)
	b.WriteString(bindingDomain)
	b.WriteByte('|')
	b.WriteString(strconv.FormatInt(ownerUserID, 10))
	b.WriteByte('|')
	b.WriteString(backendPID)
	b.WriteByte('|')
	b.WriteString(xactID)
	b.WriteByte('|')
	b.WriteString(nonce)
	return b.String()
}

// ProofFor is the lowercase hex HMAC-SHA256 over BindingMessage keyed by
// the process owner-binding secret. The proof, key, and nonce are never
// logged.
func ProofFor(secret []byte, ownerUserID int64, backendPID, xactID, nonce string) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(BindingMessage(ownerUserID, backendPID, xactID, nonce)))
	return hex.EncodeToString(mac.Sum(nil))
}

func newNonce() (string, error) {
	raw := make([]byte, nonceBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("owner nonce generation failed")
	}
	return hex.EncodeToString(raw), nil
}

func requireBindingSecret(secret string) ([]byte, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, fmt.Errorf("VC_OWNER_BINDING_SECRET is required")
	}
	key := []byte(secret)
	if len(key) < 32 {
		return nil, fmt.Errorf("VC_OWNER_BINDING_SECRET must carry at least 32 bytes of key material")
	}
	return key, nil
}
