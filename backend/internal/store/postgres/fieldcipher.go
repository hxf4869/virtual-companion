package postgres

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// FieldCipher is the Go port of Java RestFieldCipher (CRYPTO-REST / S0-17-B).
//
// Write form (only write path):
//
//	enc2:<keyId>:<positiveVersion>:<standard-padded-base64(iv || ciphertext || gcmTag)>
//
// AES-256-GCM, 12-byte IV, 16-byte tag, no AAD, standard Base64 with padding.
// Dual-read of enc1: and legacy plaintext is a migration-window reader only.
//
// Deletion: Phase 6 after every protected column is current enc2, backup
// restore is verified, and enc1/plaintext/unrecognized counts are 0
// (redesign §14.5). Go never writes enc1 or plaintext.
const (
	enc2Prefix     = "enc2:"
	enc1Prefix     = "enc1:"
	ivLength       = 12
	gcmTagLength   = 16
	aesKeyBytes    = 32
	defaultKeyID   = "default"
	defaultVersion = 1
)

var keyIDPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)

// FieldCipher encrypts to the current enc2 slot and dual-reads enc2/enc1/plaintext.
type FieldCipher struct {
	writeKeyID      string
	writeKeyVersion int
	writeKey        []byte
	readKeys        map[string][]byte
	legacyEnc1Key   []byte
}

// NewFieldCipher builds a cipher that writes enc2:<keyId>:<version>:…
func NewFieldCipher(keyID string, version int, keyBase64 string) (*FieldCipher, error) {
	return NewFieldCipherWithPrevious(keyID, version, keyBase64, "", 0, "")
}

// NewDefaultFieldCipher writes enc2:default:1: under the supplied key.
func NewDefaultFieldCipher(keyBase64 string) (*FieldCipher, error) {
	return NewFieldCipher(defaultKeyID, defaultVersion, keyBase64)
}

// NewFieldCipherWithPrevious dual-reads the previous enc2 slot and uses it
// (when present) as the enc1 key, matching RestFieldCipher.
func NewFieldCipherWithPrevious(
	keyID string,
	version int,
	keyBase64 string,
	previousKeyID string,
	previousKeyVersion int,
	previousKeyBase64 string,
) (*FieldCipher, error) {
	id, err := requireKeyID(keyID)
	if err != nil {
		return nil, err
	}
	if version <= 0 {
		return nil, fmt.Errorf("rest encryption key version must be a positive integer")
	}
	writeKey, err := material(keyBase64)
	if err != nil {
		return nil, fmt.Errorf("rest encryption key: %w", err)
	}
	readKeys := map[string][]byte{slot(id, version): writeKey}
	legacy := writeKey
	if strings.TrimSpace(previousKeyBase64) != "" {
		prevID := previousKeyID
		if strings.TrimSpace(prevID) == "" {
			prevID = id
		} else {
			prevID, err = requireKeyID(prevID)
			if err != nil {
				return nil, err
			}
		}
		prevVersion := previousKeyVersion
		if prevVersion <= 0 {
			prevVersion = version - 1
		}
		if prevVersion <= 0 {
			return nil, fmt.Errorf("previous rest encryption key version must be a positive integer")
		}
		if prevID == id && prevVersion == version {
			return nil, fmt.Errorf("previous rest encryption key must differ from the write key")
		}
		prevKey, err := material(previousKeyBase64)
		if err != nil {
			return nil, fmt.Errorf("previous rest encryption key: %w", err)
		}
		readKeys[slot(prevID, prevVersion)] = prevKey
		legacy = prevKey
	}
	return &FieldCipher{
		writeKeyID:      id,
		writeKeyVersion: version,
		writeKey:        writeKey,
		readKeys:        readKeys,
		legacyEnc1Key:   legacy,
	}, nil
}

// CurrentPrefix is the write slot, e.g. enc2:default:1:
func (c *FieldCipher) CurrentPrefix() string {
	return enc2Prefix + c.writeKeyID + ":" + strconv.Itoa(c.writeKeyVersion) + ":"
}

func (c *FieldCipher) WriteKeyID() string   { return c.writeKeyID }
func (c *FieldCipher) WriteKeyVersion() int { return c.writeKeyVersion }

// IsEncrypted reports whether stored is an enc1 or enc2 envelope.
func IsEncrypted(stored string) bool {
	return strings.HasPrefix(stored, enc2Prefix) || strings.HasPrefix(stored, enc1Prefix)
}

// Encrypt writes plaintext as current enc2. It never writes enc1 or plaintext.
func (c *FieldCipher) Encrypt(plaintext string) (string, error) {
	payload, err := seal(c.writeKey, []byte(plaintext))
	if err != nil {
		return "", err
	}
	return c.CurrentPrefix() + base64.StdEncoding.EncodeToString(payload), nil
}

