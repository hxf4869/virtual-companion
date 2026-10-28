//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestFollowUpDueQuietHoursDoesNotEnqueue(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	start, end, zone := "13:00", "18:00", "Asia/Shanghai"
	enableDuePolicy(t, b.RelationshipID, &start, &end, &zone, 3, 0)
	now := dueShanghai(2026, time.November, 2, 16, 0)
	runFollowUpDue(t, now)
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	want := dueShanghai(2026, time.November, 2, 18, 0)
	if got.status != "DEFERRED" || got.jobs != 0 || got.trigger != nil || got.deferred == nil || !got.deferred.Equal(want) {
		t.Fatalf("quiet row = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
	if got.greeting != nil {
		t.Fatal("quiet hours stored a greeting")
	}
}

func TestFollowUpDueQuietHoursCrossMidnight(t *testing.T) {
	cases := []struct {
		name string
		now  time.Time
		want time.Time
	}{
		{
			name: "evening",
			now:  dueShanghai(2026, time.November, 2, 23, 30),
			want: dueShanghai(2026, time.November, 3, 7, 0),
		},
		{
			name: "after midnight",
			now:  dueShanghai(2026, time.November, 3, 2, 15),
			want: dueShanghai(2026, time.November, 3, 7, 0),
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, snapshots := stMemoryFixture(t)
			mem := publishDueMemory(t, b, snapshots)
			start, end, zone := "22:00", "07:00", "Asia/Shanghai"
			enableDuePolicy(t, b.RelationshipID, &start, &end, &zone, 3, 0)
			runFollowUpDue(t, tc.now)
			got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
			if got.status != "DEFERRED" || got.jobs != 0 || got.trigger != nil || got.deferred == nil || !got.deferred.Equal(tc.want) {
				t.Fatalf("cross-midnight row = %+v, want %s", got, tc.want)
			}
			assertDueEvent(t, got, "2026-11-02", "15:04")
		})
	}
}

func TestFollowUpDueDailyLimitSilencesTheRest(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	first, second := publishDuePair(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 1, 0)
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 17, 0))
	early := readDue(t, followForMemory(t, b.RelationshipID, first.ID).ID)
	late := readDue(t, followForMemory(t, b.RelationshipID, second.ID).ID)
	if early.status != "SCHEDULED" || early.jobs != 1 || early.trigger == nil || !early.trigger.Equal(dueInstant(15, 4)) {
		t.Fatalf("first = %+v", early)
	}
	if late.status != "SILENT" || late.jobs != 0 || late.trigger != nil || late.deferred != nil || late.greeting != nil {
		t.Fatalf("second = %+v", late)
	}
	assertDueEvent(t, early, "2026-11-02", "15:04")
	assertDueEvent(t, late, "2026-11-02", "16:04")
}

