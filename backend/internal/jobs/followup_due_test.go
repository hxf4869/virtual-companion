package jobs

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestFollowUpDueQuietHoursDefersUntilEnd(t *testing.T) {
	facts := dueReady()
	facts.QuietHoursStart = sp("13:00")
	facts.QuietHoursEnd = sp("18:00")
	facts.QuietHoursTimezone = sp("Asia/Shanghai")
	now := shanghaiTime(2026, time.November, 2, 16, 0)
	got := DecideFollowUpDue(now, facts)
	if got.Action != postgres.FollowUpDueDefer {
		t.Fatalf("action = %s", got.Action)
	}
	if got.DeferredUntil == nil || !got.DeferredUntil.Equal(shanghaiTime(2026, time.November, 2, 18, 0)) {
		t.Fatalf("deferred until %v", got.DeferredUntil)
	}
	assertDuePlan(t, got, facts)
}

func TestFollowUpDueQuietHoursCrossMidnight(t *testing.T) {
	facts := dueReady()
	facts.QuietHoursStart = sp("22:00")
	facts.QuietHoursEnd = sp("07:00")
	facts.QuietHoursTimezone = sp("Asia/Shanghai")
	cases := []struct {
		name  string
		now   time.Time
		quiet bool
		until time.Time
	}{
		{name: "evening", now: shanghaiTime(2026, time.November, 2, 23, 30), quiet: true, until: shanghaiTime(2026, time.November, 3, 7, 0)},
		{name: "after midnight", now: shanghaiTime(2026, time.November, 3, 2, 15), quiet: true, until: shanghaiTime(2026, time.November, 3, 7, 0)},
		{name: "starts at boundary", now: shanghaiTime(2026, time.November, 2, 22, 0), quiet: true, until: shanghaiTime(2026, time.November, 3, 7, 0)},
		{name: "ends at boundary", now: shanghaiTime(2026, time.November, 3, 7, 0), quiet: false},
		{name: "before window", now: shanghaiTime(2026, time.November, 2, 21, 0), quiet: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DecideFollowUpDue(tc.now, facts)
			assertDuePlan(t, got, facts)
			if tc.quiet {
				if got.Action != postgres.FollowUpDueDefer {
					t.Fatalf("action = %s", got.Action)
				}
				if got.DeferredUntil == nil || !got.DeferredUntil.Equal(tc.until) {
					t.Fatalf("deferred until %v, want %v", got.DeferredUntil, tc.until)
				}
				return
			}
			if got.Action != postgres.FollowUpDueEnqueue || got.DeferredUntil != nil {
				t.Fatalf("action = %s until %v", got.Action, got.DeferredUntil)
			}
		})
	}
}

func TestFollowUpDueDailyLimitStaysSilent(t *testing.T) {
	facts := dueReady()
	facts.DailyLimit = 1
	facts.SentToday = 1
	now := facts.TriggerAt.Add(time.Hour)
	got := DecideFollowUpDue(now, facts)
	if got.Action != postgres.FollowUpDueSilent || got.DeferredUntil != nil {
		t.Fatalf("action = %s until %v", got.Action, got.DeferredUntil)
	}
	assertDuePlan(t, got, facts)

	facts.DailyLimit = 0
	facts.SentToday = 0
	got = DecideFollowUpDue(now, facts)
	if got.Action != postgres.FollowUpDueSilent {
		t.Fatalf("zero limit action = %s", got.Action)
	}
	assertDuePlan(t, got, facts)
}

func TestFollowUpDueAlreadyAskedDoesNotEnqueue(t *testing.T) {
	facts := dueReady()
	facts.Asked = true
	got := DecideFollowUpDue(facts.TriggerAt.Add(time.Hour), facts)
	if got.Action != postgres.FollowUpDueLeave || got.DeferredUntil != nil {
		t.Fatalf("action = %s until %v", got.Action, got.DeferredUntil)
	}
	assertDuePlan(t, got, facts)

	facts.Asked = false
	facts.AlreadyQueued = true
	got = DecideFollowUpDue(facts.TriggerAt.Add(time.Hour), facts)
	if got.Action != postgres.FollowUpDueLeave {
		t.Fatalf("queued action = %s", got.Action)
	}
	assertDuePlan(t, got, facts)
}

func TestFollowUpDuePolicyOffDoesNotEnqueue(t *testing.T) {
	facts := dueReady()
	facts.PolicyEnabled = false
	facts.QuietHoursStart = sp("13:00")
	facts.QuietHoursEnd = sp("18:00")
	facts.QuietHoursTimezone = sp("Asia/Shanghai")
	now := shanghaiTime(2026, time.November, 2, 16, 0)
	got := DecideFollowUpDue(now, facts)
	if got.Action != postgres.FollowUpDueLeave || got.DeferredUntil != nil {
		t.Fatalf("action = %s until %v", got.Action, got.DeferredUntil)
	}
	assertDuePlan(t, got, facts)
}

