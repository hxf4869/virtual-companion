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

type providerMemStore struct {
	*memStore
	configs    []postgres.ProviderConfig
	saved      []postgres.SaveProvider
	orders     [][]postgres.RouteRef
	credential string
	saveErr    error
	bindings   []postgres.PurposeBinding
	bindSaved  []postgres.SavePurposeBinding
	bindErr    error
	resolved   postgres.ResolvedPurpose
	resolveErr error
	resolveIn  []postgres.ResolvePurpose
	verified   []string
	markErr    error
}

func (m *providerMemStore) ListProviderConfigs(context.Context, int64) ([]postgres.ProviderConfig, error) {
	return append([]postgres.ProviderConfig(nil), m.configs...), nil
}

func (m *providerMemStore) MarkModelToolCallsVerified(_ context.Context, _ int64, providerID, profileKey string) (postgres.ToolCallVerification, error) {
	if m.markErr != nil {
		return postgres.ToolCallVerification{}, m.markErr
	}
	for i := range m.configs {
		if m.configs[i].ProviderID != providerID {
			continue
		}
		for j := range m.configs[i].Models {
			key := m.configs[i].Models[j].ProfileKey
			if key == "" {
				key = m.configs[i].Models[j].ModelID
			}
			if key != profileKey {
				continue
			}
			if m.configs[i].Models[j].Capabilities == nil {
				m.configs[i].Models[j].Capabilities = postgres.ModelCapabilities{}
			}
			m.configs[i].Models[j].Capabilities["toolCalls"] = postgres.CapabilityVerified
			m.verified = append(m.verified, profileKey)
			return postgres.ToolCallVerification{
				VerifiedAt: time.Unix(1_700_000_000, 0).UTC(),
				Protocol:   m.configs[i].Protocol,
			}, nil
		}
	}
	return postgres.ToolCallVerification{}, postgres.ErrNotFound
}

func (m *providerMemStore) GetProviderCredential(context.Context, int64, string) (string, error) {
	if m.credential == "" {
		return "", postgres.ErrNotFound
	}
	return m.credential, nil
}

func (m *providerMemStore) SaveProviderConfig(_ context.Context, _ int64, in postgres.SaveProvider) (int64, error) {
	if m.saveErr != nil {
		return 0, m.saveErr
	}
	m.saved = append(m.saved, in)
	return int64(len(m.saved)) + 1, nil
}

func (m *providerMemStore) ReorderProviderModels(_ context.Context, _ int64, in []postgres.RouteRef) error {
	m.orders = append(m.orders, append([]postgres.RouteRef(nil), in...))
	return nil
}

func (m *providerMemStore) ListPurposeBindings(context.Context, int64) ([]postgres.PurposeBinding, error) {
	return append([]postgres.PurposeBinding(nil), m.bindings...), nil
}

func (m *providerMemStore) SavePurposeBinding(_ context.Context, _ int64, in postgres.SavePurposeBinding) (postgres.PurposeBinding, error) {
	if m.bindErr != nil {
		return postgres.PurposeBinding{}, m.bindErr
	}
	m.bindSaved = append(m.bindSaved, in)
	return postgres.PurposeBinding{
		Purpose: in.Purpose, ProviderID: in.ProviderID, ProfileKey: in.ProfileKey,
		State: in.State, Status: postgres.BindingReady, Revision: 2, UpdatedAt: time.Unix(20, 0),
	}, nil
}

func (m *providerMemStore) ResolvePurpose(_ context.Context, in postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	m.resolveIn = append(m.resolveIn, in)
	if m.resolveErr != nil {
		return postgres.ResolvedPurpose{}, m.resolveErr
	}
	return m.resolved, nil
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
	// The fixture page states the account it acts for, together with the
	// session id its own fixture session established (VC-R169).
	req.Header.Set(expectedAccountHeader, strconv.FormatInt(account, 10))
	req.Header.Set(expectedSessionHeader, strconv.FormatInt(sid, 10))
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

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %s: %v", rec.Body.String(), err)
	}
	return out
}

