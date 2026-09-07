//go:build integration

package postgres

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/pquerna/otp/totp"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// totpFixtureSecret is a synthetic 20-byte base32 key; it never corresponds to
// any real credential.
const totpFixtureSecret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"

// armTOTPAccount inserts an ACTIVE identity account for the fixture vc_user
// and binds the fixture TOTP key to it.
func armTOTPAccount(t *testing.T, accountID int64, username string) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(),
		`INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
		 VALUES ($1, $2, 'fixture-not-a-password', 'USER', 'ACTIVE', $2)`, accountID, username); err != nil {
		t.Fatal(err)
	}
	ciphertext, err := testEnv.store.cipher.Encrypt(totpFixtureSecret)
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(context.Background(),
		`UPDATE vc.identity_account
		    SET totp_secret_ciphertext = $2, totp_enabled_at = now(),
		        totp_last_consumed_step = NULL
		  WHERE id = $1`, accountID, ciphertext); err != nil {
		t.Fatal(err)
	}
}

func completeTOTPVerify(t *testing.T, store *Store, accountID int64, code string, now time.Time) (AuthenticatedSession, bool, error) {
	t.Helper()
	challenge, err := store.CreateAuthChallenge(context.Background(), accountID, AuthChallengeTOTPVerify, now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	return store.CompleteAuthChallenge(context.Background(), AuthCompleteInput{
		ChallengeID:      challenge.ID,
		Mode:             AuthChallengeTOTPVerify,
		Method:           AuthMethodTOTP,
		Code:             code,
		Now:              now,
		SessionExpiresAt: now.Add(time.Hour),
	})
}

func accountSessionCount(t *testing.T, accountID int64) int {
	t.Helper()
	raw, err := psqlSuper(`SELECT count(*) FROM vc.identity_opaque_session WHERE account_id = ` + itoa(accountID))
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if _, err := fmt.Sscan(raw, &n); err != nil {
		t.Fatal(err)
	}
	return n
}

// T-61/T-63: consuming a code binds it to the matched timestep for the whole
// account — a second challenge inside the same window cannot reuse it, while
// the next window's code stays valid.
func TestTOTPStepConsumedOncePerAccount(t *testing.T) {
	resetFixtures(t)
	armTOTPAccount(t, 1, "alice")
	store := testEnv.store
	now := time.Unix(1_800_000_000, 0).UTC()

	code, err := totp.GenerateCode(totpFixtureSecret, now)
	if err != nil {
		t.Fatal(err)
	}

	first, ok, err := completeTOTPVerify(t, store, 1, code, now)
	if err != nil || !ok || first.SessionID == 0 {
		t.Fatalf("first completion ok=%v err=%v", ok, err)
	}

	second, ok, err := completeTOTPVerify(t, store, 1, code, now)
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Fatal("replayed code created a second session")
	}
	if second.SessionID != 0 {
		t.Fatalf("replayed completion returned session %+v", second)
	}
	if n := accountSessionCount(t, 1); n != 1 {
		t.Fatalf("session count %d, want 1", n)
	}

	nextCode, err := totp.GenerateCode(totpFixtureSecret, now.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := completeTOTPVerify(t, store, 1, nextCode, now); err != nil || !ok {
		t.Fatalf("next-step code rejected ok=%v err=%v", ok, err)
	}
	if n := accountSessionCount(t, 1); n != 2 {
		t.Fatalf("session count %d, want 2", n)
	}

	// The adjacent earlier step is a regressed (already passed) record: once
	// the later step is consumed, the earlier window's code cannot re-enter.
	olderCode, err := totp.GenerateCode(totpFixtureSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := completeTOTPVerify(t, store, 1, olderCode, now.Add(30*time.Second)); err != nil || ok {
		t.Fatalf("regressed step accepted ok=%v err=%v", ok, err)
	}
}

// T-62: concurrent completions of the same step serialize on the account row
// lock and at most one session is created.
func TestTOTPConcurrentVerificationSingleWinner(t *testing.T) {
	resetFixtures(t)
	armTOTPAccount(t, 1, "alice")
	store := testEnv.store
	now := time.Unix(1_800_000_000, 0).UTC()

	code, err := totp.GenerateCode(totpFixtureSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	challenges := make([]string, 2)
	for i := range challenges {
		challenge, err := store.CreateAuthChallenge(context.Background(), 1, AuthChallengeTOTPVerify, now.Add(5*time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		challenges[i] = challenge.ID
	}

	var wg sync.WaitGroup
	wins := make([]bool, 2)
	for i, challengeID := range challenges {
		wg.Add(1)
		go func(i int, challengeID string) {
			defer wg.Done()
			_, ok, err := store.CompleteAuthChallenge(context.Background(), AuthCompleteInput{
				ChallengeID:      challengeID,
				Mode:             AuthChallengeTOTPVerify,
				Method:           AuthMethodTOTP,
				Code:             code,
				Now:              now,
				SessionExpiresAt: now.Add(time.Hour),
			})
			// A loser either sees the consumed step (valid=false) or hits the
			// SQL invariant abort; both mean no second session.
			if err == nil && ok {
				wins[i] = true
			}
		}(i, challengeID)
	}
	wg.Wait()

	won := 0
	for _, w := range wins {
		if w {
			won++
		}
	}
	if won != 1 {
		t.Fatalf("winners %d, want 1", won)
	}
	if n := accountSessionCount(t, 1); n != 1 {
		t.Fatalf("session count %d, want 1", n)
	}
}

// T-64: a completion that fails after validation must not record the consumed
// step — the same code is retryable in a clean transaction.
func TestTOTPFailedCompletionDoesNotConsumeStep(t *testing.T) {
	resetFixtures(t)
	armTOTPAccount(t, 1, "alice")
	store := testEnv.store
	now := time.Unix(1_800_000_000, 0).UTC()

	code, err := totp.GenerateCode(totpFixtureSecret, now)
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := store.CreateAuthChallenge(context.Background(), 1, AuthChallengeTOTPVerify, now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	// Invalid request shape: the completion raises after the code validated
	// and the whole transaction rolls back.
	if _, _, err := store.CompleteAuthChallenge(context.Background(), AuthCompleteInput{
		ChallengeID:      challenge.ID,
		Mode:             AuthChallengeTOTPVerify,
		Method:           AuthMethodTOTP,
		Code:             code,
		Now:              now,
		SessionExpiresAt: now, // <= Now: invalid, raises inside the transaction
	}); err == nil {
		t.Fatal("expected invalid completion to fail")
	}

	retried, ok, err := completeTOTPVerify(t, store, 1, code, now)
	if err != nil || !ok || retried.SessionID == 0 {
		t.Fatalf("retry after failed completion ok=%v err=%v", ok, err)
	}
}

// First binding consumes the step under the new key's semantics, and an old
// key's record can neither block the new key nor survive its enrollment.
func TestTOTPEnrollConsumesStepAndReplacesRecord(t *testing.T) {
	resetFixtures(t)
	if err := IsolationSuperExec(context.Background(),
		`INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
		 VALUES (1, 'alice', 'fixture-not-a-password', 'USER', 'ACTIVE', 'alice')`); err != nil {
		t.Fatal(err)
	}
	// A stale record from a previous key sits at the enrollment window's step.
	staleStep := time.Unix(1_800_000_000, 0).UTC().Unix() / 30
	if err := IsolationSuperExec(context.Background(),
		`UPDATE vc.identity_account SET totp_last_consumed_step = $1 WHERE id = 1`,
		staleStep); err != nil {
		t.Fatal(err)
	}
	store := testEnv.store
	now := time.Unix(1_800_000_000, 0).UTC()

	challenge, err := store.CreateAuthChallenge(context.Background(), 1, AuthChallengeTOTPEnroll, now.Add(5*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AuthenticatorSetup(context.Background(), challenge.ID, now); err != nil {
		t.Fatal(err)
	}
	pendingCipher, err := psqlSuper("SELECT pending_totp_secret_ciphertext FROM vc.identity_auth_challenge WHERE id = '" + challenge.ID + "'")
	if err != nil {
		t.Fatal(err)
	}
	secret, err := store.cipher.Decrypt(pendingCipher)
	if err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(secret, now)
	if err != nil {
		t.Fatal(err)
	}

	session, ok, err := store.CompleteAuthChallenge(context.Background(), AuthCompleteInput{
		ChallengeID:      challenge.ID,
		Mode:             AuthChallengeTOTPEnroll,
		Method:           AuthMethodTOTP,
		Code:             code,
		Now:              now,
		SessionExpiresAt: now.Add(time.Hour),
	})
	if err != nil || !ok || session.SessionID == 0 {
		t.Fatalf("enrollment completion ok=%v err=%v", ok, err)
	}
	if len(session.RecoveryCodes) != auth.RecoveryCodeCount {
		t.Fatalf("recovery codes %d, want %d", len(session.RecoveryCodes), auth.RecoveryCodeCount)
	}

	// The same code cannot open a VERIFY challenge in the same window: the
	// enrollment already consumed its step under the new key.
	verifyCode := code
	if _, ok, err := completeTOTPVerify(t, store, 1, verifyCode, now); err != nil || ok {
		t.Fatalf("post-enroll replay accepted ok=%v err=%v", ok, err)
	}
	nextCode, err := totp.GenerateCode(secret, now.Add(30*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := completeTOTPVerify(t, store, 1, nextCode, now); err != nil || !ok {
		t.Fatalf("next-step code after enroll rejected ok=%v err=%v", ok, err)
	}
}
