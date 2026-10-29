//go:build integration

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

	"github.com/jackc/pgx/v5"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const catalogServiceToken = "iso-st-plugin-service-token-0123456789abcdef"

// newCatalogServer is newIsoServer plus the provider surface and the service
// channel token, against the real isolation store and field cipher.
func newCatalogServer(t *testing.T, store *postgres.Store) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "full"
		case "VC_VERSION":
			return "test-version"
		case "VC_HTTP_ORIGINS":
			return "https://vc.test"
		case "VC_SESSION_COOKIE_SECURE":
			return "false"
		case "VC_ST_PLUGIN_SERVICE_TOKEN":
			return catalogServiceToken
		case "VC_ST_HOST_BASE_URL":
			// Full mode refuses a service token without the host the channel
			// calls. The catalog flow never dials it; the value only satisfies
			// startup validation (W06).
			return "http://127.0.0.1:8752"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{
		Store: store, Sessions: store, Passwords: pw, Limiter: auth.NewLimiter(), Turns: store, AuthFlow: store, Providers: store,
	})
}

func adminJSON(t *testing.T, s *Server, method, path, body string, account int64) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	sessionID, err := s.core.Store.IssueOpaqueSession(req.Context(), account, hash, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if isStateChanging(method) {
		if err := s.core.Store.RecordOpaqueReauth(req.Context(), account, sessionID); err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", "https://vc.test")
		req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
		req.Header.Set(csrfHeader, "csrf-token")
	}
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: raw})
	req.Header.Set(expectedAccountHeader, strconv.FormatInt(account, 10))
	req.Header.Set(expectedSessionHeader, strconv.FormatInt(sessionID, 10))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestModelCatalogEndToEnd(t *testing.T) {
	resetIsolation(t)
	ctx := context.Background()
	for _, stmt := range []string{
		`TRUNCATE vc.provider_model, vc.provider_config CASCADE`,
		`INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
		 VALUES ('FOREGROUND_CHAT', 'DISABLED', 0), ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'DISABLED', 0),
		        ('BACKGROUND_GREETINGS', 'DISABLED', 0), ('STORY_DIRECTOR', 'DISABLED', 0),
		        ('NPC_DIALOGUE', 'DISABLED', 0), ('EMBEDDING', 'DISABLED', 0)
		 ON CONFLICT (purpose) DO UPDATE
		    SET provider_id = NULL, profile_key = NULL, state = 'DISABLED', revision = 1`,
		`INSERT INTO vc.vc_user(id, display_name) VALUES (3, 'admin')`,
	} {
		if err := postgres.IsolationSuperExec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.identity_account(id, username, email, email_verified_at, reviewed_at, password_hash, role, status, display_name)
		 VALUES (3, 'admin', 'admin@example.com', now(), now(), $1, 'ADMIN', 'ACTIVE', 'admin')`, isoPasswordHash); err != nil {
		t.Fatal(err)
	}
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newCatalogServer(t, store)
	const plaintext = "iso-plain-api-key-1"

	save := `{"displayName":"Acme","protocol":"OPENAI_CHAT_COMPLETIONS","baseUrl":"https://chat.example/v1","credential":"` + plaintext + `","state":"ENABLED","models":[{"profileKey":"m@chat","modelId":"m","displayName":"Chat","contextWindowTokens":32768,"maxOutputTokens":2048,"state":"ENABLED","capabilities":{"toolCalls":"DECLARED"},"reasoningLevels":["low"],"generationParams":{"temperature":0.3,"reasoningEffort":"low"},"pricing":{"currency":"USD","inputPerMillionTokens":2}}]}`
	rec := adminJSON(t, s, http.MethodPut, "/api/v1/admin/providers/acme", save, 3)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"revision":1`) {
		t.Fatalf("save %d %s", rec.Code, rec.Body.String())
	}

	list := adminJSON(t, s, http.MethodGet, "/api/v1/admin/providers", "", 3)
	body := list.Body.String()
	if list.Code != http.StatusOK || strings.Contains(body, plaintext) || strings.Contains(body, "enc2:") ||
		strings.Contains(body, `"credential"`) || !strings.Contains(body, `"credentialConfigured":true`) ||
		!strings.Contains(body, `"endpointUrl":"https://chat.example/v1/chat/completions"`) ||
		!strings.Contains(body, `"profileKey":"m@chat"`) || !strings.Contains(body, `"imageInput":"UNKNOWN"`) {
		t.Fatalf("list %d %s", list.Code, body)
	}

	bind := adminJSON(t, s, http.MethodPut, "/api/v1/admin/model-purposes/FOREGROUND_CHAT",
		`{"providerId":"acme","profileKey":"m@chat","state":"ENABLED","expectedRevision":1}`, 3)
	if bind.Code != http.StatusOK || !strings.Contains(bind.Body.String(), `"status":"READY"`) ||
		!strings.Contains(bind.Body.String(), `"revision":2`) {
		t.Fatalf("bind %d %s", bind.Code, bind.Body.String())
	}

	resolve := func(assert string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve",
			strings.NewReader(`{"ownerAccountId":"3"`+assert+`}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+catalogServiceToken)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		return rec
	}
	ok := resolve(`,"providerId":"acme","profileKey":"m@chat","providerRevision":1,"bindingRevision":2`)
	var resolved purposeResolveResponseJSON
	if err := json.Unmarshal(ok.Body.Bytes(), &resolved); err != nil || ok.Code != http.StatusOK {
		t.Fatalf("resolve %d %s", ok.Code, ok.Body.String())
	}
	if resolved.Provider.Credential != plaintext || resolved.Model.ModelID != "m" ||
		*resolved.Model.ContextWindowTokens != 32768 || *resolved.Model.GenerationParams.ReasoningEffort != "low" ||
		*resolved.Model.Pricing.Currency != "USD" || resolved.Model.Capabilities["toolCalls"] != "DECLARED" {
		t.Fatalf("resolved %s", ok.Body.String())
	}
	if stale := resolve(`,"providerRevision":9`); stale.Code != http.StatusConflict ||
		!strings.Contains(stale.Body.String(), `"code":"REVISION_CONFLICT"`) {
		t.Fatalf("stale %d %s", stale.Code, stale.Body.String())
	}

	// Owner IDs ride as decimal strings: an ACTIVE account above the JS
	// safe-integer range resolves, while its float-mangled neighbour is
	// rejected, proving the exact int64 reached the owner check.
	if err := postgres.IsolationSuperExec(ctx, `INSERT INTO vc.vc_user(id, display_name) VALUES (9007199254740993, 'bigowner')`); err != nil {
		t.Fatal(err)
	}
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.identity_account(id, username, email, email_verified_at, reviewed_at, password_hash, role, status, display_name)
		 VALUES (9007199254740993, 'bigowner', 'bigowner@example.com', now(), now(), $1, 'ADMIN', 'ACTIVE', 'bigowner')`, isoPasswordHash); err != nil {
		t.Fatal(err)
	}
	bigResolve := func(owner string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/service/model-purposes/FOREGROUND_CHAT/resolve",
			strings.NewReader(`{"ownerAccountId":"`+owner+`","providerId":"acme","profileKey":"m@chat","providerRevision":1,"bindingRevision":2}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+catalogServiceToken)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		return rec
	}
	if rec := bigResolve("9007199254740993"); rec.Code != http.StatusOK {
		t.Fatalf("big owner resolve %d %s", rec.Code, rec.Body.String())
	}
	if rec := bigResolve("9007199254740992"); rec.Code != http.StatusForbidden ||
		!strings.Contains(rec.Body.String(), `"code":"ACCESS_DENIED"`) {
		t.Fatalf("float-mangled neighbor must be rejected, got %d %s", rec.Code, rec.Body.String())
	}

	// Clearing the key revokes the binding for the very next service request.
	clear := `{"displayName":"Acme","protocol":"OPENAI_CHAT_COMPLETIONS","baseUrl":"https://chat.example/v1","clearCredential":true,"state":"DISABLED","expectedRevision":1,"models":[{"profileKey":"m@chat","modelId":"m","displayName":"Chat","contextWindowTokens":32768,"maxOutputTokens":2048,"state":"ENABLED"}]}`
	if rec = adminJSON(t, s, http.MethodPut, "/api/v1/admin/providers/acme", clear, 3); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), `"revision":2`) {
		t.Fatalf("clear %d %s", rec.Code, rec.Body.String())
	}
	if revoked := resolve(""); revoked.Code != http.StatusConflict ||
		!strings.Contains(revoked.Body.String(), `"code":"MODEL_NO_ELIGIBLE_DEPLOYMENT"`) ||
		!strings.Contains(revoked.Body.String(), `"status":"UNAVAILABLE"`) {
		t.Fatalf("revoked %d %s", revoked.Code, revoked.Body.String())
	}
	// The documents an older caller did not send survived the clear.
	list = adminJSON(t, s, http.MethodGet, "/api/v1/admin/providers", "", 3)
	if !strings.Contains(list.Body.String(), `"toolCalls":"DECLARED"`) || !strings.Contains(list.Body.String(), `"currency":"USD"`) ||
		!strings.Contains(list.Body.String(), `"credentialConfigured":false`) {
		t.Fatalf("after clear %s", list.Body.String())
	}

	// The service token is never an administrator session.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/providers", nil)
	req.Header.Set("Authorization", "Bearer "+catalogServiceToken)
	admin := httptest.NewRecorder()
	s.Handler().ServeHTTP(admin, req)
	if admin.Code != http.StatusUnauthorized {
		t.Fatalf("service token on admin surface %d", admin.Code)
	}
}

func TestVerifyModelToolCallsAgainstTheIsolationDatabase(t *testing.T) {
	resetIsolation(t)
	ctx := context.Background()
	const marker = "UPSTREAM_SECRET_MARKER"
	mode := "mismatch"
	var requests [][]byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		requests = append(requests, body)
		w.Header().Set("Content-Type", "application/json")
		if mode == "mismatch" {
			_, _ = io.WriteString(w, `{"note":"`+marker+`","choices":[{"message":{"tool_calls":[{"function":{"name":"leak_marker_xyz","arguments":"{\"city\":\"北京\"}"}}]}}],"usage":{"prompt_tokens":2,"completion_tokens":3}}`)
			return
		}
		_, _ = io.WriteString(w, `{"note":"`+marker+`","choices":[{"message":{"tool_calls":[{"function":{"name":"get_current_weather","arguments":"{\"city\":\"北京\"}"}}]}}],"usage":{"prompt_tokens":4,"completion_tokens":5}}`)
	}))
	defer upstream.Close()

	for _, stmt := range []string{
		`TRUNCATE vc.provider_model, vc.provider_config, vc.model_cost_reservation CASCADE`,
		`INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
		 VALUES ('FOREGROUND_CHAT', 'DISABLED', 0), ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'DISABLED', 0),
		        ('BACKGROUND_GREETINGS', 'DISABLED', 0), ('STORY_DIRECTOR', 'DISABLED', 0),
		        ('NPC_DIALOGUE', 'DISABLED', 0), ('EMBEDDING', 'DISABLED', 0)
		 ON CONFLICT (purpose) DO UPDATE
		    SET provider_id = NULL, profile_key = NULL, state = 'DISABLED', revision = 1`,
		`INSERT INTO vc.vc_user(id, display_name) VALUES (3, 'admin')`,
	} {
		if err := postgres.IsolationSuperExec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.identity_account(id, username, email, email_verified_at, reviewed_at, password_hash, role, status, display_name)
		 VALUES (3, 'probe-admin', 'probe-admin@example.com', now(), now(), $1, 'ADMIN', 'ACTIVE', 'admin')`, isoPasswordHash); err != nil {
		t.Fatal(err)
	}
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newCatalogServer(t, store)
	s.cfg.Provider.AllowLoopbackHTTP = true

	save := `{"displayName":"Probe","protocol":"OPENAI_CHAT_COMPLETIONS","baseUrl":"` + upstream.URL + `/v1","credential":"probe-secret","state":"ENABLED","models":[{"profileKey":"m@chat","modelId":"probe-model","displayName":"Probe","maxOutputTokens":128,"state":"ENABLED","capabilities":{"toolCalls":"DECLARED"}}]}`
	if rec := adminJSON(t, s, http.MethodPut, "/api/v1/admin/providers/probeacme", save, 3); rec.Code != http.StatusOK {
		t.Fatalf("save %d %s", rec.Code, rec.Body.String())
	}
	path := "/api/v1/admin/providers/probeacme/models/m@chat/verify-tool-calls"
	if rec := adminJSON(t, s, http.MethodPost, path, "{}", 1); rec.Code != http.StatusForbidden || len(requests) != 0 {
		t.Fatalf("user %d calls=%d %s", rec.Code, len(requests), rec.Body.String())
	}
	mismatch := adminJSON(t, s, http.MethodPost, path, "{}", 3)
	if mismatch.Code != http.StatusUnprocessableEntity || !strings.Contains(mismatch.Body.String(), `"code":"TOOL_CALL_MISMATCH"`) ||
		strings.Contains(mismatch.Body.String(), marker) || strings.Contains(mismatch.Body.String(), "北京") ||
		strings.Contains(mismatch.Body.String(), "leak_marker_xyz") {
		t.Fatalf("mismatch %d %s", mismatch.Code, mismatch.Body.String())
	}
	list := adminJSON(t, s, http.MethodGet, "/api/v1/admin/providers", "", 3)
	if !strings.Contains(list.Body.String(), `"toolCalls":"DECLARED"`) {
		t.Fatalf("failure changed capability %s", list.Body.String())
	}

	mode = "ok"
	ok := adminJSON(t, s, http.MethodPost, path, "{}", 3)
	if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), `"toolCalls":"VERIFIED"`) ||
		strings.Contains(ok.Body.String(), marker) || strings.Contains(ok.Body.String(), "北京") {
		t.Fatalf("verify %d %s", ok.Code, ok.Body.String())
	}
	if len(requests) != 2 || !strings.Contains(string(requests[1]), `"max_tokens":64`) ||
		!strings.Contains(string(requests[1]), `"get_current_weather"`) {
		t.Fatalf("probe requests %d %s", len(requests), requests)
	}

	conn, err := pgx.Connect(ctx, postgres.IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, `
		SELECT id, purpose, status, actual_usd IS NULL, actual_input_tokens, actual_output_tokens
		  FROM vc.model_cost_reservation
		 WHERE provider_id = 'probeacme'
		 ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	type hold struct {
		id              int64
		purpose, status string
		unpriced        bool
		input, output   int64
	}
	var holds []hold
	for rows.Next() {
		var row hold
		if err := rows.Scan(&row.id, &row.purpose, &row.status, &row.unpriced, &row.input, &row.output); err != nil {
			t.Fatal(err)
		}
		holds = append(holds, row)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(holds) != 2 || holds[0].purpose != postgres.PurposeForegroundChat || holds[1].purpose != postgres.PurposeForegroundChat ||
		holds[0].status != "SETTLED" || holds[1].status != "SETTLED" || !holds[0].unpriced || !holds[1].unpriced ||
		holds[0].input != 2 || holds[0].output != 3 || holds[1].input != 4 || holds[1].output != 5 {
		t.Fatalf("usage %+v", holds)
	}
	if _, err := store.SettleModelUsage(ctx, 2, holds[1].id, 1, 1, nil); err == nil {
		t.Fatal("other owner settled the admin probe")
	}

	moved := `{"displayName":"Probe","protocol":"OPENAI_CHAT_COMPLETIONS","baseUrl":"https://moved.example/v1","state":"ENABLED","models":[{"profileKey":"m@chat","modelId":"probe-model","displayName":"Probe","maxOutputTokens":128,"state":"ENABLED","capabilities":{"toolCalls":"VERIFIED"}}]}`
	if rec := adminJSON(t, s, http.MethodPut, "/api/v1/admin/providers/probeacme", moved, 3); rec.Code != http.StatusOK {
		t.Fatalf("downgrade save %d %s", rec.Code, rec.Body.String())
	}
	list = adminJSON(t, s, http.MethodGet, "/api/v1/admin/providers", "", 3)
	if !strings.Contains(list.Body.String(), `"toolCalls":"DECLARED"`) || strings.Contains(list.Body.String(), `"toolCalls":"VERIFIED"`) {
		t.Fatalf("after base url change %s", list.Body.String())
	}
}
