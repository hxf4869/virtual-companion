package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// memStore gains the V66 pref surface here: a missing owner reads as enabled,
// matching the SQL default.
func (m *memStore) GetMemoryAutoSavePref(_ context.Context, owner int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if enabled, ok := m.memoryAutoSave[owner]; ok {
		return enabled, nil
	}
	return true, nil
}

func (m *memStore) UpdateMemoryAutoSavePref(_ context.Context, owner int64, enabled bool) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.memoryAutoSave[owner] = enabled
	return enabled, nil
}

func TestMemoryAutoSavePrefRoundTripAndIsolation(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)

	got := doJSON(t, s, http.MethodGet, "/api/v1/memory-auto-save-pref", "", 1)
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"enabled":true`) {
		t.Fatalf("default pref %d %s", got.Code, got.Body.String())
	}

	put := doJSON(t, s, http.MethodPut, "/api/v1/memory-auto-save-pref", `{"enabled":false}`, 1)
	if put.Code != http.StatusOK || !strings.Contains(put.Body.String(), `"enabled":false`) {
		t.Fatalf("update pref %d %s", put.Code, put.Body.String())
	}

	after := doJSON(t, s, http.MethodGet, "/api/v1/memory-auto-save-pref", "", 1)
	if after.Code != http.StatusOK || !strings.Contains(after.Body.String(), `"enabled":false`) {
		t.Fatalf("pref after update %d %s", after.Code, after.Body.String())
	}

	// Cross-account isolation: owner 2 keeps the default.
	other := doJSON(t, s, http.MethodGet, "/api/v1/memory-auto-save-pref", "", 2)
	if other.Code != http.StatusOK || !strings.Contains(other.Body.String(), `"enabled":true`) {
		t.Fatalf("owner 2 pref %d %s", other.Code, other.Body.String())
	}

	bad := doJSON(t, s, http.MethodPut, "/api/v1/memory-auto-save-pref", `{}`, 1)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("missing enabled %d %s", bad.Code, bad.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/memory-auto-save-pref", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated %d", rec.Code)
	}
}