func TestFollowUpDueServerZoneDoesNotChangePlan(t *testing.T) {
	facts := dueReady()
	now := facts.TriggerAt.Add(time.Hour)
	orig := time.Local
	t.Cleanup(func() { time.Local = orig })
	var first postgres.FollowUpDueDecision
	for i, zone := range []string{"UTC", "America/New_York", "Pacific/Kiritimati"} {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			t.Fatal(err)
		}
		time.Local = loc
		got := DecideFollowUpDue(now.In(time.Local), facts)
		if got.Action != postgres.FollowUpDueEnqueue || got.DeferredUntil != nil {
			t.Fatalf("%s action = %s until %v", zone, got.Action, got.DeferredUntil)
		}
		assertDuePlan(t, got, facts)
		if i == 0 {
			first = got
			continue
		}
		if first.TriggerAt == nil || got.TriggerAt == nil || !first.TriggerAt.Equal(*got.TriggerAt) {
			t.Fatalf("%s trigger %v, first %v", zone, got.TriggerAt, first.TriggerAt)
		}
	}
}

func TestFollowUpDueRecentResolvedAndMode(t *testing.T) {
	now := shanghaiTime(2026, time.November, 2, 16, 0)
	recent := dueReady()
	last := shanghaiTime(2026, time.November, 2, 15, 30)
	recent.RecentInteractionMinutes = 90
	recent.LastInteraction = &last
	got := DecideFollowUpDue(now, recent)
	if got.Action != postgres.FollowUpDueDefer || got.DeferredUntil == nil || !got.DeferredUntil.Equal(shanghaiTime(2026, time.November, 2, 17, 0)) {
		t.Fatalf("recent = %s until %v", got.Action, got.DeferredUntil)
	}
	assertDuePlan(t, got, recent)

	resolved := dueReady()
	resolved.TopicResolved = true
	got = DecideFollowUpDue(now, resolved)
	if got.Action != postgres.FollowUpDueLeave {
		t.Fatalf("resolved action = %s", got.Action)
	}
	assertDuePlan(t, got, resolved)

	changed := dueReady()
	changed.ConversationChanged = true
	got = DecideFollowUpDue(now, changed)
	if got.Action != postgres.FollowUpDueSilent {
		t.Fatalf("changed action = %s", got.Action)
	}
	assertDuePlan(t, got, changed)

	story := dueReady()
	story.ConversationMode = "STORY"
	got = DecideFollowUpDue(now, story)
	if got.Action != postgres.FollowUpDueSilent {
		t.Fatalf("mode action = %s", got.Action)
	}
	assertDuePlan(t, got, story)
}

func TestFollowUpDueFutureDeferredIsLeftAlone(t *testing.T) {
	facts := dueReady()
	facts.Status = "DEFERRED"
	facts.TriggerAt = nil
	until := shanghaiTime(2026, time.November, 2, 18, 0)
	facts.DeferredUntil = &until
	got := DecideFollowUpDue(shanghaiTime(2026, time.November, 2, 16, 0), facts)
	if got.Action != postgres.FollowUpDueLeave || got.DeferredUntil != nil {
		t.Fatalf("action = %s until %v", got.Action, got.DeferredUntil)
	}
	if got.EventDate == nil || *got.EventDate != "2026-11-02" || got.TriggerAt != nil {
		t.Fatalf("plan changed: %+v", got)
	}
}

func TestRunFollowUpDueIsIdempotentAndCountsThisPass(t *testing.T) {
	now := shanghaiTime(2026, time.November, 2, 16, 0)
	first := dueReady()
	first.ID = 1
	first.DailyLimit = 1
	second := dueReady()
	second.ID = 2
	second.DailyLimit = 1
	store := &memDueStore{targets: []postgres.FollowUpSyncTarget{{OwnerID: 1, RelationshipID: 10}}, rows: []postgres.FollowUpDueFacts{first, second}}
	if err := RunFollowUpDue(context.Background(), store, now); err != nil {
		t.Fatal(err)
	}
	if err := RunFollowUpDue(context.Background(), store, now); err != nil {
		t.Fatal(err)
	}
	if store.syncs != 2 || store.lists < 2 {
		t.Fatalf("syncs %d lists %d", store.syncs, store.lists)
	}
	if len(store.order) < 2 || store.order[0] != "sync" || store.order[1] != "list" {
		t.Fatalf("order %v", store.order)
	}
	if store.enqueued[1] != 1 || store.enqueued[2] != 0 {
		t.Fatalf("enqueued %+v", store.enqueued)
	}
	if store.status[1] != "SCHEDULED" || store.status[2] != postgres.FollowUpDueSilent {
		t.Fatalf("status %+v", store.status)
	}
	if store.dates[1] != "2026-11-02" || store.dates[2] != "2026-11-02" {
		t.Fatalf("dates %+v", store.dates)
	}
}

