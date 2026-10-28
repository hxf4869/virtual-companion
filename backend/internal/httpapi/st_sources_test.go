package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) ReconcileSTSources(_ context.Context, owner int64, chats []string) ([]postgres.STSourceState, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]postgres.STSourceState, 0, len(chats))
	for _, id := range chats {
		if _, ok := m.stBindings[strconv.FormatInt(owner, 10)+":"+id]; !ok {
			return nil, postgres.ErrNotFound
		}
		result = append(result, postgres.STSourceState{ChatIdentity: id, State: "UNAVAILABLE"})
	}
	return result, nil
}
func TestSTSourceReconcileHTTPUsesCookieOwnerAndRejectsInvalidSet(t *testing.T) {
	t.Parallel()
	m := newMemStore()
	s := newCoreServer(t, "full", m)
	const id = "10000000-0000-0000-0000-000000000001"
	if _, err := m.ResolveSTBinding(context.Background(), 1, postgres.STBindingInput{ChatIdentity: id, CharacterRef: "card", Mode: "COMPANION", DisplayName: "测试"}); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/st/sources/reconcile"
	body := `{"chatIdentities":["` + id + `"],"ownerAccountId":"2"}`
	if got := doJSON(t, s, http.MethodPost, path, body, 1); got.Code != 200 {
		t.Fatalf("own source status %d", got.Code)
	}
	if got := doJSON(t, s, http.MethodPost, path, body, 2); got.Code != 404 {
		t.Fatalf("foreign source status %d", got.Code)
	}
	for _, body := range []string{`{"chatIdentities":[]}`, `{"chatIdentities":["bad"]}`, `{"chatIdentities":["` + id + `","` + id + `"]}`} {
		if got := doJSON(t, s, http.MethodPost, path, body, 1); got.Code != 400 {
			t.Fatalf("invalid source set status %d", got.Code)
		}
	}
}

func TestSTProfileRegistrationRequiresPrivateServiceAuthentication(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	s.cfg.STPlugin.ServiceToken = "synthetic-service-token-0123456789"
	s.cfg.STPlugin.HostBaseURL = "http://st.example"
	body := `{"ownerAccountId":"9007199254740993","handle":"profile-one"}`
	call := func(token, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/service/st/profile", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", token)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		out := httptest.NewRecorder()
		s.Handler().ServeHTTP(out, req)
		return out
	}
	if out := call("Bearer wrong", ""); out.Code != 401 {
		t.Fatalf("bad service token=%d", out.Code)
	}
	if out := call("Bearer "+s.cfg.STPlugin.ServiceToken, "http://st.example"); out.Code != 403 {
		t.Fatalf("browser service claim=%d", out.Code)
	}
	out := call("Bearer "+s.cfg.STPlugin.ServiceToken, "")
	if out.Code != 200 || !strings.Contains(out.Body.String(), `"ownerAccountId":"9007199254740993"`) {
		t.Fatal("service profile must preserve the exact decimal account string")
	}
}
