package postgres

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memorytime"
)

func TestFollowUpSourceDoesNotCallNormalizer(t *testing.T) {
	src, err := os.ReadFile("followup.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "memorytime") {
		t.Fatal("followup.go must read the saved event and must not normalize the summary again")
	}
}

func TestPlanFollowUpUsesSavedMinuteAndIgnoresReminderAt(t *testing.T) {
	reminder := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	plan := planFollowUp(&MemoryTime{Result: memorytime.Result{
		NormalizationStatus: memorytime.StatusExplicitDate,
		EventDate:           followStr("2026-11-02"),
		EventTime:           followStr("15:04"),
		EventTimezone:       followStr("Asia/Shanghai"),
		TimePrecision:       followStr("minute"),
		ReminderAt:          &reminder,
	}})
	want := time.Date(2026, 11, 2, 7, 4, 0, 0, time.UTC)
	if !plan.Create || plan.Status != "SCHEDULED" || plan.TriggerAt == nil || !plan.TriggerAt.Equal(want) {
		t.Fatalf("plan = %+v", plan)
	}
	if plan.TriggerAt.Equal(reminder) {
		t.Fatal("reminderAt was used as the trigger")
	}
}

func TestPlanFollowUpKeepsAmbiguousDateOnlyAndZonelessUntriggerable(t *testing.T) {
	reminder := time.Date(2026, 11, 2, 7, 4, 0, 0, time.UTC)
	cases := []struct {
		name string
		in   *MemoryTime
	}{
		{name: "needs clarification", in: &MemoryTime{Result: memorytime.Result{
			NormalizationStatus: memorytime.StatusNeedsClarification,
			EventDate:           followStr("2026-11-02"),
			EventTime:           followStr("15:04"),
			EventTimezone:       followStr("Asia/Shanghai"),
			TimePrecision:       followStr("minute"),
			ReminderAt:          &reminder,
		}}},
		{name: "date only", in: &MemoryTime{Result: memorytime.Result{
			NormalizationStatus: memorytime.StatusExplicitDate,
			EventDate:           followStr("2026-10-30"),
			EventTimezone:       followStr("Asia/Shanghai"),
			TimePrecision:       followStr("date"),
		}}},
		{name: "missing timezone", in: &MemoryTime{Result: memorytime.Result{
			NormalizationStatus: memorytime.StatusNormalized,
			EventDate:           followStr("2026-11-02"),
			EventTime:           followStr("15:04"),
			TimePrecision:       followStr("minute"),
			ReminderAt:          &reminder,
		}}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			plan := planFollowUp(tc.in)
			if !plan.Create || plan.Status != "NEEDS_CLARIFICATION" || plan.TriggerAt != nil {
				t.Fatalf("plan = %+v", plan)
			}
		})
	}
	if planFollowUp(nil).Create || planFollowUp(&MemoryTime{Result: memorytime.Result{NormalizationStatus: memorytime.StatusNone}}).Create {
		t.Fatal("a memory without an event created a follow-up")
	}
}

func TestFollowUpOutcomePhrasesAreExact(t *testing.T) {
	want := []string{"已经有结果了", "已经完成了", "已经做完了", "已经去过了", "不用问了"}
	if !reflect.DeepEqual(followUpOutcomePhrases, want) {
		t.Fatalf("phrases = %#v", followUpOutcomePhrases)
	}
	for _, phrase := range want {
		if !followUpHasOutcome(" \t" + phrase + " ") {
			t.Fatalf("trimmed %q did not match", phrase)
		}
		if followUpHasOutcome(phrase + "吗") {
			t.Fatalf("question %q matched", phrase)
		}
	}
	for _, near := range []string{"我觉得已经完成了", "已经有结果了吗", "已经完成", "不用问"} {
		if followUpHasOutcome(near) {
			t.Fatalf("near miss %q matched", near)
		}
	}
}

func followStr(s string) *string { return &s }
