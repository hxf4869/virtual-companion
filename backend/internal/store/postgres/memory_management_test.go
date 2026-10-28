package postgres

import "testing"

func TestMemoryFiltersRejectMalformedCursorStatusAndDates(t *testing.T) {
	for _, f := range []MemoryFilters{{Status: "ACCEPTED"}, {Cursor: "-1"}, {Cursor: "abc"}, {EventDateFrom: "2026-02-30"}, {EventDateFrom: "2026-11-01", EventDateTo: "2026-10-30"}, {Limit: 101}} {
		if _, err := normalizeMemoryFilters(f); err == nil {
			t.Fatalf("accepted invalid filter %+v", f)
		}
	}
	f, err := normalizeMemoryFilters(MemoryFilters{Status: "PENDING_VERIFICATION", Cursor: "9223372036854775807", EventDateFrom: "2026-10-30"})
	if err != nil || f.Limit != 30 {
		t.Fatalf("valid filters rejected: %+v %v", f, err)
	}
}
