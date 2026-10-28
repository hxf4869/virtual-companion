package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestNotificationRoutesStayUnregisteredWithoutCore(t *testing.T) {
	t.Parallel()
	s := newServer(t, staticProbes{live: true, ready: true})
	for _, path := range []string{"/api/v1/inbox", "/api/v1/notification-channels", "/api/v1/notification-deliveries"} {
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %d", path, rec.Code)
		}
	}
}

func TestNotificationChannelPutUsesTheChannelCredential(t *testing.T) {
	store := newNotificationFakeStore()
	srv := newCoreServer(t, "full", store)
	raw := httptest.NewRequest(http.MethodGet, "/api/v1/notification-channels", nil)
	anon := httptest.NewRecorder()
	srv.Handler().ServeHTTP(anon, raw)
	if anon.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous %d", anon.Code)
	}
	plain := newCoreServer(t, "full", newMemStore())
	missing := doJSON(t, plain, http.MethodGet, "/api/v1/notification-channels", "", 1)
	if missing.Code != http.StatusServiceUnavailable {
		t.Fatalf("mem store %d", missing.Code)
	}

	urlBody := `{"channel":"EMAIL","enabled":true,"configuredTarget":"https://mail.example/hook","previewBody":false,"relationshipIds":["10"],"credential":"mailer\nsecret"}`
	rec := notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", urlBody, 1, notificationCall{reauth: true})
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "invalid request") || store.puts != 0 {
		t.Fatalf("url target %d puts=%d %s", rec.Code, store.puts, rec.Body.String())
	}
	empty := `{"channel":"EMAIL","enabled":true,"configuredTarget":"owner@example.test","previewBody":false,"relationshipIds":["10"],"credential":""}`
	rec = notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", empty, 1, notificationCall{reauth: true})
	if rec.Code != http.StatusBadRequest || store.puts != 0 {
		t.Fatalf("empty credential %d puts=%d", rec.Code, store.puts)
	}
	stale := `{"channel":"EMAIL","enabled":true,"configuredTarget":"owner@example.test","previewBody":false,"relationshipIds":["10"],"credential":"mailer\nsecret"}`
	rec = notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", stale, 1, notificationCall{})
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "recent reauthentication required") || store.puts != 0 {
		t.Fatalf("reauth %d %s", rec.Code, rec.Body.String())
	}

	body := `{"channel":"EMAIL","enabled":true,"configuredTarget":"owner@example.test","previewBody":false,"relationshipIds":["10"],"credential":"mailer\nsecret"}`
	rec = notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", body, 1, notificationCall{reauth: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("put %d %s", rec.Code, rec.Body.String())
	}
	var saved map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if _, ok := saved["credential"]; ok || saved["channelId"] != "1" || saved["configuredTarget"] != "owner@example.test" {
		t.Fatalf("echo %+v", saved)
	}
	rels, ok := saved["relationshipIds"].([]any)
	if !ok || len(rels) != 1 || rels[0] != "10" {
		t.Fatalf("relationship ids %+v", saved["relationshipIds"])
	}
	if store.last.CredentialMode != "set" || store.last.CredentialPlain != "mailer\nsecret" {
		t.Fatalf("stored %+v", store.last)
	}
	if strings.Contains(rec.Body.String(), "secret") {
		t.Fatal("response included the credential")
	}

	keep := `{"channel":"EMAIL","enabled":false,"configuredTarget":"owner@example.test","previewBody":true,"relationshipIds":["10"]}`
	rec = notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", keep, 1, notificationCall{reauth: true})
	if rec.Code != http.StatusOK || store.last.CredentialMode != "keep" || store.last.CredentialPlain != "" {
		t.Fatalf("keep %d mode=%s", rec.Code, store.last.CredentialMode)
	}
	clear := `{"channel":"EMAIL","enabled":true,"configuredTarget":"owner@example.test","previewBody":false,"relationshipIds":["10"],"credential":null}`
	rec = notificationRequest(t, srv, store, http.MethodPut, "/api/v1/notification-channels", clear, 1, notificationCall{reauth: true})
	if rec.Code != http.StatusOK || store.last.CredentialMode != "clear" {
		t.Fatalf("clear %d mode=%s %s", rec.Code, store.last.CredentialMode, rec.Body.String())
	}

	listed := notificationRequest(t, srv, store, http.MethodGet, "/api/v1/notification-deliveries", "", 1, notificationCall{})
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), `"deliveryId":"7"`) || strings.Contains(listed.Body.String(), "secret") {
		t.Fatalf("deliveries %d %s", listed.Code, listed.Body.String())
	}
}

type notificationCall struct {
	reauth bool
}

func notificationRequest(t *testing.T, srv *Server, store *notificationFakeStore, method, path, body string, account int64, call notificationCall) *httptest.ResponseRecorder {
	t.Helper()
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	sid, err := store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if call.reauth {
		if err := store.RecordOpaqueReauth(context.Background(), account, sid); err != nil {
			t.Fatal(err)
		}
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: raw})
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set(expectedAccountHeader, strconv.FormatInt(account, 10))
	req.Header.Set(expectedSessionHeader, strconv.FormatInt(sid, 10))
	if isStateChanging(method) {
		req.Header.Set("Origin", "https://vc.test")
		req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
		req.Header.Set(csrfHeader, "csrf-token")
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

type notificationFakeStore struct {
	*memStore
	puts  int
	last  postgres.NotificationChannelInput
	saved postgres.NotificationChannel
}

func newNotificationFakeStore() *notificationFakeStore {
	return &notificationFakeStore{memStore: newMemStore()}
}

func (s *notificationFakeStore) ListNotificationChannels(context.Context, int64) ([]postgres.NotificationChannel, error) {
	if s.saved.ID == 0 {
		return []postgres.NotificationChannel{}, nil
	}
	return []postgres.NotificationChannel{s.saved}, nil
}

func (s *notificationFakeStore) PutNotificationChannel(_ context.Context, _ int64, in postgres.NotificationChannelInput) (postgres.NotificationChannel, error) {
	s.puts++
	s.last = in
	s.saved = postgres.NotificationChannel{
		ID: 1, Channel: in.Channel, Enabled: in.Enabled, ConfiguredTarget: in.ConfiguredTarget,
		PreviewBody: in.PreviewBody, RelationshipIDs: append([]int64(nil), in.RelationshipIDs...),
	}
	return s.saved, nil
}

func (s *notificationFakeStore) ListNotificationDeliveries(context.Context, int64) ([]postgres.NotificationDeliveryList, error) {
	return []postgres.NotificationDeliveryList{{
		ID: 7, EventID: "w10-body", Channel: "EMAIL", ConfiguredTarget: "owner@example.test",
		Status: "pending", AttemptCount: 0,
	}}, nil
}
