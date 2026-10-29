package config

import "testing"

func TestModelCostLimits(t *testing.T) {
	for _, tc := range []struct {
		name, ceiling, monthly string
		valid                  bool
	}{
		{"unconfigured-keeps-runtime-available", "0", "0", true},
		{"configured", "1000000", "10000000", true},
		{"negative-monthly", "1", "-1", false},
		{"ceiling-above-monthly", "100", "99", false},
		{"monthly-without-per-call-ceiling", "0", "1000000", false},
		{"overflow", "1", "9223372036854775808", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadEnv(env(map[string]string{
				"VC_MODE": "full", "VC_BUDGET_MAX_RESERVED_COST": tc.ceiling,
				"VC_MONTHLY_COST_LIMIT": tc.monthly,
			}))
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v err=%v", tc.valid, err)
			}
			if tc.name == "configured" && (cfg.MonthlyCostLimit != 10000000 || cfg.Budget.MaxReservedCost != 1000000) {
				t.Fatal("cost limits did not reach runtime configuration")
			}
		})
	}
}