func TestFollowUpDueAskedDoesNotEnqueue(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 10, 0))
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.follow_up SET status='ASKED', trigger_at=NULL WHERE owner_user_id=1 AND id=$1`, row.ID); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	got := readDue(t, row.ID)
	if got.status != "ASKED" || got.jobs != 0 || got.trigger != nil {
		t.Fatalf("asked row = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDuePolicyOffDoesNotEnqueue(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	start, end, zone := "13:00", "18:00", "Asia/Shanghai"
	if _, err := testEnv.store.PutProactivePolicy(context.Background(), 1, b.RelationshipID, ProactivePolicyWrite{
		Enabled: false, QuietHoursStart: &start, QuietHoursEnd: &end, QuietHoursTimezone: &zone,
		DailyLimit: 3, AllowedModes: []string{"COMPANION"},
	}); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	if got.status != "SCHEDULED" || got.jobs != 0 || got.deferred != nil || got.trigger == nil || !got.trigger.Equal(dueInstant(15, 4)) {
		t.Fatalf("closed policy = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueServerZoneKeepsStoredPlan(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	orig := time.Local
	loc, err := time.LoadLocation("Pacific/Kiritimati")
	if err != nil {
		t.Fatal(err)
	}
	time.Local = loc
	t.Cleanup(func() { time.Local = orig })
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	if got.status != "SCHEDULED" || got.jobs != 1 || got.trigger == nil || !got.trigger.Equal(dueInstant(15, 4)) || got.deferred != nil {
		t.Fatalf("zoned plan = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueRepeatedPassIsIdempotent(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	now := dueShanghai(2026, time.November, 2, 16, 0)
	runFollowUpDue(t, now)
	runFollowUpDue(t, now)
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	if got.status != "SCHEDULED" || got.jobs != 1 || got.greeting != nil {
		t.Fatalf("repeat = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueRecentInteractionDefers(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 90)
	now := dueShanghai(2026, time.November, 2, 16, 0)
	last := now.Add(-30 * time.Minute)
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.st_message_source SET source_timestamp=$1 WHERE owner_user_id=1 AND role='user'`, last); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, now)
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	want := last.Add(90 * time.Minute)
	if got.status != "DEFERRED" || got.jobs != 0 || got.deferred == nil || !got.deferred.Equal(want) || got.trigger != nil {
		t.Fatalf("recent = %+v, want %s", got, want)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueResolvedTopicCancelsWithoutJob(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 10, 0))
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if row.Status != "SCHEDULED" {
		t.Fatalf("early pass = %+v", row)
	}
	appendFollowMessage(snapshots[sourceChat], "20000000-0000-0000-0000-0000000000d1", "30000000-0000-0000-0000-0000000000d1", "已经有结果了")
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	got := readDue(t, row.ID)
	if got.status != "CANCELLED" || got.jobs != 0 || got.trigger != nil {
		t.Fatalf("resolved = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueStoryModeStaysSilent(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.conversation SET st_mode='STORY' WHERE owner_user_id=1 AND id=$1`, b.ConversationID); err != nil {
		t.Fatal(err)
	}
	runFollowUpDue(t, dueShanghai(2026, time.November, 2, 16, 0))
	got := readDue(t, followForMemory(t, b.RelationshipID, mem.ID).ID)
	if got.status != "SILENT" || got.jobs != 0 || got.trigger != nil || got.greeting != nil {
		t.Fatalf("story mode = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func TestFollowUpDueChangedSourceStaysSilent(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem := publishDueMemory(t, b, snapshots)
	enableDuePolicy(t, b.RelationshipID, nil, nil, nil, 3, 0)
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.st_message_source SET eligible=false WHERE owner_user_id=1`); err != nil {
		t.Fatal(err)
	}
	now := dueShanghai(2026, time.November, 2, 16, 0)
	listed, err := testEnv.store.ListDueFollowUps(context.Background(), now)
	if err != nil {
		t.Fatal(err)
	}
	var facts *FollowUpDueFacts
	for i := range listed {
		if listed[i].ID == row.ID {
			facts = &listed[i]
			break
		}
	}
	if facts == nil || !facts.ConversationChanged {
		t.Fatalf("listed = %+v", listed)
	}
	decision := DecideFollowUpDue(now, *facts)
	if decision.Action != FollowUpDueSilent || decision.EventDate == nil || *decision.EventDate != "2026-11-02" {
		t.Fatalf("decision = %+v", decision)
	}
	if _, err := testEnv.store.ApplyFollowUpDue(context.Background(), 1, row.ID, decision); err != nil {
		t.Fatal(err)
	}
	got := readDue(t, row.ID)
	if got.status != "SILENT" || got.jobs != 0 || got.trigger != nil {
		t.Fatalf("changed source = %+v", got)
	}
	assertDueEvent(t, got, "2026-11-02", "15:04")
}

func publishDueMemory(t *testing.T, b STBinding, snapshots map[string]*stsource.Snapshot) Memory {
	t.Helper()
	mem, _ := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	return mem
}

func publishDuePair(t *testing.T, b STBinding, snapshots map[string]*stsource.Snapshot) (Memory, Memory) {
	t.Helper()
	at := followSourceAt()
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "2026年11月2日 15:04复查", at)
	snapshots[sourceChat].Revision++
	snapshots[sourceChat].Messages = append(snapshots[sourceChat].Messages, stsource.Message{
		MessageID: "20000000-0000-0000-0000-0000000000b1", CandidateID: "30000000-0000-0000-0000-0000000000b1",
		Revision: 1, Role: "user", Text: "2026年11月2日 16:04复查", Eligible: true, Settled: true,
		SourceTimestamp: &at, SourceTimezone: "Asia/Shanghai",
	})
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	refs := followSourceRefs(t)
	if len(refs) != 2 {
		t.Fatalf("source refs = %v", refs)
	}
	return addSTMemory(t, b, "2026年11月2日 15:04复查", refs[0]), addSTMemory(t, b, "2026年11月2日 16:04复查", refs[1])
}

func followSourceRefs(t *testing.T) []string {
	t.Helper()
	var refs []string
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT s.source_ref
			  FROM vc.st_message_source s
			  JOIN vc.conversation c ON (c.owner_user_id, c.id) = (s.owner_user_id, s.conversation_id)
			 WHERE s.owner_user_id = 1 AND c.st_chat_identity = $1 AND s.present
			 ORDER BY s.source_position, s.id`, sourceChat)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var ref string
			if err := rows.Scan(&ref); err != nil {
				return err
			}
			refs = append(refs, ref)
		}
		return rows.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	return refs
}

