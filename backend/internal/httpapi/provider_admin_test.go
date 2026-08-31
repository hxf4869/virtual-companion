package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type providerMemStore struct {
	*memStore
	configs    []postgres.ProviderConfig
	saved      []postgres.SaveProvider
	orders     [][]postgres.RouteRef
	credential string
}

func (m *providerMemStore) ListProviderConfigs(context.Context, int64) ([]postgres.ProviderConfig, error) {
	return append([]postgres.ProviderConfig(nil), m.configs...), nil
}

func (m *providerMemStore) GetProviderCredential(context.Context, int64, string) (string, error) {
	if m.credential == "" {
		return "", postgres.ErrNotFound
	}
	return m.credential, nil
}

func (m *providerMemStore) SaveProviderConfig(_ context.Context, _ int64, in postgres.SaveProvider) error {
	m.saved = append(m.saved, in)
	return nil
}

func (m *providerMemStore) ReorderProviderModels(_ context.Context, _ int64, in []postgres.RouteRef) error {
	m.orders = append(m.orders, append([]postgres.RouteRef(nil), in...))
	return nil
}

func (m *providerMemStore) ResolveProviderRoutes(context.Context) ([]postgres.ProviderRoute, error) {
	for _, provider := range m.configs {
		if provider.State != postgres.ProviderEnabled || !provider.CredentialConfigured {
			continue
		}
		for _, model := range provider.Models {
			if model.State == postgres.ProviderEnabled {
				return []postgres.ProviderRoute{{
					ProviderID: provider.ProviderID,
					Protocol:   provider.Protocol,
					BaseURL:    provider.BaseURL,
					ModelID:    model.ModelID,
				}}, nil
			}
		}
	}
	return []postgres.ProviderRoute{}, nil
}

func newProviderServer(t *testing.T) (*Server, *providerMemStore) {
	t.Helper()
	base := newMemStore()
	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatal(err)
	}
	base.identities["admin"] = postgres.Identity{
		AccountID: 9, Username: "admin", Role: "ADMIN", Status: "ACTIVE", PasswordHash: hash,
	}
	store := &providerMemStore{memStore: base, credential: "catalog-secret", configs: []postgres.ProviderConfig{{
		ProviderID: "acme", DisplayName: "Acme", Protocol: postgres.ProtocolOpenAIResponses,
		BaseURL: "https://gateway.example/v1", CredentialConfigured: true,
		State: postgres.ProviderEnabled, UpdatedAt: time.Unix(10, 0),
		Models: []postgres.ProviderModel{{
			ModelID: "m1", DisplayName: "Primary", MaxOutputTokens: 4096,
			Priority: 1, State: postgres.ProviderEnabled,
		}},
	}}}
	return newCoreServer(t, "full", store), store
}

func providerRequest(t *testing.T, server *Server, store *providerMemStore, method, path, body string, account int64, fresh bool) *httptest.ResponseRecorder {
	t.Helper()
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	sid, err := store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if fresh {
		if err := store.RecordOpaqueReauth(context.Background(), account, sid); err != nil {
			t.Fatal(err)
		}
	}
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: raw})
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if isStateChanging(method) {
		req.Header.Set("Origin", "https://vc.test")
		req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
		req.Header.Set(csrfHeader, "csrf-token")
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestProviderAdminListIsSecretFreeAndAdminOnly(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	admin := providerRequest(t, server, store, http.MethodGet, "/api/v1/admin/providers", "", 9, false)
	if admin.Code != http.StatusOK {
		t.Fatalf("admin list %d %s", admin.Code, admin.Body.String())
	}
	var payload []map[string]any
	if err := json.Unmarshal(admin.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload) != 1 || payload[0]["credentialConfigured"] != true {
		t.Fatalf("payload %#v", payload)
	}
	if _, exists := payload[0]["credential"]; exists || strings.Contains(admin.Body.String(), "cipher") {
		t.Fatalf("credential leaked %s", admin.Body.String())
	}
	user := providerRequest(t, server, store, http.MethodGet, "/api/v1/admin/providers", "", 1, false)
	if user.Code != http.StatusForbidden {
		t.Fatalf("user list %d", user.Code)
	}
}

func TestServiceModeReflectsConfiguredRoutesAndRequiresSession(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)

	full := providerRequest(t, server, store, http.MethodGet, "/api/v1/service-mode", "", 9, false)
	if full.Code != http.StatusOK || !strings.Contains(full.Body.String(), `"mode":"FULL_AI"`) {
		t.Fatalf("full mode %d %s", full.Code, full.Body.String())
	}

	server, store = newProviderServer(t)
	store.configs = nil
	zero := providerRequest(t, server, store, http.MethodGet, "/api/v1/service-mode", "", 9, false)
	if zero.Code != http.StatusOK || !strings.Contains(zero.Body.String(), `"mode":"ZERO_LLM"`) {
		t.Fatalf("zero mode %d %s", zero.Code, zero.Body.String())
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/service-mode", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous mode %d %s", rec.Code, rec.Body.String())
	}
}

