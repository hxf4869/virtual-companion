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

type callHTTPStore struct {
	*inboxHTTPStore
	owner           int64
	action, request string
}

func (s *callHTTPStore) RespondInboxCall(_ context.Context, owner int64, event, action, request string) (postgres.InboxEvent, bool, error) {
	s.owner, s.action, s.request = owner, action, request
	if owner != 1 || event != "fu-call" {
		return postgres.InboxEvent{}, false, postgres.ErrNotFound
	}
	return postgres.InboxEvent{EventID: event, Call: &postgres.InboxCall{State: "ANSWERED", ExpiresAt: time.Now()}}, true, nil
}

func TestInboxCallHTTPBoundary(t *testing.T) {
	store := &callHTTPStore{inboxHTTPStore: newInboxHTTPStore()}
	srv := newCoreServer(t, "full", store)
	request := `{"action":"ANSWER","requestId":"01234567-89ab-4def-8abc-0123456789ab"}`
	rec := doJSON(t, srv, http.MethodPost, "/api/v1/inbox/fu-call/call", request, 1)
	if rec.Code != 200 || store.owner != 1 || store.action != "ANSWER" || store.request == "" {
		t.Fatalf("response: %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Event   inboxEventJSON `json:"event"`
		Applied bool           `json:"applied"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || !body.Applied || body.Event.Call == nil || body.Event.Call.State != "ANSWERED" {
		t.Fatal("call reply shape", err)
	}
	for _, bad := range []string{`{"action":"AUTO","requestId":"01234567-89ab-4def-8abc-0123456789ab"}`, `{"action":"ANSWER","requestId":"bad"}`} {
		rec = doJSON(t, srv, http.MethodPost, "/api/v1/inbox/fu-call/call", bad, 1)
		if rec.Code != 400 {
			t.Fatal("invalid action accepted", rec.Code)
		}
	}
	rec = doJSON(t, srv, http.MethodPost, "/api/v1/inbox/fu-call/call", request, 2)
	if rec.Code != 404 {
		t.Fatal("missing event", rec.Code)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox/fu-call/call", strings.NewReader(request))
	attachAuth(t, srv, req, 1, true)
	req.Header.Del(csrfHeader)
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatal("CSRF", rec.Code)
	}
}
