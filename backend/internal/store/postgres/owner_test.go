package postgres

import (
	"strings"
	"testing"
)

func TestBindingMessageIsDomainSeparated(t *testing.T) {
	t.Parallel()
	message := BindingMessage(42, "1234", "5678", "abcdef")
	if message != "vc-owner-binding-v1|42|1234|5678|abcdef" {
		t.Fatalf("message %q", message)
	}
	if BindingMessage(43, "1234", "5678", "abcdef") == message {
		t.Fatal("owner must bind")
	}
	if BindingMessage(42, "1235", "5678", "abcdef") == message {
		t.Fatal("pid must bind")
	}
	if BindingMessage(42, "1234", "5679", "abcdef") == message {
		t.Fatal("xact must bind")
	}
	if BindingMessage(42, "1234", "5678", "abcdeg") == message {
		t.Fatal("nonce must bind")
	}
}

func TestOwnerProofMatchesJavaGoldenVector(t *testing.T) {
	t.Parallel()
	v := loadCryptoVectors(t)
	proof := ProofFor(
		[]byte(v.OwnerHMAC.Secret),
		v.OwnerHMAC.Owner,
		v.OwnerHMAC.PID,
		v.OwnerHMAC.Xact,
		v.OwnerHMAC.Nonce,
	)
	if proof != v.OwnerHMAC.ProofHex {
		t.Fatalf("proof %s want %s", proof, v.OwnerHMAC.ProofHex)
	}
	if len(proof) != 64 {
		t.Fatalf("hex len %d", len(proof))
	}
	if proof != ProofFor([]byte(v.OwnerHMAC.Secret), v.OwnerHMAC.Owner, v.OwnerHMAC.PID, v.OwnerHMAC.Xact, v.OwnerHMAC.Nonce) {
		t.Fatal("proof must be deterministic")
	}
	if proof == ProofFor([]byte(v.OwnerHMAC.Secret), 43, v.OwnerHMAC.PID, v.OwnerHMAC.Xact, v.OwnerHMAC.Nonce) {
		t.Fatal("different owner must differ")
	}
	if strings.Contains(proof, v.OwnerHMAC.Secret) {
		t.Fatal("proof must not contain the key")
	}
}

func TestBindingSecretRejectedWhenShort(t *testing.T) {
	t.Parallel()
	if _, err := requireBindingSecret(""); err == nil {
		t.Fatal("empty secret")
	}
	if _, err := requireBindingSecret("short"); err == nil {
		t.Fatal("short secret")
	}
}
