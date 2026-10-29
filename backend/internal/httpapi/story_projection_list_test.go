package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type pendingProjectionHTTPStore struct {
	*memStore
	rows  []postgres.PendingStoryProjection
	calls int
	owner int64
	runID int64
}

func (m *pendingProjectionHTTPStore) ListPendingStoryProjections(_ context.Context, owner, runID int64) ([]postgres.PendingStoryProjection, error) {
	m.calls++
	m.owner = owner
	m.runID = runID
	if owner != 1 || runID != 11 {
		return nil, postgres.ErrNotFound
	}
	return append([]postgres.PendingStoryProjection(nil), m.rows...), nil
}

func TestListPendingStoryProjectionsIsSessionReadOnly(t *testing.T) {
	m := &pendingProjectionHTTPStore{
		memStore: newMemStore(),
		rows: []postgres.PendingStoryProjection{{
			EventID: 101, WorldVersion: 1, Text: "钥匙借用记录\n出示借据",
		}},
	}
	s := newCoreServer(t, "full", m)

	anon := httptest.NewRequest(http.MethodGet, "/api/v1/story/runs/11/projections?state=PENDING", nil)
	anonRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(anonRec, anon)
	if anonRec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous status=%d body=%s", anonRec.Code, anonRec.Body.String())
	}
	if m.calls != 0 {
		t.Fatalf("anonymous read called the store %d times", m.calls)
	}

	for _, path := range []string{
		"/api/v1/story/runs/11/projections",
		"/api/v1/story/runs/11/projections?state=CONFIRMED",
		"/api/v1/story/runs/11/projections?state=pending",
		"/api/v1/story/runs/11/projections?state=PENDING&owner=2",
	} {
		got := doJSON(t, s, http.MethodGet, path, "", 1)
		if got.Code != http.StatusBadRequest {
			t.Fatalf("%s status=%d body=%s", path, got.Code, got.Body.String())
		}
	}
	if m.calls != 0 {
		t.Fatalf("invalid query called the store %d times", m.calls)
	}

	foreign := doJSON(t, s, http.MethodGet, "/api/v1/story/runs/11/projections?state=PENDING", "", 2)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign status=%d body=%s", foreign.Code, foreign.Body.String())
	}
	if m.owner != 2 || m.runID != 11 {
		t.Fatalf("owner/run = %d/%d", m.owner, m.runID)
	}

	ok := doJSON(t, s, http.MethodGet, "/api/v1/story/runs/11/projections?state=PENDING", "", 1)
	if ok.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", ok.Code, ok.Body.String())
	}
	if m.owner != 1 || m.runID != 11 || m.calls != 2 {
		t.Fatalf("calls=%d owner=%d run=%d", m.calls, m.owner, m.runID)
	}
	body := ok.Body.String()
	for _, hidden := range []string{"PRIVATE_", "GM_ONLY_", "ruleId", "state_after", "visibility", "truth", "credential"} {
		if strings.Contains(body, hidden) {
			t.Fatalf("body contains %s: %s", hidden, body)
		}
	}
	var decoded map[string]json.RawMessage
	if err := json.Unmarshal(ok.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded) != 1 || decoded["projections"] == nil {
		t.Fatalf("keys = %#v", decoded)
	}
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(decoded["projections"], &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d", len(rows))
	}
	if len(rows[0]) != 3 || rows[0]["worldEventId"] == nil || rows[0]["worldVersion"] == nil || rows[0]["text"] == nil {
		t.Fatalf("projection keys = %#v", rows[0])
	}
	var listed []struct {
		WorldEventID string `json:"worldEventId"`
		WorldVersion int64  `json:"worldVersion"`
		Text         string `json:"text"`
	}
	if err := json.Unmarshal(decoded["projections"], &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].WorldEventID != "101" || listed[0].WorldVersion != 1 || listed[0].Text != "钥匙借用记录\n出示借据" {
		t.Fatalf("projection = %+v", listed)
	}
}

func TestListPendingStoryProjectionsEmptyIsAnArray(t *testing.T) {
	m := &pendingProjectionHTTPStore{memStore: newMemStore(), rows: []postgres.PendingStoryProjection{}}
	s := newCoreServer(t, "full", m)
	got := doJSON(t, s, http.MethodGet, "/api/v1/story/runs/11/projections?state=PENDING", "", 1)
	if got.Code != http.StatusOK || strings.TrimSpace(got.Body.String()) != `{"projections":[]}` {
		t.Fatalf("status=%d body=%s", got.Code, got.Body.String())
	}
}
