package memorytime

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

func timestamp(t *testing.T, value string) time.Time {
	t.Helper()
	out, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestM11SourceAndQueryKeepTheirOwnCalendar(t *testing.T) {
	source := timestamp(t, "2026-10-20T20:00:00+08:00")
	got := Normalize("下周五去厦门参加朋友婚礼。", source, "Asia/Shanghai")
	if got.NormalizationStatus != StatusNormalized || got.EventDate == nil || *got.EventDate != "2026-10-30" ||
		got.SourceExpression != "下周五" || got.NormalizationRule != "ISO_WEEK_NEXT_WEEK_FRIDAY_IN_SOURCE_TIMEZONE" ||
		got.EventTime != nil || got.ReminderAt != nil || got.TimePrecision == nil || *got.TimePrecision != "date" {
		t.Fatalf("source interpretation: %+v", got)
	}
	// A delayed retry can deserialize the same source instant with UTC. It
	// still uses the saved source timezone, never the retry's date or timezone.
	retry := Normalize("下周五去厦门参加朋友婚礼。", source.UTC(), "Asia/Shanghai")
	if !reflect.DeepEqual(got, retry) {
		t.Fatalf("retry rebased source: %+v != %+v", retry, got)
	}
	queryTime := timestamp(t, "2026-10-27T20:00:00+08:00")
	query := Normalize("我下周五有什么安排？", queryTime, "Asia/Shanghai")
	if query.EventDate == nil || *query.EventDate != "2026-11-06" {
		t.Fatalf("query interpretation: %+v", query)
	}
	explicitQuery := Normalize("10月30日我要去哪里？", queryTime, "Asia/Shanghai")
	if explicitQuery.EventDate == nil || *explicitQuery.EventDate != *got.EventDate {
		t.Fatalf("explicit query interpretation: %+v", explicitQuery)
	}
	if *got.EventDate != "2026-10-30" {
		t.Fatal("query changed existing event")
	}
}

func TestDatesAndClockUseSourceTimezone(t *testing.T) {
	base := timestamp(t, "2026-10-20T16:30:00Z")
	cases := []struct {
		text, zone, date, clock, status string
	}{
		{"2026年10月30日去厦门参加朋友婚礼。", "Asia/Shanghai", "2026-10-30", "", StatusExplicitDate},
		{"计划在2026-10-30 09:30见面。", "Asia/Shanghai", "2026-10-30", "09:30", StatusExplicitDate},
		{"明天带书。", "Asia/Shanghai", "2026-10-22", "", StatusNormalized},
		{"明天带书。", "America/Los_Angeles", "2026-10-21", "", StatusNormalized},
		{"后天9:30带书。", "Asia/Shanghai", "2026-10-23", "09:30", StatusNormalized},
		{"今天去书店。", "UTC", "2026-10-20", "", StatusNormalized},
		{"下周一去书店。", "Asia/Shanghai", "2026-10-26", "", StatusNormalized},
		{"下周天去书店。", "Asia/Shanghai", "2026-11-01", "", StatusNormalized},
		{"2028年2月29日去书店。", "Asia/Shanghai", "2028-02-29", "", StatusExplicitDate},
	}
	for _, tt := range cases {
		t.Run(tt.text+tt.zone, func(t *testing.T) {
			got := Normalize(tt.text, base, tt.zone)
			if got.NormalizationStatus != tt.status || got.EventDate == nil || *got.EventDate != tt.date ||
				got.EventTimezone == nil || *got.EventTimezone != tt.zone || got.ReminderAt != nil {
				t.Fatalf("result: %+v", got)
			}
			if tt.clock == "" {
				if got.EventTime != nil || *got.TimePrecision != "date" {
					t.Fatalf("date acquired an instant: %+v", got)
				}
			} else if got.EventTime == nil || *got.EventTime != tt.clock || *got.TimePrecision != "minute" {
				t.Fatalf("time lost: %+v", got)
			}
		})
	}
	// The next natural week is distinct from the nearest matching weekday.
	sunday := timestamp(t, "2026-10-25T20:00:00+08:00")
	got := Normalize("下周日", sunday, "Asia/Shanghai")
	if got.EventDate == nil || *got.EventDate != "2026-11-01" {
		t.Fatalf("Sunday boundary: %+v", got)
	}
}

func TestUncertainExpressionsDoNotInventDatesOrReminders(t *testing.T) {
	base := timestamp(t, "2026-10-20T16:30:00Z")
	cases := []struct{ expression, zone string }{
		{"明天晚上提醒我带书。", ""}, // M12: both timezone and clock are unknown.
		{"明天带书。", ""},
		{"明天带书。", "Local"},
		{"明天带书。", "Invalid/Timezone"},
		{"明天晚上带书。", "Asia/Shanghai"},
		{"2026-10-30或者2026-11-06去厦门", "Asia/Shanghai"},
		{"下周五或周六去厦门", "Asia/Shanghai"},
		{"下下周五去厦门", "Asia/Shanghai"},
		{"大后天去厦门", "Asia/Shanghai"},
		{"大概下周五去厦门", "Asia/Shanghai"},
		{"2026年2月29日去厦门", "Asia/Shanghai"},
		{"2026-13-30去厦门", "Asia/Shanghai"},
		{"2026-10-30 24:00去厦门", "Asia/Shanghai"},
		{"明天09:30或10:00去厦门", "Asia/Shanghai"},
		{"明天09:30:30去厦门", "Asia/Shanghai"},
		{"周五去厦门", "Asia/Shanghai"},
		{"下个月去厦门", "Asia/Shanghai"},
		{"2026年10月30日去厦门", ""},
	}
	for _, tt := range cases {
		t.Run(tt.expression+tt.zone, func(t *testing.T) {
			got := Normalize(tt.expression, base, tt.zone)
			if got.NormalizationStatus != StatusNeedsClarification || got.EventDate != nil ||
				got.EventTime != nil || got.EventTimezone != nil || got.TimePrecision != nil || got.ReminderAt != nil ||
				got.SourceExpression != tt.expression || got.NormalizationRule == "" {
				t.Fatalf("uncertainty lost: %+v", got)
			}
		})
	}
	got := Normalize("下周五去厦门", time.Time{}, "Asia/Shanghai")
	if got.NormalizationStatus != StatusNeedsClarification || got.NormalizationRule != "SOURCE_TIMESTAMP_REQUIRED" {
		t.Fatalf("missing source time: %+v", got)
	}
}

func TestNoTemporalClaimAndUnknownJSON(t *testing.T) {
	got := Normalize("我喜欢乌龙茶。", time.Time{}, "")
	if got.NormalizationStatus != StatusNone || got.SourceExpression != "" || got.EventDate != nil {
		t.Fatalf("ordinary fact treated as dated event: %+v", got)
	}
	got = Normalize("明天带书", timestamp(t, "2026-10-20T16:30:00Z"), "")
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var values map[string]any
	if err := json.Unmarshal(raw, &values); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"eventDate", "eventTime", "eventTimezone", "timePrecision", "reminderAt"} {
		if v, exists := values[field]; !exists || v != nil {
			t.Fatalf("%s must be explicit null, got %v (exists=%v)", field, v, exists)
		}
	}
}

