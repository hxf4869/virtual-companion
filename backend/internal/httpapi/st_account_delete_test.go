package httpapi

import (
	"context"
	"net/http"
	"testing"
)

func (m *memStore) RegisterSTProfile(context.Context, int64, string) error  { return nil }
func (m *memStore) ClearSTAccountData(context.Context, int64) (bool, error) { return true, nil }

func (m *memStore) ClearMemoryCoreAccountData(context.Context, int64) (bool, error) { return true, nil }

type pendingSTDeletionStore struct {
	*memStore
	pending bool
}

func (m *pendingSTDeletionStore) ClearSTAccountData(context.Context, int64) (bool, error) {
	return !m.pending, nil
}
func TestAccountDeleteDoesNotCascadeWhileSTCleanupIsPending(t *testing.T) {
	t.Parallel()
	m := &pendingSTDeletionStore{memStore: newMemStore(), pending: true}
	s := newCoreServer(t, "full", m)
	body := `{"currentPassword":"` + testPassword + `"}`
	response := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", body, 1)
	if response.Code != http.StatusAccepted {
		t.Fatalf("pending deletion status=%d", response.Code)
	}
	if m.deleted {
		t.Fatal("Go account was deleted before ST confirmation")
	}
	response = doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", `{"chatIdentity":"pending","characterRef":"c","mode":"COMPANION"}`, 1)
	if response.Code != http.StatusConflict {
		t.Fatalf("deleting owner business write=%d", response.Code)
	}
	m.pending = false
	response = doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", body, 1)
	if response.Code != http.StatusOK || !m.deleted {
		t.Fatalf("completed deletion status=%d deleted=%v", response.Code, m.deleted)
	}
}