func TestProviderAdminWriteRequiresFreshReauth(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	body := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","credential":"secret","state":"ENABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	stale := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", body, 9, false)
	if stale.Code != http.StatusForbidden || len(store.saved) != 0 {
		t.Fatalf("stale %d saved=%d", stale.Code, len(store.saved))
	}
	fresh := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", body, 9, true)
	if fresh.Code != http.StatusOK || len(store.saved) != 1 {
		t.Fatalf("fresh %d %s saved=%d", fresh.Code, fresh.Body.String(), len(store.saved))
	}
	if store.saved[0].Credential != "secret" || store.saved[0].Models[0].ModelID != "m1" {
		t.Fatalf("saved %+v", store.saved[0])
	}
}

func TestProviderAdminRejectsUnsafeBaseURLBeforeStore(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	body := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"http://169.254.169.254/v1","credential":"secret","state":"DISABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	rec := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", body, 9, true)
	if rec.Code != http.StatusBadRequest || len(store.saved) != 0 {
		t.Fatalf("unsafe %d saved=%d body=%s", rec.Code, len(store.saved), rec.Body.String())
	}
}

func TestProviderAdminRejectsInvalidProviderIDBeforeStoreOrDiscovery(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	saveBody := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","credential":"secret","state":"DISABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	save := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/Bad_ID", saveBody, 9, true)
	if save.Code != http.StatusBadRequest || len(store.saved) != 0 {
		t.Fatalf("invalid save %d saved=%d body=%s", save.Code, len(store.saved), save.Body.String())
	}
	discoverBody := `{"protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","credential":"secret"}`
	discover := providerRequest(t, server, store, http.MethodPost, "/api/v1/admin/providers/Bad_ID/models/discover", discoverBody, 9, true)
	if discover.Code != http.StatusBadRequest {
		t.Fatalf("invalid discovery %d body=%s", discover.Code, discover.Body.String())
	}
}

func TestProviderAdminReordersCompleteRouteList(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	body := `{"routes":[{"providerId":"p2","modelId":"m2"},{"providerId":"p1","modelId":"m1"}]}`
	rec := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/model-routing-order", body, 9, true)
	if rec.Code != http.StatusOK || len(store.orders) != 1 || store.orders[0][0].ProviderID != "p2" {
		t.Fatalf("reorder %d orders=%+v", rec.Code, store.orders)
	}
}

func TestProviderAdminDiscoversModelsWithSavedCredential(t *testing.T) {
	t.Parallel()
	var authHeader string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != "/v1/models" {
			t.Fatalf("catalog path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-b","display_name":"Model B"}]}`))
	}))
	defer upstream.Close()

	server, store := newProviderServer(t)
	server.cfg.Provider.AllowLoopbackHTTP = true
	body := `{"protocol":"OPENAI_RESPONSES","baseUrl":"` + upstream.URL + `/v1"}`
	rec := providerRequest(t, server, store, http.MethodPost, "/api/v1/admin/providers/acme/models/discover", body, 9, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("discover %d %s", rec.Code, rec.Body.String())
	}
	if authHeader != "Bearer catalog-secret" {
		t.Fatalf("authorization header %q", authHeader)
	}
	var models []discoveredModelJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &models); err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].DisplayName != "model-a" || models[1].DisplayName != "Model B" {
		t.Fatalf("models %+v", models)
	}
}