// Consume the repository's frozen source/query examples so the runtime
// convention cannot drift independently of the acceptance fixture.
func TestFrozenMemoryTimeFixtures(t *testing.T) {
	raw, err := os.ReadFile("../../../docs/source/v2-r3/fixtures/memory_cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			ID     string `json:"id"`
			Events []struct {
				Op              string  `json:"op"`
				Text            string  `json:"text"`
				SourceTimestamp string  `json:"source_timestamp"`
				SourceTimezone  *string `json:"source_timezone"`
			} `json:"events"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, c := range fixture.Cases {
		if c.ID != "M11" && c.ID != "M12" {
			continue
		}
		seen++
		event := c.Events[0]
		zone := ""
		if event.SourceTimezone != nil {
			zone = *event.SourceTimezone
		}
		got := Normalize(event.Text, timestamp(t, event.SourceTimestamp), zone)
		if c.ID == "M11" && (got.EventDate == nil || *got.EventDate != "2026-10-30") {
			t.Fatalf("M11: %+v", got)
		}
		if c.ID == "M12" && (got.NormalizationStatus != StatusNeedsClarification || got.EventDate != nil || got.ReminderAt != nil) {
			t.Fatalf("M12: %+v", got)
		}
	}
	if seen != 2 {
		t.Fatalf("expected M11/M12 fixtures, found %d", seen)
	}
}
