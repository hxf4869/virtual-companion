package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type ageGenerationStore struct {
	*memStore
	ageReadErr error
	starts     int
}

func (m *ageGenerationStore) GetAgeState(ctx context.Context, owner int64) (postgres.AgeState, error) {
	if m.ageReadErr != nil {
		return postgres.AgeState{}, m.ageReadErr
	}
	return m.memStore.GetAgeState(ctx, owner)
}

func (m *ageGenerationStore) StartTurn(_ context.Context, _ int64, in postgres.StartTurn) (postgres.GenerationView, error) {
	m.starts++
	return postgres.GenerationView{
		ID:                  7,
		ConversationID:      in.ConversationID,
		LogicalGenerationID: "age-gated-generation",
		Status:              "QUEUED",
		Mode:                in.Mode,
		CreatedAt:           time.Unix(7, 0).UTC(),
		Created:             true,
	}, nil
}

func (m *ageGenerationStore) CancelTurn(context.Context, int64, int64) (postgres.GenerationView, error) {
	return postgres.GenerationView{}, postgres.ErrNotFound
}

func (m *ageGenerationStore) GenerationSnapshot(context.Context, int64, int64) (postgres.GenerationSnapshot, error) {
	return postgres.GenerationSnapshot{}, postgres.ErrNotFound
}

func (m *ageGenerationStore) RecordGenerationFeedback(context.Context, int64, int64, string, string) (postgres.GenerationFeedback, error) {
	return postgres.GenerationFeedback{}, postgres.ErrNotFound
}

func (m *memStore) GetAgeState(_ context.Context, owner int64) (postgres.AgeState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, ok := m.ages[owner]
	if !ok {
		return postgres.AgeState{State: postgres.AgeUnknown}, nil
	}
	return state, nil
}

func (m *memStore) VerifyAge(_ context.Context, owner int64) (postgres.AgeState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	current, ok := m.ages[owner]
	if ok {
		switch current.State {
		case postgres.AgeAdultVerified:
			return current, nil
		case postgres.AgeMinorSuspected, postgres.AgeMinorVerified,
			postgres.AgeAppealPending, postgres.AgeAccessSuspended:
			return postgres.AgeState{}, postgres.ErrInvalid
		}
	}
	provider := "alpha-simulated"
	verifiedAt := time.Unix(6, 0).UTC()
	state := postgres.AgeState{
		State:       postgres.AgeAdultVerified,
		ProviderRef: &provider,
		VerifiedAt:  &verifiedAt,
	}
	m.ages[owner] = state
	return state, nil
}

func TestAgeStateAndSimulatedVerification(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)

	initial := doJSON(t, s, http.MethodGet, "/api/v1/age/state", "", 1)
	if initial.Code != http.StatusOK {
		t.Fatalf("initial status %d: %s", initial.Code, initial.Body.String())
	}
	var unknown ageStateJSON
	if err := json.Unmarshal(initial.Body.Bytes(), &unknown); err != nil {
		t.Fatal(err)
	}
	if unknown.AgeState != postgres.AgeUnknown || unknown.ProviderRef != nil || unknown.VerifiedAt != nil {
		t.Fatalf("unexpected unknown state: %+v", unknown)
	}

	verified := doJSON(t, s, http.MethodPost, "/api/v1/age/verification", "", 1)
	if verified.Code != http.StatusOK {
		t.Fatalf("verify status %d: %s", verified.Code, verified.Body.String())
	}
	var adult ageStateJSON
	if err := json.Unmarshal(verified.Body.Bytes(), &adult); err != nil {
		t.Fatal(err)
	}
	if adult.AgeState != postgres.AgeAdultVerified || adult.ProviderRef == nil || *adult.ProviderRef != "alpha-simulated" || adult.VerifiedAt == nil {
		t.Fatalf("unexpected verified state: %+v", adult)
	}

	ownerRead := doJSON(t, s, http.MethodGet, "/api/v1/age/state", "", 1)
	if ownerRead.Body.String() != verified.Body.String() {
		t.Fatalf("stored state mismatch: verify=%s get=%s", verified.Body.String(), ownerRead.Body.String())
	}
	foreignRead := doJSON(t, s, http.MethodGet, "/api/v1/age/state", "", 2)
	if !strings.Contains(foreignRead.Body.String(), `"ageState":"AGE_UNKNOWN"`) {
		t.Fatalf("owner state leaked: %s", foreignRead.Body.String())
	}
}

