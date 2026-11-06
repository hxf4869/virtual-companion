//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestListActiveRemindersSkipsHistoryAndOrdersSoonest(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	if err := IsolationSuperExec(ctx, `
		INSERT INTO vc.reminder(owner_user_id, id, relationship_id, text, remind_at, status)
		SELECT 1, nextval('vc.reminder_id_seq'), 10, 'synthetic dismissed reminder', now(), 'DISMISSED'
		FROM generate_series(1, 105)`); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	var later []Reminder
	for i := 105; i > 0; i-- {
		r, err := store.CreateReminder(ctx, 1, 10, "synthetic active reminder", now.Add(time.Duration(i)*time.Minute), "NONE")
		if err != nil {
			t.Fatal(err)
		}
		later = append(later, r)
	}
	var want []Reminder
	for range 2 {
		r, err := store.CreateReminder(ctx, 1, 10, "synthetic tied reminder", now, "NONE")
		if err != nil {
			t.Fatal(err)
		}
		want = append(want, r)
	}
	for i := len(later) - 1; i >= 0; i-- {
		want = append(want, later[i])
	}
	other, err := store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range [][2]int64{{1, other.ID}, {2, 20}} {
		if _, err := store.CreateReminder(ctx, scope[0], scope[1], "synthetic other reminder", now.Add(-time.Hour), "NONE"); err != nil {
			t.Fatal(err)
		}
	}
	for _, limit := range []int{1, 3, 100} {
		got, err := store.ListActiveReminders(ctx, 1, 10, limit)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != limit {
			t.Fatalf("limit %d: got %d active reminders", limit, len(got))
		}
		for i, r := range got {
			if r.ID != want[i].ID || !r.RemindAt.Equal(want[i].RemindAt) || r.Status != "ACTIVE" || r.RelationshipID != 10 {
				t.Fatalf("limit %d index %d: id=%d status=%s relationship=%d, want id=%d", limit, i, r.ID, r.Status, r.RelationshipID, want[i].ID)
			}
		}
	}
	if _, err := store.ListActiveReminders(ctx, 2, 10, 10); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign relationship: %v", err)
	}
}

func TestReminderAttemptCooldownSerializesConcurrentPasses(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	r, err := store.CreateReminder(ctx, 1, 10, "synthetic reminder", now, "NONE")
	if err != nil {
		t.Fatal(err)
	}
	type result struct {
		started bool
		err     error
	}
	start := make(chan struct{})
	results := make(chan result, 8)
	for range cap(results) {
		go func() {
			<-start
			started, err := store.BeginReminderAttempt(ctx, 1, 10, r.ID, now)
			results <- result{started, err}
		}()
	}
	close(start)
	attempts := 0
	for range cap(results) {
		got := <-results
		if got.err != nil {
			t.Errorf("begin attempt: %v", got.err)
		}
		if got.started {
			attempts++
		}
	}
	if attempts != 1 {
		t.Fatalf("concurrent attempts=%d, want 1", attempts)
	}
	for _, elapsed := range []time.Duration{30 * time.Second, 10*time.Minute - time.Second, 10 * time.Minute} {
		started, err := store.BeginReminderAttempt(ctx, 1, 10, r.ID, now.Add(elapsed))
		if err != nil || started != (elapsed == 10*time.Minute) {
			t.Fatalf("attempt at %s: started=%v err=%v", elapsed, started, err)
		}
	}
}

func TestReminderPathsPruneOnlyExpiredReminderCooldowns(t *testing.T) {
	for _, path := range []string{"next", "attempt"} {
		t.Run(path, func(t *testing.T) {
			resetFixtures(t)
			ctx := context.Background()
			store := testEnv.store
			now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
			if err := IsolationSuperExec(ctx, `
				INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active)
				VALUES (1,11,'synthetic',true)`); err != nil {
				t.Fatal(err)
			}
			if err := IsolationSuperExec(ctx, `
				INSERT INTO vc.proactive_cooldown(owner_user_id,relationship_id,cooldown_key,until_at)
				VALUES (1,10,'reminder:expired',$1::timestamptz-interval '1 second'),
				       (1,10,'reminder:boundary',$1),
				       (1,10,'reminder:future',$1::timestamptz+interval '1 second'),
				       (1,10,'diary:attempt',$1::timestamptz-interval '1 hour'),
				       (1,10,'reminderish:expired',$1::timestamptz-interval '1 hour'),
				       (1,11,'reminder:expired',$1),
				       (2,20,'reminder:expired',$1)`, now); err != nil {
				t.Fatal(err)
			}
			want := map[string]time.Time{
				"reminder:future":     now.Add(time.Second),
				"diary:attempt":       now.Add(-time.Hour),
				"reminderish:expired": now.Add(-time.Hour),
			}
			if path == "next" {
				if due, err := store.NextDueReminder(ctx, 1, 10, now); err != nil || due != nil {
					t.Fatalf("no due reminder: present=%v err=%v", due != nil, err)
				}
			} else {
				r, err := store.CreateReminder(ctx, 1, 10, "synthetic reminder", now, "NONE")
				if err != nil {
					t.Fatal(err)
				}
				if started, err := store.BeginReminderAttempt(ctx, 1, 10, r.ID, now); err != nil || !started {
					t.Fatalf("begin reminder: started=%v err=%v", started, err)
				}
				want[reminderCooldownKey(r.ID)] = now.Add(10 * time.Minute)
			}
			for _, scope := range []struct {
				owner, relationship int64
				want                map[string]time.Time
			}{
				{1, 10, want},
				{1, 11, map[string]time.Time{"reminder:expired": now}},
				{2, 20, map[string]time.Time{"reminder:expired": now}},
			} {
				var got map[string]time.Time
				if err := store.WithOwner(ctx, scope.owner, func(ctx context.Context, tx pgx.Tx) error {
					var err error
					got, err = loadCooldownsTx(ctx, tx, scope.owner, scope.relationship)
					return err
				}); err != nil {
					t.Fatal(err)
				}
				if len(got) != len(scope.want) {
					t.Fatalf("relationship %d cooldown count=%d, want %d", scope.relationship, len(got), len(scope.want))
				}
				for key, until := range scope.want {
					if !got[key].Equal(until) {
						t.Errorf("relationship %d cooldown %s changed", scope.relationship, key)
					}
				}
			}
		})
	}
}

func TestFavoritesAndDiaryAreExportedAndClearedWithTheRelationship(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	installRightsEngine(t, testEnv.store)
	if _, err := testEnv.store.CreateFavorite(ctx, 1, 10, FavoriteWrite{ChatFile: "a.jsonl", MesID: 2, Role: "character", Body: "晚安"}); err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.SaveDiaryEntry(ctx, 1, 10, "2026-11-02", "今天很安静。", "开心", []string{"晚霞"}); err != nil {
		t.Fatal(err)
	}
	exported, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if goArrayLen(exported.Go["favorites"]) != 1 || goArrayLen(exported.Go["diaryEntries"]) != 1 {
		t.Fatalf("export go domain = favorites %d, diary %d", goArrayLen(exported.Go["favorites"]), goArrayLen(exported.Go["diaryEntries"]))
	}
	if _, err := testEnv.store.ResetRelationship(ctx, 1, 10, false); err != nil {
		t.Fatal(err)
	}
	after, err := testEnv.store.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if goArrayLen(after.Go["favorites"]) != 0 || goArrayLen(after.Go["diaryEntries"]) != 0 {
		t.Fatal("relationship reset left favorites or diary pages")
	}
}
