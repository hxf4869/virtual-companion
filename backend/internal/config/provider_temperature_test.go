package config

import "testing"

// The temperature range check runs in the provider-enabled validation block,
// so every case loads with the provider enabled and its required fields set.
func providerEnv(temperature string) map[string]string {
	env := map[string]string{
		"VC_MODE":                 "full",
		"VC_PROVIDER_ENABLED":     "true",
		"VC_PROVIDER_ENDPOINT":    "https://models.example/v1/chat/completions",
		"VC_PROVIDER_TOKEN":       "synthetic-provider-token",
		"VC_PROVIDER_MODEL":       "synthetic-model",
		"VC_PROVIDER_MAX_TOKENS":  "8192",
		"VC_PROVIDER_TEMPERATURE": temperature,
	}
	if temperature == "" {
		delete(env, "VC_PROVIDER_TEMPERATURE")
	}
	return env
}

func TestProviderTemperatureDefaultAndExplicitZero(t *testing.T) {
	t.Parallel()
	cfg, err := LoadEnv(env(providerEnv("")))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Provider.Temperature != 1.0 {
		t.Fatalf("unset temperature default = %v, want 1.0", cfg.Provider.Temperature)
	}

	cfg, err = LoadEnv(env(providerEnv("0")))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Provider.Temperature != 0 {
		t.Fatalf("explicit zero temperature = %v, want 0", cfg.Provider.Temperature)
	}

	if _, err := LoadEnv(env(providerEnv("3"))); err == nil {
		t.Fatal("out-of-range temperature must fail validation")
	}
}

