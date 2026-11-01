package proactive

import (
	"testing"
	"time"
)

func TestActivityStablePerPeriodAndCoversTemplates(t *testing.T) {
	loc := Zone("Asia/Shanghai")
	morning := time.Date(2026, 11, 2, 8, 0, 0, 0, loc)
	a := Activity(7, morning, loc, "开心")
	if a == "" || a != Activity(7, morning.Add(90*time.Minute), loc, "开心") {
		t.Fatalf("activity must be non-empty and stable inside one period: %q", a)
	}
	for _, c := range []struct {
		hour int
		want string
	}{{4, "夜"}, {5, "早"}, {10, "早"}, {11, "午"}, {16, "午"}, {17, "晚"}, {21, "晚"}, {22, "夜"}} {
		if got := Period(time.Date(2026, 11, 2, c.hour, 0, 0, 0, loc), loc); got != c.want {
			t.Fatalf("hour %d period = %s, want %s", c.hour, got, c.want)
		}
	}
	for vibe := range activityVibeClass {
		for _, hour := range []int{8, 13, 19, 23} {
			if Activity(1, time.Date(2026, 11, 2, hour, 0, 0, 0, loc), loc, vibe) == "" {
				t.Fatalf("empty activity for %s at %d", vibe, hour)
			}
		}
	}
	if Activity(1, morning, loc, "未知") == "" {
		t.Fatal("unknown vibe must fall back")
	}
}
