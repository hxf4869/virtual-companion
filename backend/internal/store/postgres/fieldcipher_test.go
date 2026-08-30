package postgres

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const (
	testKey      = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="
	testOtherKey = "MW4ybjNuNHI1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmM="
	testPlain    = "drill-message-plaintext"
)

func TestEnc2RoundTripAndPrefix(t *testing.T) {
	t.Parallel()
	c, err := NewDefaultFieldCipher(testKey)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := c.Encrypt(testPlain)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc2:default:1:") {
		t.Fatalf("prefix %q", stored)
	}
	if !strings.HasPrefix(stored, c.CurrentPrefix()) {
		t.Fatalf("current prefix %q vs %q", c.CurrentPrefix(), stored)
	}
	got, err := c.Decrypt(stored)
	if err != nil {
		t.Fatal(err)
	}
	if got != testPlain {
		t.Fatalf("plain %q", got)
	}
	need, err := c.NeedsReencrypt(stored)
	if err != nil || need {
		t.Fatalf("needsReencrypt %v %v", need, err)
	}
}

func TestEnc2UsesStandardPaddedBase64AndFreshIV(t *testing.T) {
	t.Parallel()
	c, err := NewDefaultFieldCipher(testKey)
	if err != nil {
		t.Fatal(err)
	}
	a, err := c.Encrypt("same text")
	if err != nil {
		t.Fatal(err)
	}
	b, err := c.Encrypt("same text")
	if err != nil {
		t.Fatal(err)
	}
	if a == b {
		t.Fatal("IV must be fresh per value")
	}
	payload := strings.TrimPrefix(a, "enc2:default:1:")
	if strings.ContainsAny(payload, "-_") {
		t.Fatalf("must not use URL-safe base64: %s", payload)
	}
	if len(payload)%4 != 0 {
		t.Fatalf("standard base64 must be padded, len=%d", len(payload))
	}
}

func TestLegacyPlaintextDualRead(t *testing.T) {
	t.Parallel()
	c, err := NewDefaultFieldCipher(testKey)
	if err != nil {
		t.Fatal(err)
	}
	got, err := c.Decrypt("pre-encryption row")
	if err != nil || got != "pre-encryption row" {
		t.Fatalf("plaintext dual-read %q %v", got, err)
	}
	need, err := c.NeedsReencrypt("pre-encryption row")
	if err != nil || !need {
		t.Fatalf("plaintext must need reencrypt")
	}
	need, err = c.NeedsReencrypt("")
	if err != nil || need {
		t.Fatalf("empty must not need reencrypt")
	}
	rewritten, err := c.Reencrypt("pre-encryption row")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rewritten, "enc2:default:1:") {
		t.Fatalf("reencrypt %q", rewritten)
	}
	got, err = c.Decrypt(rewritten)
	if err != nil || got != "pre-encryption row" {
		t.Fatalf("reencrypt round trip %q %v", got, err)
	}
}

func TestEnc1DualReadThenCheckpointWritesEnc2(t *testing.T) {
	t.Parallel()
	original, err := NewDefaultFieldCipher(testKey)
	if err != nil {
		t.Fatal(err)
	}
	enc1, err := original.encryptEnc1("legacy-body")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(enc1, "enc1:") {
		t.Fatalf("enc1 %q", enc1)
	}
	upgraded, err := NewFieldCipher("default", 1, testKey)
	if err != nil {
		t.Fatal(err)
	}
	got, err := upgraded.Decrypt(enc1)
	if err != nil || got != "legacy-body" {
		t.Fatalf("enc1 decrypt %q %v", got, err)
	}
	need, err := upgraded.NeedsReencrypt(enc1)
	if err != nil || !need {
		t.Fatal("enc1 must need reencrypt")
	}
	rewritten, err := upgraded.Reencrypt(enc1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rewritten, "enc2:default:1:") {
		t.Fatalf("checkpoint %q", rewritten)
	}
	got, err = upgraded.Decrypt(rewritten)
	if err != nil || got != "legacy-body" {
		t.Fatalf("checkpoint decrypt %q %v", got, err)
	}
	again, err := upgraded.Reencrypt(rewritten)
	if err != nil || again != rewritten {
		t.Fatalf("current enc2 must not churn IV")
	}
}

func TestPreviousKeyReadsEnc1AndPreviousEnc2(t *testing.T) {
	t.Parallel()
	v1, err := NewFieldCipher("k", 1, testKey)
	if err != nil {
		t.Fatal(err)
	}
	enc1, err := v1.encryptEnc1("rotated-body")
	if err != nil {
		t.Fatal(err)
	}
	enc2v1, err := v1.Encrypt("rotated-body")
	if err != nil {
		t.Fatal(err)
	}
	v2, err := NewFieldCipherWithPrevious("k", 2, testOtherKey, "k", 1, testKey)
	if err != nil {
		t.Fatal(err)
	}
	got, err := v2.Decrypt(enc1)
	if err != nil || got != "rotated-body" {
		t.Fatalf("enc1 after rotation %q %v", got, err)
	}
	got, err = v2.Decrypt(enc2v1)
	if err != nil || got != "rotated-body" {
		t.Fatalf("enc2 v1 after rotation %q %v", got, err)
	}
	need, err := v2.NeedsReencrypt(enc2v1)
	if err != nil || !need {
		t.Fatal("previous enc2 must need reencrypt")
	}
	rewritten, err := v2.Reencrypt(enc2v1)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rewritten, "enc2:k:2:") {
		t.Fatalf("write slot %q", rewritten)
	}
	fresh, err := v2.Encrypt("fresh")
	if err != nil {
		t.Fatal(err)
	}
	got, err = v2.Decrypt(fresh)
	if err != nil || got != "fresh" {
		t.Fatalf("fresh %q %v", got, err)
	}
}

