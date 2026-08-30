package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

const (
	KindGeneration = "GENERATION"
	KindExport     = "DATA_EXPORT"
)

// Store is the durable jobs/generation surface used by the worker.
type Store interface {
	turn.Store
	ClaimJobs(ctx context.Context, generationLease, exportLease, defaultLease time.Duration, limit int) ([]postgres.JobClaim, error)
	PromoteClaimedGeneration(ctx context.Context, owner, generationID, jobID int64, token, fence string) (string, error)
	CompleteJob(ctx context.Context, owner, jobID int64, token, fence, status, reason string) error
	ListExpiredGenerationJobs(ctx context.Context, limit int) ([]postgres.JobClaim, error)
	RecoverExpiredGeneration(ctx context.Context, owner, jobID int64) (string, error)
	ExpireQueuedGenerations(ctx context.Context, timeout time.Duration) (int, error)
	PurgeExpiredOpaqueSessions(ctx context.Context) (int, error)
	ExpireStaleExports(ctx context.Context) (int, error)
	ListExpiredExportObjects(ctx context.Context) ([]postgres.ExportObject, error)
	ClearExportObject(ctx context.Context, owner, exportID int64, objectKey string) error
	RunRetentionCategory(ctx context.Context, category string, dryRun bool) error
	StartTurn(ctx context.Context, owner int64, in postgres.StartTurn) (postgres.GenerationView, error)
	CancelTurn(ctx context.Context, owner, generationID int64) (postgres.GenerationView, error)
	GetGeneration(ctx context.Context, owner, generationID int64) (postgres.GenerationView, error)
	GenerationSnapshot(ctx context.Context, owner, generationID int64) (postgres.GenerationSnapshot, error)
	OutboundCheck(ctx context.Context, owner int64) (postgres.OutboundDecision, error)
	ListConversations(ctx context.Context, owner int64, relationshipID, after *int64, limit *int) ([]postgres.Conversation, error)
	ListMessages(ctx context.Context, owner, conversationID int64, after *int64, limit *int) ([]postgres.Message, error)
	ListMemories(ctx context.Context, owner, relationshipID int64, includeDeleted bool) ([]postgres.Memory, error)
	ListRelationships(ctx context.Context, owner int64) ([]postgres.Relationship, error)
	CompleteExport(ctx context.Context, owner, exportID int64, payload string, expiresAt time.Time) error
	CompleteExportObject(ctx context.Context, owner, exportID int64, objectKey string, objectBytes int64, expiresAt time.Time) error
	RecordExportUploadIntent(ctx context.Context, owner, exportID int64, objectKey string, leaseSeconds int) (int64, error)
	GetExport(ctx context.Context, owner, exportID int64) (postgres.Export, error)
}

// Policy is per-handler lease and polling. There is no generic heartbeat.
type Policy struct {
	GenerationLease time.Duration
	ExportLease     time.Duration
	DefaultLease    time.Duration
	ClaimLimit      int
	RecoverEvery    time.Duration
	QueueTimeout    time.Duration
	PollIdle        time.Duration
	PollBusy        time.Duration
}

func PolicyFrom(cfg config.Config) Policy {
	return Policy{
		GenerationLease: cfg.Budget.TotalTimeout + 30*time.Second,
		ExportLease:     10 * time.Minute,
		DefaultLease:    60 * time.Second,
		ClaimLimit:      cfg.Concurrency.ClaimLimit,
		RecoverEvery:    cfg.Concurrency.RecoverInterval,
		QueueTimeout:    cfg.Concurrency.QueueTimeout,
		PollIdle:        time.Second,
		PollBusy:        50 * time.Millisecond,
	}
}

// Cancels holds in-process generation cancel funcs. Durable cancel is the DB.
type Cancels struct {
	mu sync.Mutex
	fn map[int64]context.CancelFunc
}

func NewCancels() *Cancels {
	return &Cancels{fn: map[int64]context.CancelFunc{}}
}

func (c *Cancels) Register(id int64, cancel context.CancelFunc) {
	if c == nil || id <= 0 || cancel == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fn[id] = cancel
}

func (c *Cancels) Unregister(id int64) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.fn, id)
}

func (c *Cancels) Cancel(id int64) bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	fn := c.fn[id]
	c.mu.Unlock()
	if fn == nil {
		return false
	}
	fn()
	return true
}

// Loop is the single worker claim/dispatch loop (PlaneJobs).
type Loop struct {
	log      *slog.Logger
	policy   Policy
	budget   companion.TurnBudget
	store    Store
	provider companion.Provider
	hub      *realtime.Hub
	cancels  *Cancels
	blobs    BlobStore
	metrics  *observability.Registry

	claims     atomic.Uint64
	recoveries atomic.Uint64

	stop context.CancelFunc
	done chan struct{}
}

