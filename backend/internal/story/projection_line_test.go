package story

import (
	"strings"
	"testing"
)

func TestPlayerProjectionLineUsesThePageFields(t *testing.T) {
	got := PlayerProjectionLine("钥匙借用记录", "出示借据", "只能证明衣袖", "当场记下")
	if got != "钥匙借用记录\n出示借据\n只能证明衣袖\n当场记下" {
		t.Fatalf("line = %q", got)
	}
}

func TestPlayerProjectionLineDropsHiddenMarkers(t *testing.T) {
	got := PlayerProjectionLine("钥匙借用记录", "出示借据", "GM_ONLY_WATCH_TRUTH_92", "PRIVATE_LIN_LOAN_31")
	if got != "钥匙借用记录\n出示借据" {
		t.Fatalf("line = %q", got)
	}
	for _, marker := range []string{"PRIVATE_", "GM_ONLY_", "ruleId", "truth"} {
		if strings.Contains(got, marker) {
			t.Fatalf("line contains %s: %q", marker, got)
		}
	}
}

func TestPlayerProjectionLineFallsBackWhenNothingIsShowable(t *testing.T) {
	if got := PlayerProjectionLine("", "", "GM_ONLY_WATCH_TRUTH_92", "PRIVATE_LIN_LOAN_31"); got != ProjectionFallback {
		t.Fatalf("fallback = %q", got)
	}
	if got := PlayerProjectionLine("", "", "", ""); got != ProjectionFallback {
		t.Fatalf("empty fallback = %q", got)
	}
}
