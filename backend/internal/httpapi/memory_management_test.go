package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) managedRow(id int64) json.RawMessage {
	mem := m.memories[id]
	v := 1
	var prior *int64
	for _, p := range m.memories {
		if p.SupersededByMemoryID != nil && *p.SupersededByMemoryID == id {
			n := p.ID
			prior = &n
			v = 2
		}
	}
	lifecycle := "ACTIVE"
	if mem.SupersededAt != nil {
		lifecycle = "SUPERSEDED"
	}
	cleanup := "NONE"
	if mem.DeletedAt != nil {
		lifecycle = "FORGETTING"
		cleanup = "PENDING"
	}
	out := map[string]any{"memoryId": idString(id), "relationshipId": idString(mem.RelationshipID), "version": v, "summary": mem.Summary, "status": mem.Status, "scope": mem.Scope, "autoSaved": mem.AutoSaved, "mode": "DAILY", "type": "FACT", "lifecycle": lifecycle, "sourceStatus": "VALID", "recallEligible": lifecycle == "ACTIVE", "time": map[string]any{"recordedAt": mem.CreatedAt}, "cleanup": map[string]string{"state": cleanup}, "history": []any{}, "supersedesMemoryId": optID(prior), "supersededByMemoryId": optID(mem.SupersededByMemoryID)}
	raw, _ := json.Marshal(out)
	return raw
}
func (m *memStore) ListManagedMemories(_ context.Context, _ int64, rel int64, _ postgres.MemoryFilters) ([]json.RawMessage, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := []json.RawMessage{}
	for id, mem := range m.memories {
		if mem.RelationshipID == rel {
			out = append(out, m.managedRow(id))
		}
	}
	return out, "", nil
}
func (m *memStore) GetManagedMemory(_ context.Context, _ int64, id int64) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.memories[id]; !ok {
		return nil, postgres.ErrNotFound
	}
	return m.managedRow(id), nil
}
func (m *memStore) ManagedMemoryEvidence(ctx context.Context, owner, id int64) ([]json.RawMessage, error) {
	v, e := m.ListMemoryEvidence(ctx, owner, id)
	out := []json.RawMessage{}
	for _, r := range v {
		b, _ := json.Marshal(memoryEvidenceJSON{EvidenceID: idString(r.ID), SourceRef: r.SourceRef, CreatedAt: rfc3339(r.CreatedAt)})
		out = append(out, b)
	}
	return out, e
}
func (m *memStore) CorrectManagedMemory(_ context.Context, _ int64, id, version int64, summary string) (json.RawMessage, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	old, ok := m.memories[id]
	if !ok {
		return nil, postgres.ErrNotFound
	}
	if version != 1 || old.SupersededAt != nil || old.DeletedAt != nil {
		return nil, postgres.ErrMemoryVersionConflict
	}
	newID := m.next
	m.next++
	next := old
	next.ID = newID
	next.Summary = summary
	m.memories[newID] = next
	now := time.Now()
	old.SupersededAt = &now
	old.SupersededByMemoryID = &newID
	m.memories[id] = old
	return m.managedRow(newID), nil
}
func (m *memStore) ForgetManagedMemory(ctx context.Context, owner, id int64) error {
	_, err := m.DeleteMemory(ctx, owner, id)
	return err
}

func managedWrite(t *testing.T, s *Server, method, path, body string, fresh bool) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	attachAuth(t, s, r, 1, true)
	if fresh {
		store := s.core.Store.(*memStore)
		store.mu.Lock()
		for k, v := range store.sessions {
			v.ReauthAt = time.Now()
			store.sessions[k] = v
		}
		store.mu.Unlock()
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}
func TestMemoryCorrectionRequiresVersionAndFreshReauth(t *testing.T) {
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	store.memories[90] = postgres.Memory{ID: 90, RelationshipID: 1, Status: "ACCEPTED", Summary: "old"}
	stale := managedWrite(t, s, http.MethodPatch, "/api/v1/memories/90", `{"summary":"new","expectedVersion":1}`, false)
	if stale.Code != 403 {
		t.Fatalf("stale status=%d", stale.Code)
	}
	missing := managedWrite(t, s, http.MethodPatch, "/api/v1/memories/90", `{"summary":"new"}`, true)
	if missing.Code != 400 {
		t.Fatalf("missing version status=%d", missing.Code)
	}
	first := managedWrite(t, s, http.MethodPatch, "/api/v1/memories/90", `{"summary":"new","expectedVersion":1}`, true)
	if first.Code != 200 {
		t.Fatalf("correct status=%d %s", first.Code, first.Body.String())
	}
	conflict := managedWrite(t, s, http.MethodPatch, "/api/v1/memories/90", `{"summary":"other","expectedVersion":1}`, true)
	if conflict.Code != 409 {
		t.Fatalf("conflict status=%d", conflict.Code)
	}
	assertEnvelope(t, conflict, "MEMORY_VERSION_CONFLICT")
}