// BlobStore is the approved export object store. Nil means inline payload.
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte) error
	Delete(ctx context.Context, key string) error
}

func NewLoop(log *slog.Logger, policy Policy, budget companion.TurnBudget) *Loop {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Loop{
		log:     log,
		policy:  policy,
		budget:  budget,
		cancels: NewCancels(),
		done:    make(chan struct{}),
	}
}

func (l *Loop) Name() config.Plane { return config.PlaneJobs }

func (l *Loop) BindStore(store *postgres.Store) {
	if l == nil || store == nil {
		return
	}
	l.store = store
}

func (l *Loop) Use(store Store, provider companion.Provider, hub *realtime.Hub, blobs BlobStore) {
	if l == nil {
		return
	}
	l.store = store
	l.provider = provider
	l.hub = hub
	l.blobs = blobs
}

func (l *Loop) Cancels() *Cancels {
	if l == nil {
		return nil
	}
	return l.cancels
}

func (l *Loop) Hub() *realtime.Hub {
	if l == nil {
		return nil
	}
	return l.hub
}

func (l *Loop) Start(ctx context.Context) error {
	if l == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithCancel(ctx)
	l.stop = cancel
	go l.run(runCtx)
	return nil
}

func (l *Loop) Stop(ctx context.Context) error {
	if l == nil {
		return nil
	}
	if l.stop != nil {
		l.stop()
	}
	select {
	case <-l.done:
	case <-ctx.Done():
	case <-time.After(2 * time.Second):
	}
	return nil
}

func (l *Loop) run(ctx context.Context) {
	defer close(l.done)
	recoverEvery := l.policy.RecoverEvery
	if recoverEvery <= 0 {
		recoverEvery = 5 * time.Second
	}
	idle := l.policy.PollIdle
	if idle <= 0 {
		idle = time.Second
	}
	busy := l.policy.PollBusy
	if busy <= 0 {
		busy = 50 * time.Millisecond
	}
	ticker := time.NewTicker(recoverEvery)
	defer ticker.Stop()
	for {
		n := l.ClaimOnce(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = l.RecoverOnce(ctx)
			_, _ = l.store.ExpireQueuedGenerations(ctx, l.policy.QueueTimeout)
		default:
		}
		wait := idle
		if n > 0 {
			wait = busy
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-ticker.C:
			timer.Stop()
			_ = l.RecoverOnce(ctx)
		case <-timer.C:
		}
	}
}

func (l *Loop) ClaimOnce(ctx context.Context) int {
	if l == nil || l.store == nil {
		return 0
	}
	claims, err := l.store.ClaimJobs(ctx, l.policy.GenerationLease, l.policy.ExportLease, l.policy.DefaultLease, l.policy.ClaimLimit)
	if err != nil {
		l.log.Info("job claim",
			slog.String("operation", "job_claim"),
			slog.String("outcome", "error"),
			slog.String("error_code", "CLAIM_FAILED"),
		)
		return 0
	}
	for _, c := range claims {
		l.claims.Add(1)
		l.dispatch(ctx, c)
	}
	return len(claims)
}

func (l *Loop) RecoverOnce(ctx context.Context) error {
	if l == nil || l.store == nil {
		return nil
	}
	expired, err := l.store.ListExpiredGenerationJobs(ctx, l.policy.ClaimLimit)
	if err != nil {
		return err
	}
	for _, c := range expired {
		action, recErr := l.store.RecoverExpiredGeneration(ctx, c.OwnerID, c.JobID)
		if recErr != nil {
			l.log.Info("job recover",
				slog.String("operation", "job_recover"),
				slog.String("outcome", "error"),
				slog.String("error_code", "RECOVER_FAILED"),
			)
			continue
		}
		l.recoveries.Add(1)
		l.log.Info("job recover",
			slog.String("operation", "job_recover"),
			slog.String("outcome", "ok"),
			slog.String("event_type", action),
		)
	}
	return nil
}

func (l *Loop) dispatch(ctx context.Context, c postgres.JobClaim) {
	runID := newRunID()
	log := l.log.With(slog.String("run_id", runID))
	var err error
	switch c.Kind {
	case KindGeneration:
		err = l.handleGeneration(ctx, c, runID)
	case KindExport:
		err = l.handleExport(ctx, c)
	default:
		log.Info("job skipped",
			slog.String("operation", "job_dispatch"),
			slog.String("outcome", "ignored"),
			slog.String("event_type", c.Kind),
		)
		_ = l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", "UNSUPPORTED_KIND")
		return
	}
	if err != nil {
		log.Info("job handler",
			slog.String("operation", "job_dispatch"),
			slog.String("outcome", "error"),
			slog.String("error_code", "HANDLER_FAILED"),
		)
	}
}

func fmtInt(n int64) string {
	return strconv.FormatInt(n, 10)
}

func newRunID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "run"
	}
	return hex.EncodeToString(b[:])
}
