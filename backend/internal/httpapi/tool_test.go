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

const toolUnitChat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"

func TestToolExecuteOperationName(t *testing.T) {
	if operation("/api/v1/st/tools/execute") != "tool_execute" {
		t.Fatal(operation("/api/v1/st/tools/execute"))
	}
}

func TestToolExecuteRejectsShapeBeforeStore(t *testing.T) {
	store := newToolHTTPStore()
	srv := newCoreServer(t, "full", store)
	cases := []string{
		`{"chatIdentity":"` + toolUnitChat + `"}`,
		`{"chatIdentity":"` + toolUnitChat + `","idempotencyKey":"short"}`,
		`{"chatIdentity":"NOT-A-UUID","idempotencyKey":"create-key-01"}`,
		`{"chatIdentity":"` + toolUnitChat + `","idempotencyKey":"create-key-01","purpose":"` + strings.Repeat("p", 65) + `"}`,
	}
	for _, body := range cases {
		rec := doJSON(t, srv, http.MethodPost, toolExecutePath, body, 1)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("body %s status %d %s", body, rec.Code, rec.Body.String())
		}
	}
	if len(store.calls) != 0 {
		t.Fatalf("store calls = %d", len(store.calls))
	}
	anon := httptest.NewRequest(http.MethodPost, toolExecutePath, strings.NewReader(`{"chatIdentity":"`+toolUnitChat+`","idempotencyKey":"create-key-01"}`))
	anon.Header.Set("Content-Type", "application/json")
	anon.Header.Set("Origin", "https://vc.test")
	anon.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	anon.Header.Set(csrfHeader, "csrf-token")
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous %d", rec.Code)
	}
}

func TestToolExecuteAuthIdempotencyAndAssistantText(t *testing.T) {
	store := newToolHTTPStore()
	srv := newCoreServer(t, "full", store)
	plain := newCoreServer(t, "full", newMemStore())
	rec := doJSON(t, plain, http.MethodPost, toolExecutePath, `{"chatIdentity":"`+toolUnitChat+`","idempotencyKey":"create-key-01","tool":"manage_reminder"}`, 1)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing store %d", rec.Code)
	}

	body := `{"chatIdentity":"` + toolUnitChat + `","idempotencyKey":"create-key-01","tool":"manage_reminder","arguments":{"action":"create","text":"buy milk","remindAt":"2026-11-02T15:04:00Z"},"purpose":"tool","modelRevision":"rev-1","step":1,"timeoutMs":1000,"tokenLimit":100}`
	rec = doJSON(t, srv, http.MethodPost, toolExecutePath, body, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("create %d %s", rec.Code, rec.Body.String())
	}
	first := decodeTool(t, rec)
	if first.ExecutionID == "" || first.Status != "SUCCEEDED" || first.Tool != "manage_reminder" {
		t.Fatalf("first = %+v", first)
	}
	rec = doJSON(t, srv, http.MethodPost, toolExecutePath, body, 1)
	second := decodeTool(t, rec)
	if second.ExecutionID != first.ExecutionID {
		t.Fatalf("replay = %+v want %s", second, first.ExecutionID)
	}
	if store.calls[0].Owner != 1 || store.calls[0].In.Tool != "manage_reminder" || store.calls[0].In.Assistant || store.calls[0].In.Forbidden {
		t.Fatalf("create call = %+v", store.calls[0])
	}

	utterance := "remind me tomorrow at the office"
	rec = doJSON(t, srv, http.MethodPost, toolExecutePath, `{"chatIdentity":"`+toolUnitChat+`","idempotencyKey":"assistant-text-01","role":"assistant","content":"`+utterance+`","utterance":"`+utterance+`"}`, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("assistant %d %s", rec.Code, rec.Body.String())
	}
	assistant := decodeTool(t, rec)
	if assistant.Status != "FAILED" || assistant.FailureCode == nil || *assistant.FailureCode != "ASSISTANT_TEXT" || assistant.Tool != "assistant_text" {
		t.Fatalf("assistant = %+v", assistant)
	}
	call := store.calls[len(store.calls)-1]
	if !call.In.Assistant || call.In.Tool != "" || strings.Contains(string(call.In.Arguments), utterance) {
		t.Fatalf("assistant was forwarded as a tool call: %+v", call.In)
	}

	rec = doJSON(t, srv, http.MethodPost, toolExecutePath, `{"chatIdentity":"`+toolUnitChat+`","idempotencyKey":"forbidden-key-01","tool":"query_scheduled_follow_ups","relationshipId":"10","ownerUserId":2,"ownerId":2,"ownerAccountId":"2"}`, 1)
	forbidden := decodeTool(t, rec)
	if forbidden.Status != "FAILED" || forbidden.FailureCode == nil || *forbidden.FailureCode != "FORBIDDEN_RELATIONSHIP" {
		t.Fatalf("forbidden = %+v", forbidden)
	}
	call = store.calls[len(store.calls)-1]
	if call.Owner != 1 || !call.In.Forbidden {
		t.Fatalf("forbidden call = %+v", call)
	}
}

type toolHTTPCall struct {
	Owner int64
	In    postgres.ToolRequest
}

type toolHTTPStore struct {
	*memStore
	calls []toolHTTPCall
	byKey map[string]postgres.ToolExecution
	next  int64
}

func newToolHTTPStore() *toolHTTPStore {
	return &toolHTTPStore{memStore: newMemStore(), byKey: map[string]postgres.ToolExecution{}}
}

func (s *toolHTTPStore) ExecuteTool(_ context.Context, owner int64, in postgres.ToolRequest) (postgres.ToolExecution, error) {
	s.calls = append(s.calls, toolHTTPCall{Owner: owner, In: in})
	if prev, ok := s.byKey[in.IdempotencyKey]; ok {
		return prev, nil
	}
	s.next++
	out := postgres.ToolExecution{ID: s.next, Tool: in.Tool, Status: "SUCCEEDED", Result: json.RawMessage(`{}`)}
	if in.Assistant && in.Tool != "manage_reminder" && in.Tool != "query_scheduled_follow_ups" {
		code := "ASSISTANT_TEXT"
		out.Tool = "assistant_text"
		out.Status = "FAILED"
		out.FailureCode = &code
	}
	if in.Forbidden {
		code := "FORBIDDEN_RELATIONSHIP"
		out.Tool = "rejected"
		out.Status = "FAILED"
		out.FailureCode = &code
	}
	s.byKey[in.IdempotencyKey] = out
	return out, nil
}

func decodeTool(t *testing.T, rec *httptest.ResponseRecorder) toolExecuteJSON {
	t.Helper()
	var out toolExecuteJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