func TestProviderAdminSaveCredentialTriStateAndProfileFields(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	model := `{"profileKey":"m1@memory","modelId":"m1","displayName":"Memory","contextWindowTokens":32768,"maxOutputTokens":1024,"state":"ENABLED","capabilities":{"toolCalls":"DECLARED"},"reasoningLevels":["low"],"generationParams":{"temperature":0.2,"reasoningEffort":"low"},"pricing":{"currency":"USD","inputPerMillionTokens":1.5}}`
	set := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","credential":"secret","state":"ENABLED","expectedRevision":3,"models":[` + model + `]}`
	rec := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", set, 9, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("set %d %s", rec.Code, rec.Body.String())
	}
	if body := decodeBody(t, rec); body["ok"] != true || body["revision"] != float64(2) {
		t.Fatalf("mutation response %s", rec.Body.String())
	}
	saved := store.saved[0]
	if saved.Credential != "secret" || saved.ClearCredential || saved.ExpectedRevision == nil || *saved.ExpectedRevision != 3 {
		t.Fatalf("set passthrough %+v", saved)
	}
	m := saved.Models[0]
	if m.ProfileKey != "m1@memory" || m.Capabilities["toolCalls"] != postgres.CapabilityDeclared ||
		len(m.ReasoningLevels) != 1 || m.GenerationParams == nil || *m.GenerationParams.ReasoningEffort != "low" ||
		m.Pricing == nil || *m.Pricing.Currency != "USD" {
		t.Fatalf("profile passthrough %+v", m)
	}

	clear := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","clearCredential":true,"state":"DISABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	rec = providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", clear, 9, true)
	if rec.Code != http.StatusOK {
		t.Fatalf("clear %d %s", rec.Code, rec.Body.String())
	}
	saved = store.saved[1]
	if saved.Credential != "" || !saved.ClearCredential || saved.ExpectedRevision != nil {
		t.Fatalf("clear passthrough %+v", saved)
	}
	// An older caller sends no profile documents: they must arrive as nil
	// (keep), never as empty replacements.
	legacy := saved.Models[0]
	if legacy.ProfileKey != "" || legacy.Capabilities != nil || legacy.ReasoningLevels != nil ||
		legacy.GenerationParams != nil || legacy.Pricing != nil {
		t.Fatalf("legacy model must keep stored documents %+v", legacy)
	}

	keep := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","state":"DISABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	rec = providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", keep, 9, true)
	if rec.Code != http.StatusOK || store.saved[2].Credential != "" || store.saved[2].ClearCredential {
		t.Fatalf("keep %d %+v", rec.Code, store.saved[2])
	}
}

func TestProviderAdminSaveMapsCatalogConflicts(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	body := `{"displayName":"Acme","protocol":"OPENAI_RESPONSES","baseUrl":"https://gateway.example/v1","state":"DISABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`

	store.saveErr = &postgres.RevisionConflictError{Current: 7}
	rec := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", body, 9, true)
	payload := decodeBody(t, rec)
	if rec.Code != http.StatusConflict || payload["code"] != "REVISION_CONFLICT" ||
		payload["details"].(map[string]any)["currentRevision"] != float64(7) {
		t.Fatalf("revision conflict %d %s", rec.Code, rec.Body.String())
	}

	store.saveErr = &postgres.ProfileInUseError{Purposes: []string{"FOREGROUND_CHAT"}}
	rec = providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/acme", body, 9, true)
	payload = decodeBody(t, rec)
	if rec.Code != http.StatusConflict || payload["code"] != "MODEL_PROFILE_IN_USE" ||
		!strings.Contains(rec.Body.String(), `"purposes":["FOREGROUND_CHAT"]`) {
		t.Fatalf("profile in use %d %s", rec.Code, rec.Body.String())
	}
}

