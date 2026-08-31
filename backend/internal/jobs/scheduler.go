package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// Scheduler is the retained maintenance plane. It does not claim GENERATION jobs.
type Scheduler struct {
	loop *Loop
	stop context.CancelFunc
	done chan struct{}
}

func NewScheduler(loop *Loop) *Scheduler {
	return &Scheduler{loop: loop, done: make(chan struct{})}
}

func (s *Scheduler) Name() config.Plane { return config.PlaneScheduler }

func (s *Scheduler) BindStore(store *postgres.Store) {
	if s == nil || s.loop == nil {
		return
	}
	s.loop.BindStore(store)
}

func (s *Scheduler) Start(ctx context.Context) error {
	if s == nil || s.loop == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.stop = cancel
	go s.run(runCtx)
	return nil
}

func (s *Scheduler) Stop(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if s.stop != nil {
		s.stop()
	}
	select {
	case <-s.done:
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
	}
	return nil
}

func (s *Scheduler) run(ctx context.Context) {
	defer close(s.done)
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	_ = s.RunOnce(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			_ = s.RunOnce(ctx)
		}
	}
}

func (s *Scheduler) RunOnce(ctx context.Context) error {
	if s == nil || s.loop == nil || s.loop.store == nil {
		return nil
	}
	store := s.loop.store
	if _, err := store.PurgeExpiredOpaqueSessions(ctx); err != nil {
		s.loop.log.Info("session cleanup",
			slog.String("operation", "session_cleanup"),
			slog.String("outcome", "error"),
			slog.String("error_code", "SESSION_CLEANUP"),
		)
	}
	if _, err := store.ExpireStaleExports(ctx); err != nil {
		s.loop.log.Info("export expiry",
			slog.String("operation", "export_expiry"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXPORT_EXPIRY"),
		)
	} else {
		objs, err := store.ListExpiredExportObjects(ctx)
		if err == nil {
			if len(objs) > 0 && s.loop.blobs == nil {
				s.loop.log.Info("export object cleanup",
					slog.String("operation", "export_object_cleanup"),
					slog.String("outcome", "error"),
					slog.String("error_code", "BLOB_STORE_UNAVAILABLE"),
				)
			}
			for _, o := range objs {
				if s.loop.blobs == nil {
					continue
				}
				if err := s.loop.blobs.Delete(ctx, o.ObjectKey); err != nil {
					s.loop.log.Info("export object cleanup",
						slog.String("operation", "export_object_cleanup"),
						slog.String("outcome", "error"),
						slog.String("error_code", "EXPORT_OBJECT_DELETE"),
					)
					continue
				}
				if err := store.ClearExportObject(ctx, o.OwnerUserID, o.ExportID, o.ObjectKey); err != nil {
					s.loop.log.Info("export object cleanup",
						slog.String("operation", "export_object_cleanup"),
						slog.String("outcome", "error"),
						slog.String("error_code", "EXPORT_OBJECT_CLEAR"),
					)
				}
			}
		}
	}
	_ = store.RunRetentionCategory(ctx, "EXPORT_RESIDUE", true)
	_ = s.loop.RecoverOnce(ctx)
	_, _ = store.ExpireQueuedGenerations(ctx, s.loop.policy.QueueTimeout)
	return nil
}
