package jobs

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/datarights"
)

type accountDeletionRecoveryStore interface {
	datarights.DeletionStore
	ListPendingAccountDeletions(context.Context) ([]int64, error)
}

func (l *Loop) recoverAccountDeletions(ctx context.Context) error {
	store, ok := l.store.(accountDeletionRecoveryStore)
	if !ok {
		return nil
	}
	owners, err := store.ListPendingAccountDeletions(ctx)
	if err != nil {
		return err
	}
	var deleteObject func(context.Context, string) error
	if l.blobs != nil {
		deleteObject = l.blobs.Delete
	}
	for _, owner := range owners {
		l.cancels.CancelOwner(owner)
		// A missing external store keeps the durable intent pending. The next
		// normal recovery pass retries; no user content is logged here.
		if _, err := datarights.ContinueDeletion(ctx, owner, store, deleteObject); err != nil {
			return err
		}
	}
	return nil
}
