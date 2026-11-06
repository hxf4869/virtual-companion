package postgres

import (
	"testing"
	"time"
)

func TestDiaryDueUsesHourBeforeQuietStart(t *testing.T) {
	loc := time.FixedZone("x", 8*3600)
	at := func(h, m int) time.Time { return time.Date(2026, 11, 2, h, m, 0, 0, loc) }
	cases := []struct {
		now   time.Time
		quiet string
		want  bool
	}{
		{at(21, 59), "", false}, {at(22, 0), "", true},
		{at(21, 59), "23:00", false}, {at(22, 0), "23:00", true},
		{at(22, 59), "00:30", true}, {at(21, 0), "22:00", true}, {at(20, 59), "22:00", false},
	}
	for _, c := range cases {
		if got := diaryDue(c.now, c.quiet); got != c.want {
			t.Fatalf("diaryDue(%s, %q) = %v, want %v", c.now.Format("15:04"), c.quiet, got, c.want)
		}
	}
}

func TestDiaryDueEarlyMorningWindowsUseEvening(t *testing.T) {
	loc := time.FixedZone("local", 8*3600)
	for _, c := range []struct {
		quiet string
		hour  int
		min   int
	}{
		{"00:00", 22, 0}, {"00:30", 22, 0}, {"01:00", 22, 0},
		{"05:59", 22, 0}, {"06:00", 22, 0}, {"06:59", 22, 0},
		{"07:00", 6, 0}, {"07:01", 6, 1},
		{"21:30", 20, 30}, {"23:00", 22, 0},
		{"", 22, 0}, {"invalid", 22, 0}, {"24:00", 22, 0}, {"23:60", 22, 0},
	} {
		t.Run(c.quiet, func(t *testing.T) {
			due := c.hour*60 + c.min
			for _, minute := range []int{0, 1, 359, 360, due - 1, due, due + 1, 1439} {
				local := time.Date(2026, 11, 5, minute/60, minute%60, 0, 0, loc)
				if got, want := diaryDue(local, c.quiet), minute >= due; got != want {
					t.Errorf("diaryDue(%s, %q) = %v, want %v", local.Format("15:04"), c.quiet, got, want)
				}
			}
		})
	}
}

func TestPinMemoriesFirstKeepsAllowlistAndLimit(t *testing.T) {
	allowed := map[string]Memory{
		"r1": {ID: 1, Summary: "a"}, "r2": {ID: 2, Summary: "b"}, "r3": {ID: 3, Summary: "c"},
	}
	hits := []Memory{{ID: 3, Summary: "c"}, {ID: 2, Summary: "b"}}
	got := pinMemoriesFirst(hits, allowed, []int64{1, 2, 99}, 3)
	if len(got) != 3 || got[0].ID != 1 || got[1].ID != 2 || got[2].ID != 3 {
		t.Fatalf("order = %+v", got)
	}
	if got := pinMemoriesFirst(hits, allowed, []int64{1}, 2); len(got) != 2 || got[0].ID != 1 {
		t.Fatalf("limit not applied: %+v", got)
	}
	if got := pinMemoriesFirst(hits, allowed, nil, 5); len(got) != 2 || got[0].ID != 3 {
		t.Fatalf("no pins must keep hits: %+v", got)
	}
}
