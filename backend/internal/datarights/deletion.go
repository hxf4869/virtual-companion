// Package datarights coordinates the existing deletion intent across online
// stores. Both the initiating HTTP request and restart recovery use this path.
package datarights

import (
	"context"
	"errors"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var ErrObjectUnavailable = errors.New("export object cleanup is pending")

type DeletionProgress struct {
	Status         string   `json:"status"`
	PendingDomains []string `json:"pendingDomains,omitempty"`
}
type DeletionStore interface {
	ClearSTAccountData(context.Context, int64) (bool, error)
	ClearMemoryCoreAccountData(context.Context, int64) (bool, error)
	ListOwnerExportObjects(context.Context, int64) ([]postgres.ExportObject, error)
	ClearExportObject(context.Context, int64, int64, string) error
	DeleteAccount(context.Context, int64) error
}

func ContinueDeletion(ctx context.Context, owner int64, store DeletionStore, deleteObject func(context.Context, string) error) (DeletionProgress, error) {
	pending := func(domain string) DeletionProgress {
		return DeletionProgress{Status: "PENDING", PendingDomains: []string{domain}}
	}
	done, err := store.ClearSTAccountData(ctx, owner)
	if err != nil || !done {
		return pending("ST"), err
	}
	done, err = store.ClearMemoryCoreAccountData(ctx, owner)
	if err != nil || !done {
		return pending("MEMORYCORE"), err
	}
	for {
		objects, err := store.ListOwnerExportObjects(ctx, owner)
		if err != nil {
			return pending("EXPORT_OBJECTS"), err
		}
		if len(objects) == 0 {
			break
		}
		if deleteObject == nil {
			return pending("EXPORT_OBJECTS"), ErrObjectUnavailable
		}
		for _, object := range objects {
			if err := deleteObject(ctx, object.ObjectKey); err != nil {
				return pending("EXPORT_OBJECTS"), ErrObjectUnavailable
			}
			if err := store.ClearExportObject(ctx, owner, object.ExportID, object.ObjectKey); err != nil {
				return pending("EXPORT_OBJECTS"), err
			}
		}
	}
	// Deliveries reference inbox rows. Clear notification first, and only
	// while the deletion intent is active. Until that step the rows stay
	// pending. A store that has no inbox domain skips these two names.
	if domains, ok := store.(interface {
		ClearNotificationDomain(context.Context, int64) (bool, error)
		ClearInboxDomain(context.Context, int64) (bool, error)
	}); ok {
		done, err := domains.ClearNotificationDomain(ctx, owner)
		if err != nil || !done {
			return pending("NOTIFICATION"), err
		}
		done, err = domains.ClearInboxDomain(ctx, owner)
		if err != nil || !done {
			return pending("INBOX"), err
		}
	}
	if voices, ok := store.(interface {
		ClearVoiceAccountData(context.Context, int64) (bool, error)
	}); ok {
		done, err := voices.ClearVoiceAccountData(ctx, owner)
		if err != nil || !done {
			return pending("VOICE"), err
		}
	}
	if err := store.DeleteAccount(ctx, owner); err != nil {
		return pending("GO"), err
	}
	return DeletionProgress{Status: "COMPLETED"}, nil
}
