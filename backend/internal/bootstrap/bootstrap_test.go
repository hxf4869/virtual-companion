package bootstrap

import "testing"

func TestLoadEnvRequiresDatabaseAndOwnerSecret(t *testing.T) {
	_, err := LoadEnv(func(string) string { return "" })
	if err == nil {
		t.Fatal("expected missing bootstrap configuration to fail")
	}
}

func TestLoadEnvAllowsNoAdminSeed(t *testing.T) {
	env := map[string]string{
		"VC_BOOTSTRAP_DB_DSN":     "postgres://example.invalid/vc",
		"VC_OWNER_BINDING_SECRET": "0123456789abcdef0123456789abcdef",
	}
	cfg, err := LoadEnv(func(key string) string { return env[key] })
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AdminUsername != "" || cfg.AdminPassword != "" {
		t.Fatal("administrator seed must remain optional")
	}
}

func TestLoadEnvRequiresCompleteAdminSeed(t *testing.T) {
	env := map[string]string{
		"VC_BOOTSTRAP_DB_DSN":     "postgres://example.invalid/vc",
		"VC_OWNER_BINDING_SECRET": "0123456789abcdef0123456789abcdef",
		"VC_ADMIN_SEED_USERNAME":  "admin",
	}
	_, err := LoadEnv(func(key string) string { return env[key] })
	if err == nil {
		t.Fatal("expected partial administrator seed to fail")
	}
}
