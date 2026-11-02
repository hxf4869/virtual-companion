package httpapi

import (
	"context"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"net/http"
	"testing"
	"time"
)

type callHTTPStore struct {
	*inboxHTTPStore
	owner           int64
	action, request string
}

func (s *callHTTPStore) RespondInboxCall(_ context.Context, owner int64, event, action, request string) (postgres.InboxEvent, bool, error) {
	s.owner, s.action, s.request = owner, action, request
	if event != "fu-call" {
		return postgres.InboxEvent{}, false, postgres.ErrNotFound
	}
	return postgres.InboxEvent{EventID: event, Call: &postgres.InboxCall{State: "ANSWERED", ExpiresAt: time.Now()}}, true, nil
}
func TestInboxCallHTTPBoundary(t *testing.T) {
	store := &callHTTPStore{inboxHTTPStore: newInboxHTTPStore()}
	srv := newCoreServer(t, "full", store)
	request := `{"action":"ANSWER","requestId":"01234567-89ab-4def-8abc-0123456789ab"}`
	rec := inboxRequest(t, srv, store.inboxHTTPStore, http.MethodPost, "/api/v1/inbox/fu-call/call", request, 1, "fu-call", inboxCall{})
	if rec.Code != 200 || store.owner != 1 || store.action != "ANSWER" || store.request == "" {
		t.Fatalf("response: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Event   inboxEventJSON `json:"event"`
		Applied bool           `json:"applied"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || !body.Applied || body.Event.Call.State != "ANSWERED" {
		t.Fatal("call reply shape", err)
	}
	for _, bad := range []string{`{"action":"AUTO","requestId":"01234567-89ab-4def-8abc-0123456789ab"}`, `{"action":"ANSWER","requestId":"bad"}`} {
		rec = inboxRequest(t, srv, store.inboxHTTPStore, http.MethodPost, "/api/v1/inbox/fu-call/call", bad, 1, "fu-call", inboxCall{})
		if rec.Code != 400 {
			t.Fatal("invalid action accepted", rec.Code)
		}
	}
	rec = inboxRequest(t, srv, store.inboxHTTPStore, http.MethodPost, "/api/v1/inbox/foreign/call", request, 1, "foreign", inboxCall{})
	if rec.Code != 404 {
		t.Fatal("missing event", rec.Code)
	}
	rec = inboxRequest(t, srv, store.inboxHTTPStore, http.MethodPost, "/api/v1/inbox/fu-call/call", request, 1, "fu-call", inboxCall{skipCSRF: true})
	if rec.Code != 403 {
		t.Fatal("CSRF", rec.Code)
	}
}