func TestProviderAdminSaveMakesNoOutboundCall(t *testing.T) {
	t.Parallel()
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	server, store := newProviderServer(t)
	server.cfg.Provider.AllowLoopbackHTTP = true
	body := `{"displayName":"Local","protocol":"OPENAI_CHAT_COMPLETIONS","baseUrl":"` + upstream.URL + `/v1","credential":"secret","state":"ENABLED","models":[{"modelId":"m1","displayName":"Primary","maxOutputTokens":4096,"state":"ENABLED"}]}`
	rec := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/providers/local", body, 9, true)
	if rec.Code != http.StatusOK || len(store.saved) != 1 || calls != 0 {
		t.Fatalf("save %d saved=%d upstream calls=%d", rec.Code, len(store.saved), calls)
	}
}

func TestProviderAdminListExposesProfileFieldsWithoutSecrets(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	effort := "low"
	store.configs[0].Revision = 4
	store.configs[0].Models[0].ProfileKey = "m1"
	store.configs[0].Models[0].Capabilities = postgres.ModelCapabilities{"toolCalls": postgres.CapabilityDeclared}
	store.configs[0].Models[0].ReasoningLevels = []string{"low"}
	store.configs[0].Models[0].GenerationParams = &postgres.GenerationParams{ReasoningEffort: &effort}
	store.configs[0].Models[0].Pricing = &postgres.ModelPricing{}
	store.configs[0].Models[0].BoundPurposes = []string{"FOREGROUND_CHAT"}
	store.configs[0].Models[0].LedgerPrice = postgres.LedgerPriceActive
	rec := providerRequest(t, server, store, http.MethodGet, "/api/v1/admin/providers", "", 9, false)
	if rec.Code != http.StatusOK {
		t.Fatalf("list %d %s", rec.Code, rec.Body.String())
	}
	var payload []providerJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	item := payload[0]
	if item.Revision != 4 || item.EndpointURL != "https://gateway.example/v1/responses" ||
		item.Models[0].ProfileKey != "m1" || item.Models[0].Capabilities["toolCalls"] != "DECLARED" ||
		item.Models[0].BoundPurposes[0] != "FOREGROUND_CHAT" || item.Models[0].Pricing.Currency != nil ||
		item.Models[0].LedgerPrice != postgres.LedgerPriceActive {
		t.Fatalf("list payload %s", rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "credential\"") || strings.Contains(rec.Body.String(), "cipher") {
		t.Fatalf("secret material leaked %s", rec.Body.String())
	}
}

func TestPurposeBindingAdminSurface(t *testing.T) {
	t.Parallel()
	server, store := newProviderServer(t)
	store.bindings = []postgres.PurposeBinding{{
		Purpose: postgres.PurposeForegroundChat, State: postgres.ProviderDisabled,
		Status: postgres.BindingPending, Revision: 1, UpdatedAt: time.Unix(10, 0),
	}}
	list := providerRequest(t, server, store, http.MethodGet, "/api/v1/admin/model-purposes", "", 9, false)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), `"providerId":null`) ||
		!strings.Contains(list.Body.String(), `"status":"PENDING_CONFIGURATION"`) {
		t.Fatalf("list %d %s", list.Code, list.Body.String())
	}
	if user := providerRequest(t, server, store, http.MethodGet, "/api/v1/admin/model-purposes", "", 1, false); user.Code != http.StatusForbidden {
		t.Fatalf("user list %d", user.Code)
	}

	body := `{"providerId":"acme","profileKey":"m1","state":"ENABLED","expectedRevision":1}`
	stale := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/model-purposes/FOREGROUND_CHAT", body, 9, false)
	if stale.Code != http.StatusForbidden || len(store.bindSaved) != 0 {
		t.Fatalf("stale reauth %d saved=%d", stale.Code, len(store.bindSaved))
	}
	fresh := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/model-purposes/FOREGROUND_CHAT", body, 9, true)
	if fresh.Code != http.StatusOK || len(store.bindSaved) != 1 || store.bindSaved[0].Purpose != "FOREGROUND_CHAT" ||
		store.bindSaved[0].ProfileKey != "m1" || *store.bindSaved[0].ExpectedRevision != 1 ||
		!strings.Contains(fresh.Body.String(), `"status":"READY"`) || !strings.Contains(fresh.Body.String(), `"revision":2`) {
		t.Fatalf("fresh %d %s saved=%+v", fresh.Code, fresh.Body.String(), store.bindSaved)
	}

	store.bindErr = &postgres.RevisionConflictError{Current: 5}
	conflict := providerRequest(t, server, store, http.MethodPut, "/api/v1/admin/model-purposes/FOREGROUND_CHAT", body, 9, true)
	if conflict.Code != http.StatusConflict || decodeBody(t, conflict)["code"] != "REVISION_CONFLICT" {
		t.Fatalf("conflict %d %s", conflict.Code, conflict.Body.String())
	}
}

