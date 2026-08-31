package config

import (
	"strings"
	"testing"
	"time"
)

func TestLoadRequiresMode(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(func(string) string { return "" })
	if err == nil || !strings.Contains(err.Error(), "VC_MODE") {
		t.Fatalf("expected VC_MODE error, got %v", err)
	}
}

func TestLoadRejectsUnknownMode(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{"VC_MODE": "strangler"}))
	if err == nil || !strings.Contains(err.Error(), "api-migration or full") {
		t.Fatalf("expected mode error, got %v", err)
	}
}

func TestAPIMigrationHardDisablesEveryForbiddenPlane(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "api-migration"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AllowsWrites() {
		t.Fatal("api-migration must not allow writes")
	}
	for _, p := range ForbiddenPlanes() {
		if cfg.Allows(p) {
			t.Fatalf("api-migration must not allow %s", p)
		}
	}
}

func TestFullModeAllowsForbiddenPlanes(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "full"}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.AllowsWrites() {
		t.Fatal("full mode must allow writes")
	}
	for _, p := range ForbiddenPlanes() {
		if !cfg.Allows(p) {
			t.Fatalf("full mode must allow %s", p)
		}
	}
	if cfg.Allows(Plane("not-a-plane")) {
		t.Fatal("unknown plane must stay false")
	}
}

func TestHTTPOrigins(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":         "api-migration",
		"VC_HTTP_ORIGINS": "https://vc.test,http://127.0.0.1:5173",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.HTTP.AllowedOrigins) != 2 || cfg.HTTP.AllowedOrigins[0] != "https://vc.test" {
		t.Fatalf("%q", cfg.HTTP.AllowedOrigins)
	}
	_, err = LoadEnv(env(map[string]string{
		"VC_MODE":         "api-migration",
		"VC_HTTP_ORIGINS": "https://vc.test/app",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_HTTP_ORIGINS") {
		t.Fatalf("got %v", err)
	}
}

func TestHTTPTrustProxyHeaders(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "full"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTP.TrustProxyHeaders {
		t.Fatal("proxy headers must be ignored by default")
	}
	cfg, err = LoadEnv(env(map[string]string{
		"VC_MODE":                     "full",
		"VC_HTTP_TRUST_PROXY_HEADERS": "true",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.HTTP.TrustProxyHeaders {
		t.Fatal("trusted proxy setting was not loaded")
	}
	_, err = LoadEnv(env(map[string]string{
		"VC_MODE":                     "full",
		"VC_HTTP_TRUST_PROXY_HEADERS": "sometimes",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_HTTP_TRUST_PROXY_HEADERS") {
		t.Fatalf("expected trusted proxy validation error, got %v", err)
	}
}

func TestPprofMustBeLoopback(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":       "api-migration",
		"VC_PPROF_ADDR": "0.0.0.0:6060",
	}))
	if err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("expected loopback error, got %v", err)
	}
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":       "api-migration",
		"VC_PPROF_ADDR": "127.0.0.1:6060",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Pprof.Addr != "127.0.0.1:6060" {
		t.Fatalf("pprof addr: %s", cfg.Pprof.Addr)
	}
}

func TestShutdownTimeoutAndVersionDefaults(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":             "full",
		"VC_SHUTDOWN_TIMEOUT": "30s",
		"VC_VERSION":          "0.1.0",
		"VC_COMMIT":           "abc",
		"VC_HTTP_ADDR":        "127.0.0.1:0",
		"VC_LOG_LEVEL":        "debug",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Shutdown.Timeout != 30*time.Second {
		t.Fatalf("timeout %s", cfg.Shutdown.Timeout)
	}
	if cfg.Version.Version != "0.1.0" || cfg.Version.Commit != "abc" {
		t.Fatalf("version %+v", cfg.Version)
	}
	if cfg.HTTP.Addr != "127.0.0.1:0" || cfg.Log.Level != "debug" {
		t.Fatalf("http/log %+v %+v", cfg.HTTP, cfg.Log)
	}
}

func TestDatabaseRequiresOwnerBindingSecret(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":   "api-migration",
		"VC_DB_DSN": "postgres://vc_runtime_login@127.0.0.1:5432/vc",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_OWNER_BINDING_SECRET") {
		t.Fatalf("expected owner binding error, got %v", err)
	}
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":                 "api-migration",
		"VC_DB_DSN":               "postgres://vc_runtime_login@127.0.0.1:5432/vc",
		"VC_OWNER_BINDING_SECRET": "0123456789abcdef0123456789abcdef",
		"VC_CRYPTO_REST_KEY":      "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.MaxConns != 8 || cfg.Database.TxTimeout != 5*time.Second {
		t.Fatalf("db defaults %+v", cfg.Database)
	}
	if cfg.Crypto.RestKeyID != "default" || cfg.Crypto.RestKeyVersion != 1 {
		t.Fatalf("crypto %+v", cfg.Crypto)
	}
}

