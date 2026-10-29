package httpapi

import (
	"context"
	"net/http"
	"reflect"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// recordingTurns registers the conditional generation feedback route.
// memStore does not implement GenerationAPI, so New leaves that route off.
type recordingTurns struct{}

func (recordingTurns) StartTurn(context.Context, int64, postgres.StartTurn) (postgres.GenerationView, error) {
	return postgres.GenerationView{}, nil
}

func (recordingTurns) CancelTurn(context.Context, int64, int64) (postgres.GenerationView, error) {
	return postgres.GenerationView{}, nil
}

func (recordingTurns) GenerationSnapshot(context.Context, int64, int64) (postgres.GenerationSnapshot, error) {
	return postgres.GenerationSnapshot{}, nil
}

func (recordingTurns) RecordGenerationFeedback(context.Context, int64, int64, string, string) (postgres.GenerationFeedback, error) {
	return postgres.GenerationFeedback{}, nil
}

// TestRegisteredRoutesHaveOperationNames walks the live ServeMux registry.
// net/http.ServeMux does not export its patterns. Go 1.26 and 1.27 keep them
// in the unexported routing index (index.segments and index.multis); that is
// the registry registerErr writes. A missing index fails the test instead of
// falling back to a hand-maintained list.
func TestRegisteredRoutesHaveOperationNames(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	if s.core == nil || s.core.Turns != nil {
		t.Fatal("full test server must register core routes with Turns unset")
	}
	s.core.Turns = recordingTurns{}
	s.registerGeneration()

	patterns, err := registeredPatterns(s.mux)
	if err != nil {
		t.Fatalf("cannot walk route registry: %v", err)
	}
	if len(patterns) < 100 {
		t.Fatalf("registry walk returned %d patterns, want the full server mux", len(patterns))
	}
	for _, pattern := range []string{
		"GET /actuator/health",
		"POST /api/v1/st/bindings",
		"POST /api/v1/st/sources/reconcile",
		"POST /api/v1/st/memory/recall",
		"POST /api/v1/service/st/profile",
		"GET /api/v1/memory-auto-save-pref",
		"PUT /api/v1/memory-auto-save-pref",
		"GET /api/v1/admin/accounts",
		"POST /api/v1/admin/accounts/{accountId}/review",
		"POST /api/v1/generations/{generationId}/feedback",
	} {
		if _, ok := patterns[pattern]; !ok {
			t.Errorf("registry missing %s", pattern)
		}
	}

	want := map[string]string{
		"/api/v1/st/bindings":                          "st_binding",
		"/api/v1/st/sources/reconcile":                 "st_source_reconcile",
		"/api/v1/st/memory/recall":                     "st_memory_recall",
		"/api/v1/service/st/profile":                   "service_st_profile",
		"/api/v1/memory-auto-save-pref":                "memory_auto_save_pref",
		"/api/v1/admin/accounts":                       "admin_accounts",
		"/api/v1/admin/accounts/1/review":              "admin_account_review",
		"/api/v1/admin/accounts/1/authenticator-reset": "admin_authenticator_reset",
	}
	for pattern := range patterns {
		path := operationSamplePath(pattern)
		got := operation(path)
		if got == "unmapped" {
			t.Errorf("operation(%q) from %s = unmapped", path, pattern)
		}
		if name, ok := want[path]; ok && got != name {
			t.Errorf("operation(%q) = %q, want %q", path, got, name)
		}
	}
}

func registeredPatterns(mux *http.ServeMux) (map[string]struct{}, error) {
	index := reflect.ValueOf(mux).Elem().FieldByName("index")
	if !index.IsValid() {
		return nil, errNoRouteIndex
	}
	out := map[string]struct{}{}
	collect := func(slice reflect.Value) {
		if !slice.IsValid() || slice.Kind() != reflect.Slice {
			return
		}
		for i := 0; i < slice.Len(); i++ {
			p := slice.Index(i)
			if p.Kind() != reflect.Pointer || p.IsNil() {
				continue
			}
			str := p.Elem().FieldByName("str")
			if !str.IsValid() || str.Kind() != reflect.String {
				continue
			}
			if s := str.String(); s != "" {
				out[s] = struct{}{}
			}
		}
	}
	segments := index.FieldByName("segments")
	if segments.IsValid() && segments.Kind() == reflect.Map && !segments.IsNil() {
		for _, key := range segments.MapKeys() {
			collect(segments.MapIndex(key))
		}
	}
	collect(index.FieldByName("multis"))
	if len(out) == 0 {
		return nil, errEmptyRouteIndex
	}
	return out, nil
}

func operationSamplePath(pattern string) string {
	path := pattern
	if i := strings.IndexByte(path, ' '); i >= 0 {
		path = path[i+1:]
	}
	for {
		open := strings.IndexByte(path, '{')
		if open < 0 {
			return path
		}
		rel := strings.IndexByte(path[open:], '}')
		if rel < 0 {
			return path
		}
		path = path[:open] + "1" + path[open+rel+1:]
	}
}

type routeIndexError string

func (e routeIndexError) Error() string { return string(e) }

const (
	errNoRouteIndex    routeIndexError = "net/http.ServeMux has no index field; registry cannot be walked"
	errEmptyRouteIndex routeIndexError = "route index was empty"
)

func TestOperationSamplePath(t *testing.T) {
	t.Parallel()
	got := operationSamplePath("POST /api/v1/story/runs/{runId}/actors/{actorId}/view")
	if got != "/api/v1/story/runs/1/actors/1/view" {
		t.Fatalf("sample path %q", got)
	}
}
