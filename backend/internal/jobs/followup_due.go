package jobs

import (
	"context"
	"errors"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var errFollowUpStore = errors.New("follow-up store is unavailable")

// followUpDueStore is the scheduler's view of follow-up sync and due writes.
// Claim-loop fakes do not implement it, so maintenance stays off that path.
type followUpDueStore interface {
	ListFollowUpSyncTargets(context.Context) ([]postgres.FollowUpSyncTarget, error)
	SyncFollowUps(context.Context, int64, int64) error
	ListDueFollowUps(context.Context, time.Time) ([]postgres.FollowUpDueFacts, error)
	ApplyFollowUpDue(context.Context, int64, int64, postgres.FollowUpDueDecision) (bool, error)
}

// DecideFollowUpDue chooses leave, defer, silent, or enqueue for one due row.
// The returned event date, clock, timezone, and trigger are the stored plan.
func DecideFollowUpDue(now time.Time, in postgres.FollowUpDueFacts) postgres.FollowUpDueDecision {
	return postgres.DecideFollowUpDue(now, in)
}

// RunFollowUpDue syncs published memories, then applies one due decision per row.
// A follow-up enqueued earlier in the same pass counts toward that character's
// daily limit. Sync failures skip only that character's due rows.
func RunFollowUpDue(ctx context.Context, store followUpDueStore, now time.Time) error {
	if store == nil {
		return errFollowUpStore
	}
	if now.IsZero() {
		now = time.Now()
	}
	targets, err := store.ListFollowUpSyncTargets(ctx)
	if err != nil {
		return err
	}
	skipped := map[[2]int64]bool{}
	var syncErr error
	for _, target := range targets {
		if err := store.SyncFollowUps(ctx, target.OwnerID, target.RelationshipID); err != nil {
			skipped[[2]int64{target.OwnerID, target.RelationshipID}] = true
			if syncErr == nil {
				syncErr = err
			}
		}
	}
	rows, err := store.ListDueFollowUps(ctx, now)
	if err != nil {
		return err
	}
	extra := map[[2]int64]int{}
	var applyErr error
	for _, row := range rows {
		key := [2]int64{row.OwnerID, row.RelationshipID}
		if skipped[key] {
			continue
		}
		row.SentToday += extra[key]
		decision := DecideFollowUpDue(now, row)
		created, err := store.ApplyFollowUpDue(ctx, row.OwnerID, row.ID, decision)
		if err != nil {
			if applyErr == nil {
				applyErr = err
			}
			continue
		}
		if decision.Action == postgres.FollowUpDueEnqueue && created {
			extra[key]++
		}
	}
	if syncErr != nil {
		return syncErr
	}
	return applyErr
}
