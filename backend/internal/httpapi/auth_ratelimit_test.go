package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// seedAuthChallenges creates count enroll challenges for alice (AccountID=1),
// whose authenticator is not yet enabled, so each ID is accepted by the
// authenticator-confirm endpoint and a wrong code yields 404 rather than success.
func seedAuthChallenges(t *testing.T, store *memStore, count int) []string {
	t.Helper()
	ids := make([]string, 0, count)
	for i := 0; i < count; i++ {
		challenge, err := store.CreateAuthChallenge(
			context.Background(), 1, postgres.AuthChallengeTOTPEnroll, time.Now().Add(5*time.Minute),
		)
		if err != nil {
			t.Fatal(err)
		}
		ids = append(ids, challenge.ID)
	}
	return ids
}

func postWrongAuthenticatorCode(t *testing.T, s *Server, challengeID string) *httptest.ResponseRecorder {
	t.Helper()
	return doJSONCookies(t, s, http.MethodPost,
		"/api/v1/auth/challenges/"+challengeID+"/authenticator-confirm",
		`{"code":"000000","trustDevice":false}`, nil)
}

func TestAuthChallengeRateLimitIndependentChallengesNotCrowded(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	ids := seedAuthChallenges(t, store, 6)
	// 6 requests stay under the per-source limit (10/min), so the shared empty
	// account dimension must not turn the 6th independent challenge into 429.
	for i, id := range ids {
		rec := postWrongAuthenticatorCode(t, s, id)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("challenge %d rate limited: %d %s", i+1, rec.Code, rec.Body.String())
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("challenge %d code %d body %s", i+1, rec.Code, rec.Body.String())
		}
	}
}

func TestAuthChallengeRateLimitSameChallengeStillCapped(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	id := seedAuthChallenges(t, store, 1)[0]
	for i := 0; i < 5; i++ {
		rec := postWrongAuthenticatorCode(t, s, id)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("attempt %d code %d body %s", i+1, rec.Code, rec.Body.String())
		}
	}
	rec := postWrongAuthenticatorCode(t, s, id)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("attempt 6 code %d body %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "AUTH_RATE_LIMITED")
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
}

func TestAuthChallengeRateLimitSourceCapStillApplies(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	ids := seedAuthChallenges(t, store, 11)
	for i, id := range ids[:10] {
		rec := postWrongAuthenticatorCode(t, s, id)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("challenge %d rate limited: %d %s", i+1, rec.Code, rec.Body.String())
		}
		if rec.Code != http.StatusNotFound {
			t.Fatalf("challenge %d code %d body %s", i+1, rec.Code, rec.Body.String())
		}
	}
	rec := postWrongAuthenticatorCode(t, s, ids[10])
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("challenge 11 code %d body %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "AUTH_RATE_LIMITED")
}
