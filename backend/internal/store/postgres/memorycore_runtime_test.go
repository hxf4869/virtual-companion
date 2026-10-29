package postgres

import (
	"strings"
	"testing"
)

func TestAllowlistIDsAreSorted(t *testing.T) {
	ids := allowlistIDs(map[string]Memory{"zeta": {}, "alpha": {}, "mu": {}})
	if strings.Join(ids, ",") != "alpha,mu,zeta" {
		t.Fatalf("allowlist order = %v", ids)
	}
}