func serviceRequest(t *testing.T, server *Server, token, origin, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestServiceResolveChannel(t *testing.T) {
	t.Parallel()
	const token = "st-plugin-service-token-0123456789abcdef"
	server, store := newProviderServer(t)
	body := `{"ownerAccountId":"1","providerId":"acme","profileKey":"m1","providerRevision":4,"bindingRevision":2}`

	if rec := serviceRequest(t, server, token, "", body); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured channel %d %s", rec.Code, rec.Body.String())
	}
	server.cfg.STPlugin.ServiceToken = token
	if rec := serviceRequest(t, server, "", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing token %d", rec.Code)
	}
	if rec := serviceRequest(t, server, "wrong-token-wrong-token-wrong-token-wrong", "", body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token %d", rec.Code)
	}
	if rec := serviceRequest(t, server, token, "https://vc.test", body); rec.Code != http.StatusForbidden || len(store.resolveIn) != 0 {
		t.Fatalf("browser origin %d resolves=%d", rec.Code, len(store.resolveIn))
	}

	window := 32768
	store.resolved = postgres.ResolvedPurpose{
		Purpose: postgres.PurposeForegroundChat, BindingRevision: 2,
		ProviderID: "acme", ProviderName: "Acme", Protocol: postgres.ProtocolOpenAIResponses,
		BaseURL: "https://gateway.example/v1", ProviderRevision: 4, Credential: "plain-secret",
		Model: postgres.ProviderModel{
			ProfileKey: "m1", ModelID: "m1", DisplayName: "Primary", ContextWindowTokens: &window,
			MaxOutputTokens: 4096, State: postgres.ProviderEnabled,
			Capabilities:    postgres.ModelCapabilities{"toolCalls": postgres.CapabilityDeclared},
			ReasoningLevels: []string{}, GenerationParams: &postgres.GenerationParams{},
			Pricing: &postgres.ModelPricing{}, BoundPurposes: []string{},
		},
	}
	rec := serviceRequest(t, server, token, "", body)
	if rec.Code != http.StatusOK {
		t.Fatalf("resolve %d %s", rec.Code, rec.Body.String())
	}
	var resolved purposeResolveResponseJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &resolved); err != nil {
		t.Fatal(err)
	}
	if resolved.Provider.Credential != "plain-secret" || resolved.Provider.EndpointURL != "https://gateway.example/v1/responses" ||
		resolved.BindingRevision != 2 || resolved.Model.ContextWindowTokens == nil || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("resolved payload %s", rec.Body.String())
	}
	in := store.resolveIn[0]
	if in.OwnerAccountID != 1 || in.Purpose != "FOREGROUND_CHAT" || in.ProviderID != "acme" ||
		*in.ProviderRevision != 4 || *in.BindingRevision != 2 {
		t.Fatalf("resolve input %+v", in)
	}

	// The owner ID travels as a decimal string so the plugin can forward the
	// session accountId verbatim: an ID above the JS safe-integer range must
	// reach the store as the exact int64, never float-mangled to a neighbour.
	const beyondJSSafe = int64(9007199254740993) // 2^53+1, not representable as float64
	bigID := `{"ownerAccountId":"9007199254740993","providerId":"acme","profileKey":"m1","providerRevision":4,"bindingRevision":2}`
	if rec := serviceRequest(t, server, token, "", bigID); rec.Code != http.StatusOK {
		t.Fatalf("big owner resolve %d %s", rec.Code, rec.Body.String())
	}
	if got := store.resolveIn[len(store.resolveIn)-1].OwnerAccountID; got != beyondJSSafe {
		t.Fatalf("big owner id got %d want %d", got, beyondJSSafe)
	}
	for name, invalid := range map[string]string{
		"float neighbor": `{"ownerAccountId":"9007199254740992.0"}`,
		"non numeric":    `{"ownerAccountId":"3ad"}`,
		"zero":           `{"ownerAccountId":"0"}`,
		"negative":       `{"ownerAccountId":"-5"}`,
		"empty":          `{"ownerAccountId":""}`,
		"json number":    `{"ownerAccountId":1}`,
		"hex":            `{"ownerAccountId":"0x1"}`,
	} {
		if rec := serviceRequest(t, server, token, "", invalid); rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid owner id %s: got %d %s", name, rec.Code, rec.Body.String())
		}
	}

	store.resolveErr = &postgres.PurposeUnavailableError{Status: postgres.BindingUnavailable}
	rec = serviceRequest(t, server, token, "", body)
	if rec.Code != http.StatusConflict || decodeBody(t, rec)["code"] != "MODEL_NO_ELIGIBLE_DEPLOYMENT" ||
		!strings.Contains(rec.Body.String(), `"status":"UNAVAILABLE"`) {
		t.Fatalf("unavailable %d %s", rec.Code, rec.Body.String())
	}
	store.resolveErr = &postgres.ResolveConflictError{ProviderID: "acme", ProfileKey: "m2", ProviderRevision: 5, BindingRevision: 3}
	rec = serviceRequest(t, server, token, "", body)
	if rec.Code != http.StatusConflict || decodeBody(t, rec)["code"] != "REVISION_CONFLICT" ||
		!strings.Contains(rec.Body.String(), `"profileKey":"m2"`) {
		t.Fatalf("stale %d %s", rec.Code, rec.Body.String())
	}
	store.resolveErr = postgres.ErrServiceOwnerRejected
	if rec = serviceRequest(t, server, token, "", body); rec.Code != http.StatusForbidden {
		t.Fatalf("owner rejected %d", rec.Code)
	}

	// The service token is not an administrator session.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/providers", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	admin := httptest.NewRecorder()
	server.Handler().ServeHTTP(admin, req)
	if admin.Code != http.StatusUnauthorized {
		t.Fatalf("service token on admin surface %d %s", admin.Code, admin.Body.String())
	}
}

