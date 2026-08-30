package auth

import (
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// DummyPassword is the timing-equalization input hashed at construction.
// It is not an account password and is never accepted as a login success
// for an unknown account (the caller still treats identity as missing).
const DummyPassword = "virtual-companion-timing-equalization"

// Password compares BCrypt hashes compatible with Spring Security's
// BCryptPasswordEncoder (strength 10, $2a$). Hashing is provided for tests
// and later login; this package does not issue sessions or JWT.
type Password struct {
	dummyHash []byte
}

// NewPassword generates one dummy BCrypt hash so unknown-account compares
// cost the same as a real stored hash.
func NewPassword() (*Password, error) {
	h, err := Hash(DummyPassword)
	if err != nil {
		return nil, err
	}
	return &Password{dummyHash: []byte(h)}, nil
}

// Hash returns a $2a$ BCrypt hash at the Spring default cost (10).
func Hash(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("password hash failed")
	}
	return string(h), nil
}

// Compare reports whether password matches a stored BCrypt hash.
// Invalid hashes return false (fail closed, matching PasswordEncoder.matches).
func Compare(password, hash string) bool {
	if hash == "" {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// DummyCompare runs a real BCrypt compare against the constructor dummy
// hash so an unknown-account path cannot skip the work. The boolean is the
// dummy match only; callers must still fail closed when no account exists.
func (p *Password) DummyCompare(password string) bool {
	if p == nil {
		return false
	}
	return bcrypt.CompareHashAndPassword(p.dummyHash, []byte(password)) == nil
}

// MatchStored compares password to storedHash when known is true, otherwise
// to the dummy hash. Returns true only when the account is known and the
// password matches. Always runs one BCrypt compare.
func (p *Password) MatchStored(password, storedHash string, known bool) bool {
	if known {
		return Compare(password, storedHash)
	}
	_ = p.DummyCompare(password)
	return false
}