func TestFullDatabaseRequiresCryptoAndExportS3(t *testing.T) {
	t.Parallel()
	base := map[string]string{
		"VC_MODE":                 "full",
		"VC_DB_DSN":               "postgres://vc_runtime_login@127.0.0.1:5432/vc",
		"VC_OWNER_BINDING_SECRET": "0123456789abcdef0123456789abcdef",
	}
	_, err := LoadEnv(env(base))
	if err == nil || !strings.Contains(err.Error(), "VC_CRYPTO_REST_KEY") {
		t.Fatalf("expected rest key error, got %v", err)
	}

	withCrypto := mergeEnv(base, map[string]string{
		"VC_CRYPTO_REST_KEY": "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=",
	})
	for _, missing := range []string{
		"VC_EXPORT_S3_ENDPOINT",
		"VC_EXPORT_S3_ACCESS_KEY",
		"VC_EXPORT_S3_SECRET_KEY",
		"VC_EXPORT_S3_BUCKET",
	} {
		values := mergeEnv(withCrypto, map[string]string{
			"VC_EXPORT_S3_ENDPOINT":   "http://minio:9000",
			"VC_EXPORT_S3_ACCESS_KEY": "access-key",
			"VC_EXPORT_S3_SECRET_KEY": "secret-key",
			"VC_EXPORT_S3_BUCKET":     "exports",
		})
		delete(values, missing)
		_, err := LoadEnv(env(values))
		if err == nil || !strings.Contains(err.Error(), missing) {
			t.Fatalf("missing %s: got %v", missing, err)
		}
	}

	valid := mergeEnv(withCrypto, map[string]string{
		"VC_EXPORT_S3_ENDPOINT":   "http://minio:9000",
		"VC_EXPORT_S3_ACCESS_KEY": "access-key",
		"VC_EXPORT_S3_SECRET_KEY": "secret-key",
		"VC_EXPORT_S3_BUCKET":     "exports",
	})
	cfg, err := LoadEnv(env(valid))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ExportS3.Endpoint != "http://minio:9000" || cfg.ExportS3.Bucket != "exports" {
		t.Fatalf("export S3 config %+v", cfg.ExportS3)
	}

	invalid := mergeEnv(valid, map[string]string{"VC_EXPORT_S3_ENDPOINT": "minio:9000"})
	_, err = LoadEnv(env(invalid))
	if err == nil || !strings.Contains(err.Error(), "VC_EXPORT_S3_ENDPOINT") {
		t.Fatalf("expected endpoint validation error, got %v", err)
	}
}

func TestAPIMigrationDatabaseDoesNotRequireRuntimeCryptoOrS3(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":                 "api-migration",
		"VC_DB_DSN":               "postgres://vc_runtime_login@127.0.0.1:5432/vc",
		"VC_OWNER_BINDING_SECRET": "0123456789abcdef0123456789abcdef",
	}))
	if err != nil {
		t.Fatalf("api-migration must not require runtime crypto/S3: %v", err)
	}
}