func TestVerifyModelToolCallsProbesOnceAndDoesNotEchoUpstream(t *testing.T) {
	t.Parallel()
	const marker = "UPSTREAM_SECRET_MARKER"
	var seen [][]byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		seen = append(seen, body)
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(string(body), `"model":"mismatch"`) {
			_, _ = w.Write([]byte(`{"note":"` + marker + `","output":[{"type":"function_call","name":"leak_marker_xyz","arguments":"{\"city\":\"北京\"}"}],"usage":{"input_tokens":2,"output_tokens":3}}`))
			return
		}
		if strings.Contains(string(body), `"model":"down"`) {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(marker))
			return
		}
		_, _ = w.Write([]byte(`{"note":"` + marker + `","output":[{"type":"function_call","name":"get_current_weather","arguments":"{\"city\":\"北京\"}"}],"usage":{"input_tokens":4,"output_tokens":5}}`))
	}))
	defer upstream.Close()

	server, store := newProviderServer(t)
	server.cfg.Provider.AllowLoopbackHTTP = true
	store.configs[0].Protocol = postgres.ProtocolOpenAIResponses
	store.configs[0].BaseURL = upstream.URL + "/v1"
	store.configs[0].Models[0].ProfileKey = "m@chat"
	store.configs[0].Models[0].ModelID = "remote-a"
	store.configs[0].Models[0].Capabilities = postgres.ModelCapabilities{"toolCalls": postgres.CapabilityDeclared}
	path := "/api/v1/admin/providers/acme/models/m@chat/verify-tool-calls"

	user := providerRequest(t, server, store, http.MethodPost, path, "{}", 1, true)
	if user.Code != http.StatusForbidden || len(seen) != 0 || len(store.verified) != 0 {
		t.Fatalf("user %d calls=%d body=%s", user.Code, len(seen), user.Body.String())
	}
	stale := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, false)
	if stale.Code != http.StatusForbidden || len(seen) != 0 {
		t.Fatalf("stale reauth %d calls=%d", stale.Code, len(seen))
	}

	store.configs[0].Models[0].ModelID = "mismatch"
	mismatch := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if mismatch.Code != http.StatusUnprocessableEntity || decodeBody(t, mismatch)["code"] != "TOOL_CALL_MISMATCH" ||
		strings.Contains(mismatch.Body.String(), marker) || strings.Contains(mismatch.Body.String(), "北京") ||
		strings.Contains(mismatch.Body.String(), "leak_marker_xyz") || len(store.verified) != 0 ||
		store.configs[0].Models[0].Capabilities["toolCalls"] != postgres.CapabilityDeclared ||
		store.usageLastPurpose != postgres.PurposeForegroundChat || store.usageSettles != 1 {
		t.Fatalf("mismatch %d settles=%d caps=%v body=%s", mismatch.Code, store.usageSettles, store.configs[0].Models[0].Capabilities, mismatch.Body.String())
	}

	store.configs[0].Models[0].ModelID = "down"
	down := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if down.Code != http.StatusBadGateway || decodeBody(t, down)["code"] != "UPSTREAM_UNAVAILABLE" ||
		strings.Contains(down.Body.String(), marker) || store.usageLastCancel != "UNKNOWN" || len(store.verified) != 0 {
		t.Fatalf("down %d cancel=%s body=%s", down.Code, store.usageLastCancel, down.Body.String())
	}

	store.configs[0].Models[0].ModelID = "remote-a"
	store.settleErr = postgres.ErrInvalid
	rejected := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if rejected.Code != http.StatusConflict || decodeBody(t, rejected)["code"] != "USAGE_REJECTED" || len(store.verified) != 0 {
		t.Fatalf("settle rejected %d verified=%v body=%s", rejected.Code, store.verified, rejected.Body.String())
	}
	store.settleErr = nil

	ok := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	payload := decodeBody(t, ok)
	if ok.Code != http.StatusOK || payload["toolCalls"] != postgres.CapabilityVerified ||
		payload["protocol"] != postgres.ProtocolOpenAIResponses || payload["ok"] != true ||
		strings.Contains(ok.Body.String(), marker) || strings.Contains(ok.Body.String(), "北京") ||
		len(store.verified) != 1 || store.verified[0] != "m@chat" ||
		store.configs[0].Models[0].Capabilities["toolCalls"] != postgres.CapabilityVerified ||
		!strings.HasPrefix(store.usageLastAttempt, "tool-probe-") || store.usageLastPurpose != postgres.PurposeForegroundChat {
		t.Fatalf("verify %d %+v caps=%v attempt=%s body=%s", ok.Code, payload, store.configs[0].Models[0].Capabilities, store.usageLastAttempt, ok.Body.String())
	}
	var probe map[string]any
	if err := json.Unmarshal(seen[len(seen)-1], &probe); err != nil {
		t.Fatal(err)
	}
	if probe["max_output_tokens"] != float64(64) || probe["model"] != "remote-a" {
		t.Fatalf("probe payload %#v", probe)
	}
	choice, _ := probe["tool_choice"].(map[string]any)
	if choice["type"] != "function" || choice["name"] != "get_current_weather" {
		t.Fatalf("tool_choice %#v", probe["tool_choice"])
	}
}