func enableDuePolicy(t *testing.T, relationship int64, start, end, zone *string, limit, recent int) {
	t.Helper()
	_, err := testEnv.store.PutProactivePolicy(context.Background(), 1, relationship, ProactivePolicyWrite{
		Enabled: true, QuietHoursStart: start, QuietHoursEnd: end, QuietHoursTimezone: zone,
		DailyLimit: limit, RecentInteractionMinutes: recent, AllowedModes: []string{"COMPANION"},
	})
	if err != nil {
		t.Fatal(err)
	}
}

// runFollowUpDue mirrors jobs.RunFollowUpDue against the real store. The jobs
// package cannot be imported from this package.
func runFollowUpDue(t *testing.T, now time.Time) {
	t.Helper()
	ctx := context.Background()
	store := testEnv.store
	targets, err := store.ListFollowUpSyncTargets(ctx)
	if err != nil {
		t.Fatal(err)
	}
	skipped := map[[2]int64]bool{}
	for _, target := range targets {
		if err := store.SyncFollowUps(ctx, target.OwnerID, target.RelationshipID); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := store.ListDueFollowUps(ctx, now)
	if err != nil {
		t.Fatal(err)
	}
	extra := map[[2]int64]int{}
	for _, row := range rows {
		key := [2]int64{row.OwnerID, row.RelationshipID}
		if skipped[key] {
			continue
		}
		row.SentToday += extra[key]
		decision := DecideFollowUpDue(now, row)
		created, err := store.ApplyFollowUpDue(ctx, row.OwnerID, row.ID, decision)
		if err != nil {
			t.Fatal(err)
		}
		if decision.Action == FollowUpDueEnqueue && created {
			extra[key]++
		}
	}
}

type dueRow struct {
	status   string
	date     string
	clock    string
	zone     string
	trigger  *time.Time
	deferred *time.Time
	greeting *string
	jobs     int
}

func readDue(t *testing.T, id int64) dueRow {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var got dueRow
	var date, clock, zone *string
	err = conn.QueryRow(ctx, `
		SELECT f.status, to_char(f.event_date, 'YYYY-MM-DD'), f.event_time, f.event_timezone,
		       f.trigger_at, f.deferred_until, f.greeting_body,
		       (SELECT count(*)::int FROM vc.work_item w
		         WHERE w.owner_user_id = f.owner_user_id AND w.kind = 'FOLLOW_UP'
		           AND w.ref_id = f.id AND w.status <> 'CANCELLED')
		  FROM vc.follow_up f
		 WHERE f.owner_user_id = 1 AND f.id = $1`, id).Scan(
		&got.status, &date, &clock, &zone, &got.trigger, &got.deferred, &got.greeting, &got.jobs)
	if err != nil {
		t.Fatal(err)
	}
	if date != nil {
		got.date = *date
	}
	if clock != nil {
		got.clock = *clock
	}
	if zone != nil {
		got.zone = *zone
	}
	return got
}

func assertDueEvent(t *testing.T, got dueRow, date, clock string) {
	t.Helper()
	if got.date != date || got.clock != clock || got.zone != "Asia/Shanghai" {
		t.Fatalf("event = %s %s %s", got.date, got.clock, got.zone)
	}
}

func dueShanghai(year int, month time.Month, day, hour, minute int) time.Time {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		panic(err)
	}
	return time.Date(year, month, day, hour, minute, 0, 0, loc)
}

func dueInstant(hour, minute int) time.Time {
	return dueShanghai(2026, time.November, 2, hour, minute).UTC()
}