// Decrypt dual-reads enc2 (matching key slot), enc1 (legacyEnc1Key), or
// returns legacy plaintext unchanged. Malformed enc2/enc1 fail closed.
func (c *FieldCipher) Decrypt(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if strings.HasPrefix(stored, enc2Prefix) {
		parsed, err := parseEnc2(stored)
		if err != nil {
			return "", err
		}
		key, ok := c.readKeys[slot(parsed.keyID, parsed.version)]
		if !ok {
			return "", fmt.Errorf("stored rest cipher references an unknown key id/version")
		}
		plain, err := open(parsed.payload, key)
		if err != nil {
			return "", err
		}
		return string(plain), nil
	}
	if strings.HasPrefix(stored, enc1Prefix) {
		payload, err := base64.StdEncoding.DecodeString(stored[len(enc1Prefix):])
		if err != nil {
			return "", fmt.Errorf("stored rest cipher is malformed")
		}
		plain, err := open(payload, c.legacyEnc1Key)
		if err != nil {
			return "", err
		}
		return string(plain), nil
	}
	return stored, nil
}

// NeedsReencrypt is true for plaintext, enc1, or enc2 under a non-current slot.
func (c *FieldCipher) NeedsReencrypt(stored string) (bool, error) {
	if stored == "" {
		return false, nil
	}
	if strings.HasPrefix(stored, enc2Prefix) {
		parsed, err := parseEnc2(stored)
		if err != nil {
			return false, err
		}
		return slot(c.writeKeyID, c.writeKeyVersion) != slot(parsed.keyID, parsed.version), nil
	}
	return true, nil
}

// Reencrypt decrypts then writes current enc2. Current enc2 is returned unchanged.
func (c *FieldCipher) Reencrypt(stored string) (string, error) {
	need, err := c.NeedsReencrypt(stored)
	if err != nil {
		return "", err
	}
	if stored == "" || !need {
		return stored, nil
	}
	plain, err := c.Decrypt(stored)
	if err != nil {
		return "", err
	}
	return c.Encrypt(plain)
}

// encryptEnc1 produces the pre-S0-17-B form under the write key. Production
// never calls this; golden-vector tests need a real enc1 blob.
func (c *FieldCipher) encryptEnc1(plaintext string) (string, error) {
	payload, err := seal(c.writeKey, []byte(plaintext))
	if err != nil {
		return "", err
	}
	return enc1Prefix + base64.StdEncoding.EncodeToString(payload), nil
}

type parsedEnc2 struct {
	keyID   string
	version int
	payload []byte
}

func parseEnc2(stored string) (parsedEnc2, error) {
	rest := stored[len(enc2Prefix):]
	first := strings.IndexByte(rest, ':')
	second := -1
	if first >= 0 {
		second = strings.IndexByte(rest[first+1:], ':')
		if second >= 0 {
			second += first + 1
		}
	}
	if first <= 0 || second <= first+1 || second == len(rest)-1 {
		return parsedEnc2{}, fmt.Errorf("stored rest cipher is malformed")
	}
	keyID := rest[:first]
	versionText := rest[first+1 : second]
	payloadText := rest[second+1:]
	if !keyIDPattern.MatchString(keyID) {
		return parsedEnc2{}, fmt.Errorf("stored rest cipher is malformed")
	}
	version, err := strconv.Atoi(versionText)
	if err != nil || version <= 0 {
		return parsedEnc2{}, fmt.Errorf("stored rest cipher is malformed")
	}
	payload, err := base64.StdEncoding.DecodeString(payloadText)
	if err != nil {
		return parsedEnc2{}, fmt.Errorf("stored rest cipher is malformed")
	}
	return parsedEnc2{keyID: keyID, version: version, payload: payload}, nil
}

func seal(key, plaintext []byte) ([]byte, error) {
	iv := make([]byte, ivLength)
	if _, err := rand.Read(iv); err != nil {
		return nil, fmt.Errorf("rest field encryption failed")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("rest field encryption failed")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("rest field encryption failed")
	}
	if gcm.NonceSize() != ivLength || gcm.Overhead() != gcmTagLength {
		return nil, fmt.Errorf("rest field encryption failed")
	}
	sealed := gcm.Seal(nil, iv, plaintext, nil) // ciphertext || tag; AAD = none
	out := make([]byte, 0, len(iv)+len(sealed))
	out = append(out, iv...)
	out = append(out, sealed...)
	return out, nil
}

func open(stored []byte, key []byte) ([]byte, error) {
	if len(stored) <= ivLength {
		return nil, fmt.Errorf("stored rest cipher is truncated")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("stored rest cipher failed the integrity check")
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("stored rest cipher failed the integrity check")
	}
	plain, err := gcm.Open(nil, stored[:ivLength], stored[ivLength:], nil)
	if err != nil {
		return nil, fmt.Errorf("stored rest cipher failed the integrity check")
	}
	return plain, nil
}

func requireKeyID(keyID string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(keyID))
	if !keyIDPattern.MatchString(normalized) {
		return "", fmt.Errorf("rest encryption key id must match [a-z][a-z0-9-]{0,31}")
	}
	return normalized, nil
}

func slot(keyID string, version int) string {
	return keyID + ":" + strconv.Itoa(version)
}

func material(base64Key string) ([]byte, error) {
	if base64Key == "" {
		return nil, fmt.Errorf("must not be null")
	}
	keyBytes, err := base64.StdEncoding.DecodeString(base64Key)
	if err != nil {
		return nil, fmt.Errorf("is not valid base64")
	}
	if len(keyBytes) != aesKeyBytes {
		return nil, fmt.Errorf("must be 32 bytes (AES-256)")
	}
	return keyBytes, nil
}
