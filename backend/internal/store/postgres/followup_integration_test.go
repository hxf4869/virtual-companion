//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestFollowUpRetryKeepsSavedEventDateAndIsIdempotent(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	at := followSourceAt()
	mem, _ := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", at)
	if mem.Time == nil || mem.Time.EventDate == nil || *mem.Time.EventDate != "2026-11-02" {
		t.Fatalf("saved time = %+v", mem.Time)
	}
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.memory_item SET summary=$2 WHERE owner_user_id=1 AND id=$1`, mem.ID, "明天 09:00"); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	wantTrigger := time.Date(2026, 11, 2, 7, 4, 0, 0, time.UTC)
	if row.Status != "SCHEDULED" || row.EventID != fmt.Sprintf("fu-m-%d", mem.ID) || row.EventDate == nil || *row.EventDate != "2026-11-02" || row.EventTime == nil || *row.EventTime != "15:04" || row.TriggerAt == nil || !row.TriggerAt.UTC().Equal(wantTrigger) || row.ReminderRuleConfirmed {
		t.Fatalf("retry rewrote the saved event: %+v", row)
	}
	mustSync(t, b.RelationshipID)
	again := followForMemory(t, b.RelationshipID, mem.ID)
	if again.ID != row.ID || again.EventID != row.EventID || again.EventDate == nil || *again.EventDate != "2026-11-02" {
		t.Fatalf("second sync = %+v", again)
	}
	if _, err := testEnv.store.GetFollowUp(context.Background(), 2, row.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner read = %v", err)
	}
}

func TestFollowUpAmbiguousDateOnlyAndZonelessStayUntriggerable(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	at := followSourceAt()
	ambiguous, ref := publishFollowMemory(t, b, snapshots, "也许2026年11月2日 15:04去医院", at)
	dateOnly := addSTMemory(t, b, "我下周五去厦门参加朋友婚礼。", ref)
	zoneless := addSTMemory(t, b, "2026年11月2日 15:04复查", ref)
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.memory_item SET temporal_cipher=$2 WHERE owner_user_id=1 AND id=$1`, zoneless.ID, `{"recordedAt":"2026-10-20T04:00:00Z","normalizationStatus":"explicit_date","eventDate":"2026-11-02","eventTime":"15:04","eventTimezone":null,"timePrecision":"minute","reminderAt":"2026-11-02T07:04:00Z"}`); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	for _, mem := range []Memory{ambiguous, dateOnly, zoneless} {
		row := followForMemory(t, b.RelationshipID, mem.ID)
		if row.Status == "SCHEDULED" || row.TriggerAt != nil {
			t.Fatalf("memory %d became triggerable: %+v", mem.ID, row)
		}
		if row.Status != "NEEDS_CLARIFICATION" {
			t.Fatalf("memory %d status = %s", mem.ID, row.Status)
		}
	}
	dateRow := followForMemory(t, b.RelationshipID, dateOnly.ID)
	if dateRow.EventDate == nil || *dateRow.EventDate != "2026-10-30" || dateRow.TimePrecision == nil || *dateRow.TimePrecision != "date" || dateRow.ReminderRuleConfirmed {
		t.Fatalf("date-only row = %+v", dateRow)
	}
}

func TestFollowUpSourceInvalidationCancelsAndDoesNotRevive(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem, ref := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if err := enqueueFollowUp(t, row.ID); err != nil {
		t.Fatal(err)
	}
	snapshots[sourceChat].Revision = 2
	snapshots[sourceChat].Messages = nil
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	cancelled := followForMemory(t, b.RelationshipID, mem.ID)
	if cancelled.ID != row.ID || cancelled.Status != "CANCELLED" || cancelled.TriggerAt != nil || cancelled.EventID != row.EventID {
		t.Fatalf("invalidated follow-up = %+v", cancelled)
	}
	if followJobStatus(t, row.ID) != "CANCELLED" {
		t.Fatal("follow-up job was not cancelled")
	}
	mustSync(t, b.RelationshipID)
	if again := followForMemory(t, b.RelationshipID, mem.ID); again.Status != "CANCELLED" || again.TriggerAt != nil || again.ID != row.ID {
		t.Fatalf("sync revived the follow-up: %+v", again)
	}
	if got := lateScheduleFollowUp(t, b.RelationshipID, mem.ID, ref, 1); got != row.ID {
		t.Fatalf("late insert id = %d, want %d", got, row.ID)
	}
	if again := followForMemory(t, b.RelationshipID, mem.ID); again.Status != "CANCELLED" || again.TriggerAt != nil || again.EventDate == nil || *again.EventDate != "2026-11-02" {
		t.Fatalf("late insert revived the follow-up: %+v", again)
	}
	if err := enqueueFollowUp(t, row.ID); err == nil || !errors.Is(mapFollowUpErr(err), ErrInvalid) {
		t.Fatalf("enqueue after cancel = %v", err)
	}
}

