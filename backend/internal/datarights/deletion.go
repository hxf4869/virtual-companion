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
	if err := store.DeleteAccount(ctx, owner); err != nil {
		return pending("GO"), err
	}
	return DeletionProgress{Status: "COMPLETED"}, nil
}
