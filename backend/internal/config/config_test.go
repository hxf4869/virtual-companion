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
		"VC_MODE":    "api-migration",
		"VC_DB_DSN":  "postgres://vc_runtime_login@127.0.0.1:5432/vc",
	}))
	if err == nil || !strings.Contains(err.Error(), "VC_OWNER_BINDING_SECRET") {
		t.Fatalf("expected owner binding error, got %v", err)
	}
	cfg, err := LoadEnv(env(map[string]string{
		"VC_MODE":                   "api-migration",
		"VC_DB_DSN":                 "postgres://vc_runtime_login@127.0.0.1:5432/vc",
		"VC_OWNER_BINDING_SECRET":   "0123456789abcdef0123456789abcdef",
		"VC_JWT_SECRET":             "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
		"VC_CRYPTO_REST_KEY":        "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Database.MaxConns != 8 || cfg.Database.TxTimeout != 5*time.Second {
		t.Fatalf("db defaults %+v", cfg.Database)
	}
	if cfg.JWT.Issuer != "virtual-companion" {
		t.Fatalf("issuer %s", cfg.JWT.Issuer)
	}
	if cfg.Crypto.RestKeyID != "default" || cfg.Crypto.RestKeyVersion != 1 {
		t.Fatalf("crypto %+v", cfg.Crypto)
	}
}

func TestJWTSecretMustBe256Bits(t *testing.T) {
	t.Parallel()
	_, err := LoadEnv(env(map[string]string{
		"VC_MODE":       "api-migration",
		"VC_JWT_SECRET": "short-secret",
	}))
	if err == nil || !strings.Contains(err.Error(), "256 bits") {
		t.Fatalf("expected jwt secret error, got %v", err)
	}
}

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}