func TestSessionDefaults(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "full"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Session.TTL != 7*24*time.Hour || !cfg.Session.CookieSecure || cfg.Session.ReauthWindow != 15*time.Minute {
		t.Fatalf("session %+v", cfg.Session)
	}
	cfg, err = LoadEnv(env(map[string]string{
		"VC_MODE":                  "full",
		"VC_SESSION_TTL":           "24h",
		"VC_SESSION_COOKIE_SECURE": "false",
		"VC_SESSION_REAUTH_WINDOW": "10m",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Session.TTL != 24*time.Hour || cfg.Session.CookieSecure || cfg.Session.ReauthWindow != 10*time.Minute {
		t.Fatalf("override %+v", cfg.Session)
	}
}

func TestProviderDisabledByDefault(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "full"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Provider.Enabled {
		t.Fatal("provider must be disabled unless VC_PROVIDER_ENABLED=true")
	}
	if cfg.Provider.ID != "openai-compatible" || cfg.Provider.SupplierName != "openai-compatible" {
		t.Fatalf("provider identity defaults %+v", cfg.Provider)
	}
	if cfg.Provider.ConnectTimeout != 10*time.Second ||
		cfg.Provider.FirstTokenTimeout != 60*time.Second ||
		cfg.Provider.TotalTimeout != 240*time.Second ||
		cfg.Provider.MaxResponseBytes != 256<<10 {
		t.Fatalf("provider defaults %+v", cfg.Provider)
	}
}

func TestProviderEnabledRequiresEndpointTokenModel(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":             "full",
		"VC_PROVIDER_ENABLED": "true",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_PROVIDER_ENDPOINT") {
		t.Fatalf("expected endpoint error, got %v", err)
	}
	_, err = LoadEnv(env(map[string]string{
		"VC_MODE":              "full",
		"VC_PROVIDER_ENABLED":  "true",
		"VC_PROVIDER_ENDPOINT": "https://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":    "offline-token-sentinel",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_PROVIDER_MODEL") {
		t.Fatalf("expected model error, got %v", err)
	}
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":                   "api-migration",
		"VC_PROVIDER_ENABLED":       "true",
		"VC_PROVIDER_ID":            "owner-provider",
		"VC_PROVIDER_SUPPLIER_NAME": "owner-supplier",
		"VC_PROVIDER_ENDPOINT":      "https://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":         "offline-token-sentinel",
		"VC_PROVIDER_MODEL":         "offline-model-sentinel",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Provider.Enabled || cfg.Allows(PlaneProvider) {
		t.Fatal("api-migration must still hard-disable the provider plane")
	}
	if cfg.Provider.ID != "owner-provider" || cfg.Provider.SupplierName != "owner-supplier" {
		t.Fatalf("provider identity %+v", cfg.Provider)
	}
}

func TestProviderAllowLoopbackHTTPGated(t *testing.T) {
	t.Parallel()
	base := map[string]string{
		"VC_MODE":              "full",
		"VC_PROVIDER_ENABLED":  "true",
		"VC_PROVIDER_ENDPOINT": "http://127.0.0.1:19090/v1/chat/completions",
		"VC_PROVIDER_TOKEN":    "offline-token-sentinel",
		"VC_PROVIDER_MODEL":    "offline-model-sentinel",
	}
	// Fail-closed: plaintext loopback provider is refused unless explicitly
	// enabled, and the flag must not weaken an https endpoint.
	_, err := LoadEnv(env(base))
	if err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("http loopback provider must be refused by default, got %v", err)
	}
	cfg, err := LoadEnv(env(mergeEnv(base, map[string]string{"VC_PROVIDER_ALLOW_LOOPBACK_HTTP": "true"})))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Provider.AllowLoopbackHTTP {
		t.Fatal("VC_PROVIDER_ALLOW_LOOPBACK_HTTP=true must be honored")
	}
	https := mergeEnv(base, map[string]string{"VC_PROVIDER_ENDPOINT": "https://models.example/v1/chat/completions"})
	cfg, err = LoadEnv(env(mergeEnv(https, map[string]string{"VC_PROVIDER_ALLOW_LOOPBACK_HTTP": "true"})))
	if err != nil {
		t.Fatalf("allow-loopback must not reject https endpoints: %v", err)
	}
	// The flag must not open non-loopback plaintext endpoints.
	_, err = LoadEnv(env(mergeEnv(https, map[string]string{"VC_PROVIDER_ENDPOINT": "http://models.example/v1/chat/completions"})))
	if err == nil || !strings.Contains(err.Error(), "must use https") {
		t.Fatalf("non-loopback http provider must be refused even with the flag, got %v", err)
	}
}

func TestProviderRejectsHTTPAndIllegalBudgets(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":              "full",
		"VC_PROVIDER_ENABLED":  "true",
		"VC_PROVIDER_ENDPOINT": "http://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":    "offline-token-sentinel",
		"VC_PROVIDER_MODEL":    "offline-model-sentinel",
	}))
	if err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("expected https error, got %v", err)
	}
	_, err = LoadEnv(env(map[string]string{
		"VC_MODE":                        "full",
		"VC_PROVIDER_ENABLED":            "true",
		"VC_PROVIDER_ENDPOINT":           "https://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":              "offline-token-sentinel",
		"VC_PROVIDER_MODEL":              "offline-model-sentinel",
		"VC_PROVIDER_MAX_RESPONSE_BYTES": "0",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_PROVIDER_MAX_RESPONSE_BYTES") {
		t.Fatalf("expected maxResponseBytes error, got %v", err)
	}
}

func TestBudgetDefaults(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(map[string]string{"VC_MODE": "full"}))
	if err != nil {
		t.Fatal(err)
	}
	b := cfg.Budget
	if b.MaxInputTokens != 8000 || b.MaxOutputTokens != 2048 || b.MaxAttempts != 2 {
		t.Fatalf("token/attempt defaults %+v", b)
	}
	if b.ConnectTimeout != 10*time.Second || b.FirstTokenTimeout != 60*time.Second || b.TotalTimeout != 240*time.Second {
		t.Fatalf("timeout defaults %+v", b)
	}
	if b.MaxResponseBytes != 256<<10 || b.MaxReservedCost != 0 {
		t.Fatalf("bytes/cost defaults %+v", b)
	}
}

