package httpapi

import (
	"net/http"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestRetiredGenerationRoutesStayUnregistered(t *testing.T) {
	t.Parallel()
	store := &ageGenerationStore{memStore: newMemStore()}
	store.ages[1] = postgres.AgeState{State: postgres.AgeAdultVerified}
	s := newCoreServer(t, "full", store)
	body := `{"idempotencyKey":"retired","userContent":"hello","mode":"AUTO"}`
	cases := []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v1/conversations/1/generations"},
		{http.MethodPost, "/api/v1/generations/1/cancel"},
		{http.MethodGet, "/api/v1/generations/1/snapshot"},
		{http.MethodGet, "/api/v1/realtime/streams/42"},
	}
	for _, tc := range cases {
		rec := doJSON(t, s, tc.method, tc.path, body, 1)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s -> %d %s, want 404", tc.method, tc.path, rec.Code, rec.Body.String())
		}
		if store.starts != 0 {
			t.Fatalf("StartTurn calls = %d after %s %s", store.starts, tc.method, tc.path)
		}
	}
	feedback := doJSON(t, s, http.MethodPost, "/api/v1/generations/1/feedback", `{"kind":"UNSAFE"}`, 1)
	if feedback.Code == http.StatusMethodNotAllowed || strings.Contains(feedback.Body.String(), "404 page not found") {
		t.Fatalf("feedback route missing: %d %s", feedback.Code, feedback.Body.String())
	}
}