func TestFollowUpForgetCancelsAndDoesNotRevive(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem, ref := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	if err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.delete_memory($1,$2)`, 1, mem.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	mustSync(t, b.RelationshipID)
	again := followForMemory(t, b.RelationshipID, mem.ID)
	if again.ID != row.ID || again.Status != "CANCELLED" || again.TriggerAt != nil {
		t.Fatalf("forgotten follow-up = %+v", again)
	}
	if got := lateScheduleFollowUp(t, b.RelationshipID, mem.ID, ref, 1); got != row.ID {
		t.Fatalf("late insert id = %d", got)
	}
	if final := followForMemory(t, b.RelationshipID, mem.ID); final.Status != "CANCELLED" || final.TriggerAt != nil {
		t.Fatalf("late insert revived a forgotten follow-up: %+v", final)
	}
}

func TestFollowUpSupersedeAndRevisionCancelTheOldFollowUp(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	oldMem, ref := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	oldRow := followForMemory(t, b.RelationshipID, oldMem.ID)
	next, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: b.RelationshipID, ConversationID: &b.ConversationID, Scope: "RELATIONSHIP", Summary: "2026年12月1日 09:00改期复查", Evidence: []string{ref}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.ConfirmMemory(ctx, 1, next.ID, &oldMem.ID); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	cancelled := followForMemory(t, b.RelationshipID, oldMem.ID)
	moved := followForMemory(t, b.RelationshipID, next.ID)
	if cancelled.Status != "CANCELLED" || cancelled.TriggerAt != nil || cancelled.ID != oldRow.ID {
		t.Fatalf("superseded follow-up = %+v", cancelled)
	}
	if moved.Status != "SCHEDULED" || moved.EventID == cancelled.EventID || moved.EventDate == nil || *moved.EventDate != "2026-12-01" || moved.EventTime == nil || *moved.EventTime != "09:00" {
		t.Fatalf("replacement follow-up = %+v", moved)
	}
	mustSync(t, b.RelationshipID)
	if again := followForMemory(t, b.RelationshipID, oldMem.ID); again.Status != "CANCELLED" || again.ID != oldRow.ID {
		t.Fatalf("superseded follow-up revived: %+v", again)
	}

	snapshots[sourceChat].Messages[0].Revision = 2
	snapshots[sourceChat].Revision = 2
	if _, err := testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	if revised := followForMemory(t, b.RelationshipID, next.ID); revised.Status != "CANCELLED" || revised.TriggerAt != nil || revised.ID != moved.ID {
		t.Fatalf("revised source revived or replaced the row: %+v", revised)
	}
	ref2 := refForChat(t, sourceChat)
	if ref2 == ref {
		t.Fatal("message revision kept the old source ref")
	}
	fresh := addSTMemory(t, b, "2026年12月2日 10:30另约复查", ref2)
	mustSync(t, b.RelationshipID)
	freshRow := followForMemory(t, b.RelationshipID, fresh.ID)
	if freshRow.Status != "SCHEDULED" || freshRow.EventID == moved.EventID || freshRow.EventDate == nil || *freshRow.EventDate != "2026-12-02" {
		t.Fatalf("new revision follow-up = %+v", freshRow)
	}
	if again := followForMemory(t, b.RelationshipID, next.ID); again.Status != "CANCELLED" || again.TriggerAt != nil {
		t.Fatalf("old revision revived: %+v", again)
	}
}

func TestFollowUpOutcomeCancelsAndDoesNotRevive(t *testing.T) {
	b, snapshots := stMemoryFixture(t)
	mem, _ := publishFollowMemory(t, b, snapshots, "2026年11月2日 15:04复查", followSourceAt())
	mustSync(t, b.RelationshipID)
	row := followForMemory(t, b.RelationshipID, mem.ID)
	appendFollowMessage(snapshots[sourceChat], "20000000-0000-0000-0000-0000000000a2", "30000000-0000-0000-0000-0000000000a2", "我觉得已经完成了")
	appendFollowMessage(snapshots[sourceChat], "20000000-0000-0000-0000-0000000000a3", "30000000-0000-0000-0000-0000000000a3", "已经有结果了吗")
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	if kept := followForMemory(t, b.RelationshipID, mem.ID); kept.ID != row.ID || kept.Status != "SCHEDULED" || kept.TriggerAt == nil {
		t.Fatalf("near miss cancelled the follow-up: %+v", kept)
	}
	outcomeID := "20000000-0000-0000-0000-0000000000a4"
	appendFollowMessage(snapshots[sourceChat], outcomeID, "30000000-0000-0000-0000-0000000000a4", "已经有结果了")
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	cancelled := followForMemory(t, b.RelationshipID, mem.ID)
	if cancelled.ID != row.ID || cancelled.Status != "CANCELLED" || cancelled.TriggerAt != nil {
		t.Fatalf("outcome did not cancel: %+v", cancelled)
	}
	dropFollowMessage(snapshots[sourceChat], outcomeID)
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	mustSync(t, b.RelationshipID)
	if again := followForMemory(t, b.RelationshipID, mem.ID); again.ID != row.ID || again.Status != "CANCELLED" || again.TriggerAt != nil {
		t.Fatalf("removing the outcome revived the follow-up: %+v", again)
	}
}

func TestProactivePolicyDefaultsOffAndRoundTrips(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	got, err := testEnv.store.GetProactivePolicy(ctx, 1, 10)
	if err != nil || got.Enabled || got.OfflineCapable || got.DailyLimit != 0 || got.RecentInteractionMinutes != 0 || len(got.AllowedModes) != 1 || got.AllowedModes[0] != "COMPANION" || got.QuietHoursStart != nil {
		t.Fatalf("default policy = %+v err=%v", got, err)
	}
	start, end, zone := "22:00", "08:00", "Asia/Shanghai"
	stored, err := testEnv.store.PutProactivePolicy(ctx, 1, 10, ProactivePolicyWrite{
		Enabled: true, QuietHoursStart: &start, QuietHoursEnd: &end, QuietHoursTimezone: &zone,
		DailyLimit: 3, RecentInteractionMinutes: 120, AllowedModes: []string{"COMPANION"}, OfflineCapable: false,
	})
	if err != nil || !stored.Enabled || stored.OfflineCapable || stored.DailyLimit != 3 || stored.QuietHoursStart == nil || *stored.QuietHoursStart != "22:00" {
		t.Fatalf("stored policy = %+v err=%v", stored, err)
	}
	if _, err := testEnv.store.GetProactivePolicy(ctx, 2, 10); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other owner policy = %v", err)
	}
	if _, err := testEnv.store.ListFollowUps(ctx, 1, 20); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other relationship list = %v", err)
	}
	rows, err := testEnv.store.ListFollowUps(ctx, 1, 10)
	if err != nil || len(rows) != 0 {
		t.Fatalf("empty list = %+v err=%v", rows, err)
	}
}

func followSourceAt() time.Time {
	at, err := time.Parse(time.RFC3339, "2026-10-20T20:00:00+08:00")
	if err != nil {
		panic(err)
	}
	return at
}

func publishFollowMemory(t *testing.T, b STBinding, snapshots map[string]*stsource.Snapshot, summary string, at time.Time) (Memory, string) {
	t.Helper()
	if _, ok := snapshots[sourceChat]; !ok {
		snapshots[sourceChat] = stMemorySnapshot(sourceChat, summary, at)
	}
	if _, err := testEnv.store.ReconcileSTSources(context.Background(), 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	ref := refForChat(t, sourceChat)
	return addSTMemory(t, b, summary, ref), ref
}

func mustSync(t *testing.T, relationshipID int64) {
	t.Helper()
	if err := testEnv.store.SyncFollowUps(context.Background(), 1, relationshipID); err != nil {
		t.Fatal(err)
	}
}

func followForMemory(t *testing.T, relationshipID, memoryID int64) FollowUp {
	t.Helper()
	rows, err := testEnv.store.ListFollowUps(context.Background(), 1, relationshipID)
	if err != nil {
		t.Fatal(err)
	}
	var found []FollowUp
	for _, row := range rows {
		if row.MemoryItemID != nil && *row.MemoryItemID == memoryID {
			found = append(found, row)
		}
	}
	if len(found) != 1 {
		t.Fatalf("memory %d has %d follow-ups", memoryID, len(found))
	}
	return found[0]
}

func enqueueFollowUp(t *testing.T, id int64) error {
	t.Helper()
	return testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		var job int64
		return tx.QueryRow(ctx, `SELECT vc.enqueue_follow_up($1,$2)`, 1, id).Scan(&job)
	})
}

func lateScheduleFollowUp(t *testing.T, relationshipID, memoryID int64, ref string, revision int64) int64 {
	t.Helper()
	var id int64
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.insert_follow_up($1,$2,$3,$4,$5,'late','SCHEDULED','explicit_date','minute',false,DATE '2026-12-01','09:00','Asia/Shanghai',timestamptz '2026-12-01 09:00:00+08')`,
			1, relationshipID, memoryID, ref, revision).Scan(&id)
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func followJobStatus(t *testing.T, followID int64) string {
	t.Helper()
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	var status string
	if err := conn.QueryRow(ctx, `SELECT status FROM vc.work_item WHERE owner_user_id=1 AND kind='FOLLOW_UP' AND ref_id=$1 ORDER BY id DESC LIMIT 1`, followID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	return status
}

func appendFollowMessage(snap *stsource.Snapshot, messageID, candidateID, text string) {
	snap.Revision++
	snap.Messages = append(snap.Messages, stsource.Message{
		MessageID: messageID, CandidateID: candidateID, Revision: 1, Role: "user", Text: text, Eligible: true, Settled: true,
	})
}

func dropFollowMessage(snap *stsource.Snapshot, messageID string) {
	snap.Revision++
	kept := make([]stsource.Message, 0, len(snap.Messages))
	for _, msg := range snap.Messages {
		if msg.MessageID != messageID {
			kept = append(kept, msg)
		}
	}
	snap.Messages = kept
}