func TestBudgetRejectsIllegalAndContradictoryValues(t *testing.T) {
	t.Parallel()
	cases := []struct {
		env  map[string]string
		want string
	}{
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_INPUT_TOKENS": "0"}, "VC_BUDGET_MAX_INPUT_TOKENS"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_OUTPUT_TOKENS": "-1"}, "VC_BUDGET_MAX_OUTPUT_TOKENS"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_OUTPUT_TOKENS": "8000"}, "smaller than"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_ATTEMPTS": "3"}, "VC_BUDGET_MAX_ATTEMPTS"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_RESERVED_COST": "-4"}, "VC_BUDGET_MAX_RESERVED_COST"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_CONNECT_TIMEOUT": "45s", "VC_BUDGET_FIRST_TOKEN_TIMEOUT": "30s"}, "connect <= first-token"},
		{map[string]string{"VC_MODE": "full", "VC_BUDGET_MAX_RESPONSE_BYTES": "0"}, "VC_BUDGET_MAX_RESPONSE_BYTES"},
	}
	for _, tc := range cases {
		_, err := LoadEnv(env(tc.env))
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("env %#v: want %q, got %v", tc.env, tc.want, err)
		}
	}
}

func TestBudgetCannotExceedEnabledProvider(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":                     "full",
		"VC_PROVIDER_ENABLED":         "true",
		"VC_PROVIDER_ENDPOINT":        "https://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":           "offline-token-sentinel",
		"VC_PROVIDER_MODEL":           "offline-model-sentinel",
		"VC_PROVIDER_MAX_TOKENS":      "1024",
		"VC_BUDGET_MAX_OUTPUT_TOKENS": "2048",
	}))
	if err == nil || !strings.Contains(err.Error(), "must not exceed VC_PROVIDER_MAX_TOKENS") {
		t.Fatalf("got %v", err)
	}
}

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func mergeEnv(base, extra map[string]string) map[string]string {
	merged := make(map[string]string, len(base)+len(extra))
	for k, v := range base {
		merged[k] = v
	}
	for k, v := range extra {
		merged[k] = v
	}
	return merged
}
