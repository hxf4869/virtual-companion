package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	authSessionPath        = "/api/v1/auth/session"
	authSessionStoragePath = authSessionPath + "?include=chatStorage"
)

type authChatStorageStore struct {
	*memStore
	state   postgres.ChatStorageState
	readErr error
	owners  []int64
}

func (s *authChatStorageStore) GetChatStorageState(_ context.Context, owner int64) (postgres.ChatStorageState, error) {
	s.owners = append(s.owners, owner)
	return s.state, s.readErr
}

func TestAuthSessionChatStorageFailureIsOptIn(t *testing.T) {
	t.Parallel()
	store := &authChatStorageStore{memStore: newMemStore(), readErr: errors.New("synthetic authority outage")}
	s := newCoreServer(t, "full", store)
	get := authSessionRequests(t, s, 1)

	first := get(authSessionPath)
	assertChatStorageSession(t, first, nil)
	if len(store.owners) != 0 {
		t.Fatal("ordinary session queried chat authority")
	}

	included := get(authSessionStoragePath)
	if included.Code != http.StatusServiceUnavailable {
		t.Fatalf("included status %d, want 503", included.Code)
	}
	assertEnvelope(t, included, "SCHEMA_UNAVAILABLE")
	if !reflect.DeepEqual(store.owners, []int64{1}) {
		t.Fatalf("authority owners %v, want [1]", store.owners)
	}

	second := get(authSessionPath)
	assertChatStorageSession(t, second, nil)
	if first.Body.String() != second.Body.String() || len(store.owners) != 1 {
		t.Fatalf("ordinary session changed after authority error, authority calls=%d", len(store.owners))
	}

	s.core.AuthFlow = nil
	for _, path := range []string{authSessionPath, authSessionStoragePath} {
		rec := get(path)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("auth flow outage status %d, want 503", rec.Code)
		}
		assertEnvelope(t, rec, "INVALID_REQUEST")
	}
	if len(store.owners) != 1 {
		t.Fatal("failed authentication flow queried chat authority")
	}
}

func TestAuthSessionChatStorageRequestShape(t *testing.T) {
	t.Parallel()
	store := &authChatStorageStore{memStore: newMemStore(), state: postgres.ChatStorageState{Mode: "GO", AuthorityEpoch: 9007199254740993}}
	s := newCoreServer(t, "full", store)

	for _, query := range []string{
		"?include", "?include=", "?include=unknown", "?include=chatStorage,unknown", "?include=%ZZ",
		"?include=chatStorage&include=chatStorage", "?include=chatStorage&%69nclude=%ZZ",
	} {
		t.Run(query, func(t *testing.T) {
			rec := doJSON(t, s, http.MethodGet, authSessionPath+query, "", 1)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status %d, want 400", rec.Code)
			}
			assertEnvelope(t, rec, "INVALID_REQUEST")
		})
	}
	if len(store.owners) != 0 {
		t.Fatal("invalid include queried chat authority")
	}

	ordinary := doJSON(t, s, http.MethodGet, authSessionPath+"?unrelated=%ZZ", "", 1)
	assertChatStorageSession(t, ordinary, nil)
	head := doJSON(t, s, http.MethodHead, authSessionStoragePath, "", 1)
	if head.Code != http.StatusOK || len(store.owners) != 0 {
		t.Fatalf("HEAD status=%d, authority calls=%d", head.Code, len(store.owners))
	}
	rec := doJSON(t, s, http.MethodGet, authSessionPath+"?%69nclude=chat%53torage", "", 2)
	body := assertChatStorageSession(t, rec, map[string]any{"mode": "GO", "authorityEpoch": "9007199254740993"})
	if body["accountId"] != "2" || body["role"] != "USER" || !reflect.DeepEqual(store.owners, []int64{2}) {
		t.Fatalf("incorrect authenticated owner: account=%v role=%v getter owners=%v", body["accountId"], body["role"], store.owners)
	}
}

func TestAuthSessionChatStorageRequiresCurrentSession(t *testing.T) {
	t.Parallel()
	store := &authChatStorageStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	req := httptest.NewRequest(http.MethodGet, authSessionStoragePath, nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status %d, want 401", rec.Code)
	}
	assertEnvelope(t, rec, "AUTHENTICATION_REQUIRED")

	attachAuth(t, s, req, 1, false)
	req.Header.Set(expectedAccountHeader, "2")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("foreign account status %d, want 409", rec.Code)
	}
	assertEnvelope(t, rec, "ACCOUNT_CONTEXT_CHANGED")
	if len(store.owners) != 0 {
		t.Fatal("rejected session queried chat authority")
	}
}

func authSessionRequests(t *testing.T, s *Server, owner int64) func(string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, authSessionPath, nil)
	attachAuth(t, s, request, owner, false)
	return func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header = request.Header.Clone()
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		return rec
	}
}

func assertChatStorageSession(t *testing.T, rec *httptest.ResponseRecorder, want map[string]any) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("session status %d, want 200", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	state, present := body["chatStorage"]
	if want == nil {
		if present {
			t.Fatal("ordinary session returned chatStorage")
		}
	} else if !present || !reflect.DeepEqual(state, want) {
		t.Fatalf("chatStorage=%v, want %v", state, want)
	}
	return body
}
