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
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
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
	GenerationLease    time.Duration
	ExportLease        time.Duration
	DefaultLease       time.Duration
	ProviderID         string
	SupplierName       string
	ModelID            string
	MaxConcurrentTurns int
	ClaimLimit         int
	RecoverEvery       time.Duration
	QueueTimeout       time.Duration
	PollIdle           time.Duration
	PollBusy           time.Duration
}

func PolicyFrom(cfg config.Config) Policy {
	return Policy{
		GenerationLease:    cfg.Budget.TotalTimeout + 30*time.Second,
		ExportLease:        10 * time.Minute,
		DefaultLease:       60 * time.Second,
		ProviderID:         cfg.Provider.ID,
		SupplierName:       cfg.Provider.SupplierName,
		ModelID:            cfg.Provider.Model,
		MaxConcurrentTurns: cfg.Concurrency.MaxConcurrentTurns,
		ClaimLimit:         cfg.Concurrency.ClaimLimit,
		RecoverEvery:       cfg.Concurrency.RecoverInterval,
		QueueTimeout:       cfg.Concurrency.QueueTimeout,
		PollIdle:           time.Second,
		PollBusy:           50 * time.Millisecond,
	}
}

// Cancels holds in-process generation cancel funcs. Durable cancel is the DB.
type Cancels struct {
	mu sync.Mutex
	fn map[int64]cancelEntry
}

type cancelEntry struct {
	ownerID int64
	cancel  context.CancelFunc
}

func NewCancels() *Cancels {
	return &Cancels{fn: map[int64]cancelEntry{}}
}

func (c *Cancels) Register(ownerID, id int64, cancel context.CancelFunc) {
	if c == nil || ownerID <= 0 || id <= 0 || cancel == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fn[id] = cancelEntry{ownerID: ownerID, cancel: cancel}
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
	entry, ok := c.fn[id]
	if ok {
		delete(c.fn, id)
	}
	c.mu.Unlock()
	if !ok {
		return false
	}
	entry.cancel()
	return true
}

// CancelOwner removes and cancels only the owner's active in-process calls.
// The registry is bounded by the worker's configured generation concurrency;
// durable cancellation remains the database's responsibility.
func (c *Cancels) CancelOwner(ownerID int64) int {
	if c == nil || ownerID <= 0 {
		return 0
	}
	c.mu.Lock()
	toCancel := make([]context.CancelFunc, 0)
	for id, entry := range c.fn {
		if entry.ownerID == ownerID {
			delete(c.fn, id)
			toCancel = append(toCancel, entry.cancel)
		}
	}
	c.mu.Unlock()
	for _, cancel := range toCancel {
		cancel()
	}
	return len(toCancel)
}

// Loop is the single worker claim/dispatch loop (PlaneJobs).
type Loop struct {
	log             *slog.Logger
	policy          Policy
	budget          companion.TurnBudget
	store           Store
	provider        companion.Provider
	providerFactory func(modelprovider.Route) (companion.Provider, error)
	hub             *realtime.Hub
	cancels         *Cancels
	blobs           BlobStore
	metrics         *observability.Registry

	claimMu         sync.Mutex
	generationSlots chan struct{}
	handlers        sync.WaitGroup
	wake            chan struct{}
	started         atomic.Bool

	claims            atomic.Uint64
	recoveries        atomic.Uint64
	activeGenerations atomic.Int64
	peakGenerations   atomic.Int64

	stop context.CancelFunc
	done chan struct{}
}

// BlobStore is the approved export object store. Nil means inline payload.
type BlobStore interface {
	Put(ctx context.Context, key string, data []byte) (storedBytes int64, err error)
	Delete(ctx context.Context, key string) error
}

func NewLoop(log *slog.Logger, policy Policy, budget companion.TurnBudget) *Loop {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	if policy.MaxConcurrentTurns < 1 {
		policy.MaxConcurrentTurns = 1
	}
	if policy.ProviderID == "" {
		policy.ProviderID = "openai-compatible"
	}
	if policy.SupplierName == "" {
		policy.SupplierName = policy.ProviderID
	}
	return &Loop{
		log:             log,
		policy:          policy,
		budget:          budget,
		cancels:         NewCancels(),
		generationSlots: make(chan struct{}, policy.MaxConcurrentTurns),
		wake:            make(chan struct{}, 1),
		done:            make(chan struct{}),
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

// UseProviderFactory enables database-configured routes. The route list is
// resolved once per generation; the factory is a closed protocol switch.
func (l *Loop) UseProviderFactory(factory func(modelprovider.Route) (companion.Provider, error)) {
	if l != nil {
		l.providerFactory = factory
	}
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

// Stats is a low-cardinality worker snapshot for the metrics registry.
type Stats struct {
	Claims            uint64
	Recoveries        uint64
	ActiveGenerations int64
	PeakGenerations   int64
}

func (l *Loop) Stats() Stats {
	if l == nil {
		return Stats{}
	}
	return Stats{
		Claims:            l.claims.Load(),
		Recoveries:        l.recoveries.Load(),
		ActiveGenerations: l.activeGenerations.Load(),
		PeakGenerations:   l.peakGenerations.Load(),
	}
}

func (l *Loop) Start(ctx context.Context) error {
	if l == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if !l.started.CompareAndSwap(false, true) {
		return nil
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
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
	}
	if l.stop != nil {
		l.stop()
	}
	if l.started.Load() {
		select {
		case <-l.done:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	handlersDone := make(chan struct{})
	go func() {
		l.handlers.Wait()
		close(handlersDone)
	}()
	select {
	case <-handlersDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
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
		case <-l.wake:
			timer.Stop()
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
	l.claimMu.Lock()
	defer l.claimMu.Unlock()
	available := cap(l.generationSlots) - len(l.generationSlots)
	if available <= 0 {
		return 0
	}
	limit := l.policy.ClaimLimit
	if limit < 1 || limit > available {
		limit = available
	}
	claims, err := l.store.ClaimJobs(ctx, l.policy.GenerationLease, l.policy.ExportLease, l.policy.DefaultLease, limit)
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
		if c.Kind == KindGeneration {
			l.generationSlots <- struct{}{}
			l.handlers.Add(1)
			go l.dispatchGeneration(ctx, c)
			continue
		}
		l.dispatch(ctx, c)
	}
	return len(claims)
}

func (l *Loop) dispatchGeneration(ctx context.Context, c postgres.JobClaim) {
	active := l.activeGenerations.Add(1)
	for {
		peak := l.peakGenerations.Load()
		if active <= peak || l.peakGenerations.CompareAndSwap(peak, active) {
			break
		}
	}
	defer func() {
		l.activeGenerations.Add(-1)
		<-l.generationSlots
		l.handlers.Done()
		select {
		case l.wake <- struct{}{}:
		default:
		}
	}()
	l.dispatch(ctx, c)
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
