package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestMemoryRetrievalStaysClosedUntilRestoreGateOpens(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	store.memories[7] = postgres.Memory{ID: 7, RelationshipID: 1, Summary: "synthetic-derived-memory", Status: "ACCEPTED", Scope: "RELATIONSHIP"}
	s := newCoreServer(t, "full", store)
	gate := filepath.Join(t.TempDir(), "restore-gate.json")
	if err := os.WriteFile(gate, []byte(`{"blocked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	s.cfg.RestoreGateFile = gate
	blocked := doJSON(t, s, http.MethodGet, "/api/v1/relationships/1/memories", "", 1)
	if blocked.Code != http.StatusServiceUnavailable {
		t.Fatalf("status %d body %s", blocked.Code, blocked.Body.String())
	}
	if !strings.Contains(blocked.Body.String(), "RESTORE_GATE_CLOSED") {
		t.Fatalf("body %s", blocked.Body.String())
	}
	if strings.Contains(blocked.Body.String(), "synthetic-derived-memory") {
		t.Fatal("deleted-path memory was returned while the restore gate was closed")
	}
	if err := os.Remove(gate); err != nil {
		t.Fatal(err)
	}
	opened := doJSON(t, s, http.MethodGet, "/api/v1/relationships/1/memories", "", 1)
	if opened.Code == http.StatusServiceUnavailable && strings.Contains(opened.Body.String(), "RESTORE_GATE_CLOSED") {
		t.Fatalf("gate still closed: %s", opened.Body.String())
	}
}