func TestAgeVerificationUsesWriteGuards(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/age/verification", nil)
	attachAuth(t, s, req, 1, false)
	req.Header.Set("Origin", "https://vc.test")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing csrf status %d: %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
	state, err := store.GetAgeState(req.Context(), 1)
	if err != nil || state.State != postgres.AgeUnknown {
		t.Fatalf("guarded write changed state: %+v err=%v", state, err)
	}
}

func TestAgeVerificationFailsClosedForMinorState(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	store.ages[1] = postgres.AgeState{State: postgres.AgeMinorVerified}
	s := newCoreServer(t, "full", store)
	rec := doJSON(t, s, http.MethodPost, "/api/v1/age/verification", "", 1)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("minor verify status %d: %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "INVALID_REQUEST")
}

func TestAgeVerificationRequiresOpaqueSession(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	req := httptest.NewRequest(http.MethodGet, "/api/v1/age/state", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "AUTHENTICATION_REQUIRED")
}

func TestGenerationRequiresAdultVerificationBeforePersistence(t *testing.T) {
	t.Parallel()
	store := &ageGenerationStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	body := `{"idempotencyKey":"age-gate","userContent":"hello","mode":"AUTO"}`

	blocked := doJSON(t, s, http.MethodPost, "/api/v1/conversations/1/generations", body, 1)
	if blocked.Code != http.StatusForbidden {
		t.Fatalf("unknown age status %d: %s", blocked.Code, blocked.Body.String())
	}
	assertEnvelope(t, blocked, "AGE_VERIFICATION_REQUIRED")
	if store.starts != 0 {
		t.Fatalf("StartTurn called before adult verification: %d", store.starts)
	}

	store.ages[1] = postgres.AgeState{State: postgres.AgeAdultVerified}
	accepted := doJSON(t, s, http.MethodPost, "/api/v1/conversations/1/generations", body, 1)
	if accepted.Code != http.StatusAccepted {
		t.Fatalf("adult status %d: %s", accepted.Code, accepted.Body.String())
	}
	if store.starts != 1 {
		t.Fatalf("StartTurn calls = %d, want 1", store.starts)
	}
}

func TestGenerationRejectsEveryNonVerifiedAgeState(t *testing.T) {
	t.Parallel()
	states := []string{
		postgres.AgeUnknown,
		postgres.AgeAdultSelfDeclared,
		postgres.AgeAdultVerificationRequired,
		postgres.AgeMinorSuspected,
		postgres.AgeMinorVerified,
		postgres.AgeAppealPending,
		postgres.AgeReverifyRequired,
		postgres.AgeAccessSuspended,
	}
	for _, state := range states {
		state := state
		t.Run(state, func(t *testing.T) {
			store := &ageGenerationStore{memStore: newMemStore()}
			store.ages[1] = postgres.AgeState{State: state}
			s := newCoreServer(t, "full", store)
			body := `{"idempotencyKey":"age-state","userContent":"hello","mode":"AUTO"}`

			rec := doJSON(t, s, http.MethodPost, "/api/v1/conversations/1/generations", body, 1)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
			}
			assertEnvelope(t, rec, "AGE_VERIFICATION_REQUIRED")
			if store.starts != 0 {
				t.Fatalf("StartTurn called for %s: %d", state, store.starts)
			}
		})
	}
}

func TestGenerationAgeReadFailureFailsClosed(t *testing.T) {
	t.Parallel()
	store := &ageGenerationStore{
		memStore:   newMemStore(),
		ageReadErr: errors.New("age store unavailable"),
	}
	s := newCoreServer(t, "full", store)
	body := `{"idempotencyKey":"age-read-failure","userContent":"hello","mode":"AUTO"}`

	rec := doJSON(t, s, http.MethodPost, "/api/v1/conversations/1/generations", body, 1)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "INVALID_REQUEST")
	if store.starts != 0 {
		t.Fatalf("StartTurn called after failed age read: %d", store.starts)
	}
}