type memDueStore struct {
	targets  []postgres.FollowUpSyncTarget
	rows     []postgres.FollowUpDueFacts
	order    []string
	syncs    int
	lists    int
	enqueued map[int64]int
	status   map[int64]string
	dates    map[int64]string
	queued   map[int64]bool
}

func (m *memDueStore) ListFollowUpSyncTargets(context.Context) ([]postgres.FollowUpSyncTarget, error) {
	return append([]postgres.FollowUpSyncTarget(nil), m.targets...), nil
}

func (m *memDueStore) SyncFollowUps(context.Context, int64, int64) error {
	m.order = append(m.order, "sync")
	m.syncs++
	return nil
}

func (m *memDueStore) ListDueFollowUps(context.Context, time.Time) ([]postgres.FollowUpDueFacts, error) {
	m.order = append(m.order, "list")
	m.lists++
	if m.enqueued == nil {
		m.enqueued = map[int64]int{}
		m.status = map[int64]string{}
		m.dates = map[int64]string{}
		m.queued = map[int64]bool{}
	}
	out := make([]postgres.FollowUpDueFacts, 0, len(m.rows))
	for _, row := range m.rows {
		if m.status[row.ID] == postgres.FollowUpDueSilent {
			continue
		}
		if row.EventDate != nil {
			m.dates[row.ID] = *row.EventDate
		}
		if m.queued[row.ID] {
			row.AlreadyQueued = true
		}
		out = append(out, row)
	}
	return out, nil
}

func (m *memDueStore) ApplyFollowUpDue(_ context.Context, _, id int64, decision postgres.FollowUpDueDecision) (bool, error) {
	if m.enqueued == nil {
		m.enqueued = map[int64]int{}
		m.status = map[int64]string{}
		m.dates = map[int64]string{}
		m.queued = map[int64]bool{}
	}
	if decision.EventDate != nil {
		m.dates[id] = *decision.EventDate
	}
	switch decision.Action {
	case postgres.FollowUpDueEnqueue:
		if m.queued[id] {
			return false, nil
		}
		m.queued[id] = true
		m.enqueued[id]++
		m.status[id] = "SCHEDULED"
		return true, nil
	case postgres.FollowUpDueSilent:
		m.status[id] = postgres.FollowUpDueSilent
	case postgres.FollowUpDueDefer:
		m.status[id] = postgres.FollowUpDueDefer
	}
	return false, nil
}

func dueReady() postgres.FollowUpDueFacts {
	trigger := shanghaiTime(2026, time.November, 2, 15, 4)
	return postgres.FollowUpDueFacts{
		OwnerID:          1,
		ID:               9,
		RelationshipID:   10,
		Status:           "SCHEDULED",
		EventDate:        sp("2026-11-02"),
		EventTime:        sp("15:04"),
		EventTimezone:    sp("Asia/Shanghai"),
		TriggerAt:        &trigger,
		PolicyEnabled:    true,
		DailyLimit:       3,
		AllowedModes:     []string{"COMPANION"},
		ConversationMode: "COMPANION",
	}
}

func assertDuePlan(t *testing.T, got postgres.FollowUpDueDecision, facts postgres.FollowUpDueFacts) {
	t.Helper()
	if got.EventDate == nil || facts.EventDate == nil || *got.EventDate != *facts.EventDate {
		t.Fatalf("event date = %v", got.EventDate)
	}
	if got.EventTime == nil || facts.EventTime == nil || *got.EventTime != *facts.EventTime {
		t.Fatalf("event time = %v", got.EventTime)
	}
	if got.EventTimezone == nil || facts.EventTimezone == nil || *got.EventTimezone != *facts.EventTimezone {
		t.Fatalf("event zone = %v", got.EventTimezone)
	}
	switch {
	case facts.TriggerAt == nil && got.TriggerAt != nil:
		t.Fatalf("trigger invented %v", got.TriggerAt)
	case facts.TriggerAt != nil && (got.TriggerAt == nil || !got.TriggerAt.Equal(*facts.TriggerAt)):
		t.Fatalf("trigger = %v, want %v", got.TriggerAt, facts.TriggerAt)
	}
}

func shanghaiTime(year int, month time.Month, day, hour, minute int) time.Time {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		panic(err)
	}
	return time.Date(year, month, day, hour, minute, 0, 0, loc)
}

func sp(v string) *string { return &v }