func TestUnknownKeyAndTamperFailClosed(t *testing.T) {
	t.Parallel()
	writer, err := NewFieldCipher("alpha", 1, testKey)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := writer.Encrypt("secret")
	if err != nil {
		t.Fatal(err)
	}
	other, err := NewFieldCipher("beta", 1, testKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := other.Decrypt(stored); err == nil || !strings.Contains(err.Error(), "unknown key") {
		t.Fatalf("unknown key: %v", err)
	}
	tampered := stored[:len(stored)-2] + "AA"
	if _, err := writer.Decrypt(tampered); err == nil {
		t.Fatal("tamper must fail")
	}
	wrong, err := NewDefaultFieldCipher(testOtherKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := wrong.Decrypt(stored); err == nil {
		t.Fatal("wrong key must fail integrity")
	}
}

func TestRejectsAADAndURLSafePayload(t *testing.T) {
	t.Parallel()
	c, err := NewDefaultFieldCipher(testKey)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := c.Encrypt("x")
	if err != nil {
		t.Fatal(err)
	}
	payload := strings.TrimPrefix(stored, "enc2:default:1:")
	urlSafe := strings.NewReplacer("+", "-", "/", "_").Replace(strings.TrimRight(payload, "="))
	if _, err := c.Decrypt("enc2:default:1:" + urlSafe); err == nil {
		t.Fatal("URL-safe / no-padding payload must fail closed")
	}
}

func TestGoDecryptsJavaGoldenVectors(t *testing.T) {
	t.Parallel()
	v := loadCryptoVectors(t)
	c, err := NewDefaultFieldCipher(v.Rest.KeyBase64)
	if err != nil {
		t.Fatal(err)
	}
	if v.Rest.JavaEnc2 == "" || v.Rest.JavaEnc1 == "" {
		t.Fatal("java golden vectors missing")
	}
	got, err := c.Decrypt(v.Rest.JavaEnc2)
	if err != nil || got != v.Rest.Plaintext {
		t.Fatalf("java enc2: %q %v", got, err)
	}
	got, err = c.Decrypt(v.Rest.JavaEnc1)
	if err != nil || got != v.Rest.Plaintext {
		t.Fatalf("java enc1: %q %v", got, err)
	}
	got, err = c.Decrypt(v.Rest.LegacyPlaintext)
	if err != nil || got != v.Rest.LegacyPlaintext {
		t.Fatalf("legacy plaintext: %q %v", got, err)
	}
}

func TestProductionCipherNeverWritesEnc1(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("fieldcipher.go")
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(src, []byte("func (c *FieldCipher) EncryptEnc1")) {
		t.Fatal("enc1 must not be a public write path")
	}
}

type cryptoVectors struct {
	Rest struct {
		KeyBase64       string `json:"keyBase64"`
		OtherKeyBase64  string `json:"otherKeyBase64"`
		Plaintext       string `json:"plaintext"`
		GoEnc2          string `json:"goEnc2"`
		JavaEnc2        string `json:"javaEnc2"`
		GoEnc1          string `json:"goEnc1"`
		JavaEnc1        string `json:"javaEnc1"`
		LegacyPlaintext string `json:"legacyPlaintext"`
	} `json:"rest"`
	OwnerHMAC struct {
		Secret   string `json:"secret"`
		Owner    int64  `json:"owner"`
		PID      string `json:"pid"`
		Xact     string `json:"xact"`
		Nonce    string `json:"nonce"`
		ProofHex string `json:"proofHex"`
	} `json:"ownerHMAC"`
	Bcrypt struct {
		Password string `json:"password"`
		GoHash   string `json:"goHash"`
		JavaHash string `json:"javaHash"`
	} `json:"bcrypt"`
	JWT struct {
		Secret       string `json:"secret"`
		Issuer       string `json:"issuer"`
		AccountID    int64  `json:"accountId"`
		Role         string `json:"role"`
		Username     string `json:"username"`
		SessionEpoch int64  `json:"sessionEpoch"`
		GoToken      string `json:"goToken"`
		JavaToken    string `json:"javaToken"`
	} `json:"jwt"`
}

func loadCryptoVectors(t *testing.T) cryptoVectors {
	t.Helper()
	path := filepath.Join(backendRoot(t), "contracttest", "testdata", "crypto-vectors.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v cryptoVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func backendRoot(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	dir := filepath.Dir(file)
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		dir = filepath.Dir(dir)
	}
	t.Fatal("backend root not found")
	return ""
}
