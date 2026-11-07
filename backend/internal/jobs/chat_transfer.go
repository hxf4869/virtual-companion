package jobs

import (
	"context"
	"log/slog"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type chatImportStore interface {
	PendingChatImports(context.Context, int) ([]postgres.ChatImportWork, error)
	ProcessChatImport(context.Context, int64, string, chattransfer.Objects) error
}

// ClaimChatImportOnce uses the retained worker loop. The store claims its own
// durable fenced lease before doing any work, so another worker or a crashed
// predecessor cannot publish a second chat. One local slot bounds preparation
// memory independently of model extraction and never blocks its claim mutex.
func (l *Loop) ClaimChatImportOnce(ctx context.Context) int {
	if l == nil || l.store == nil || l.restoreBlocked() {
		return 0
	}
	store, ok := l.store.(chatImportStore)
	objects, objectOK := l.blobs.(chattransfer.Objects)
	if !ok || !objectOK {
		return 0
	}
	select {
	case l.importSlots <- struct{}{}:
	default:
		return 0
	}
	work, err := store.PendingChatImports(ctx, 1)
	if err != nil || len(work) == 0 {
		<-l.importSlots
		if err != nil {
			l.log.Info("chat import claim", slog.String("operation", "chat_import"), slog.String("outcome", "error"), slog.String("error_code", "CHAT_IMPORT_CLAIM_FAILED"))
		}
		return 0
	}
	item := work[0]
	l.handlers.Add(1)
	go func() {
		defer l.handlers.Done()
		defer func() {
			<-l.importSlots
			select {
			case l.wake <- struct{}{}:
			default:
			}
		}()
		if err := store.ProcessChatImport(ctx, item.Owner, item.ImportID, objects); err != nil {
			// A transient failure stays PENDING under the store's lease policy.
			l.log.Info("chat import", slog.String("operation", "chat_import"), slog.String("outcome", "error"), slog.String("error_code", "CHAT_IMPORT_RETRY"))
		}
	}()
	return 1
}

func (l *Loop) cleanupChatTransfers(ctx context.Context) {
	if l == nil || l.store == nil || l.restoreBlocked() {
		return
	}
	store, ok := l.store.(interface {
		CleanupChatTransfers(context.Context, chattransfer.Objects, int) (int, error)
	})
	objects, objectOK := l.blobs.(chattransfer.Objects)
	if !ok || !objectOK {
		return
	}
	if _, err := store.CleanupChatTransfers(ctx, objects, 256); err != nil {
		l.log.Info("chat transfer cleanup", slog.String("operation", "chat_transfer_cleanup"), slog.String("outcome", "error"), slog.String("error_code", "CHAT_TRANSFER_CLEANUP_RETRY"))
	}
}
