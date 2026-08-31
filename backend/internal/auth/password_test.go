package auth

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestBcryptAcceptsCurrentAndLegacyCost10Hashes(t *testing.T) {
	t.Parallel()
	v := loadCryptoVectors(t)
	if !strings.HasPrefix(v.Bcrypt.GoHash, "$2a$10$") {
		t.Fatalf("go hash must be $2a$10$ got %s", v.Bcrypt.GoHash[:8])
	}
	if !Compare(v.Bcrypt.Password, v.Bcrypt.GoHash) {
		t.Fatal("go hash did not verify")
	}
	if v.Bcrypt.LegacyHash == "" {
		t.Fatal("legacy bcrypt golden vector missing")
	}
	if !strings.HasPrefix(v.Bcrypt.LegacyHash, "$2a$10$") {
		t.Fatalf("legacy hash must be $2a$10$")
	}
	if !Compare(v.Bcrypt.Password, v.Bcrypt.LegacyHash) {
		t.Fatal("legacy hash did not verify")
	}
	if Compare("wrong-password", v.Bcrypt.GoHash) {
		t.Fatal("wrong password")
	}
}

func TestUnknownAccountStillRunsDummyCompare(t *testing.T) {
	t.Parallel()
	p, err := NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	if p.MatchStored("Current-Pass-1!", "", false) {
		t.Fatal("unknown account must not succeed")
	}
	if p.DummyCompare(DummyPassword) != true {
		t.Fatal("dummy password should match dummy hash (timing path still fails closed via known=false)")
	}
	hash, err := Hash("real-password-ok")
	if err != nil {
		t.Fatal(err)
	}
	if !p.MatchStored("real-password-ok", hash, true) {
		t.Fatal("known account")
	}
	if p.MatchStored("nope", hash, true) {
		t.Fatal("wrong password")
	}
}

func TestHashUsesDefaultCost(t *testing.T) {
	t.Parallel()
	h, err := Hash("x")
	if err != nil {
		t.Fatal(err)
	}
	cost, err := bcrypt.Cost([]byte(h))
	if err != nil {
		t.Fatal(err)
	}
	if cost != bcrypt.DefaultCost || bcrypt.DefaultCost != 10 {
		t.Fatalf("cost %d", cost)
	}
}
