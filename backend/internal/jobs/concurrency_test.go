package jobs

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

type concurrencyStore struct {
	Store
	mu         sync.Mutex
	claims     []postgres.JobClaim
	claimCalls int
	mem        *turn.MemStore
	gate       postgres.OutboundDecision
}

func newConcurrencyStore(n int) *concurrencyStore {
	s := &concurrencyStore{
		mem:  turn.NewMemStore(),
		gate: postgres.OutboundDecision{Allow: true, Code: "OK", Categories: []string{"MESSAGE_TEXT"}},
	}
	for i := 1; i <= n; i++ {
		id := int64(i)
		s.claims = append(s.claims, postgres.JobClaim{
			OwnerID: 1, JobID: 100 + id, Kind: KindGeneration, RefID: id,
			Token: "token-" + strconv.Itoa(i), Fence: "fence-" + strconv.Itoa(i),
		})
		s.mem.PutSeed(turn.ContextSeed{
			TurnID:             strconv.Itoa(i),
			CurrentUserMessage: "今天有点累。",
			AllowedCategories:  []turn.DataCategory{turn.CategoryMessage},
			ConfigVersion:      "concurrency-test-v1",
		})
	}
	return s
}

func (s *concurrencyStore) ClaimJobs(_ context.Context, _, _, _ time.Duration, limit int) ([]postgres.JobClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimCalls++
	if limit > len(s.claims) {
		limit = len(s.claims)
	}
	out := append([]postgres.JobClaim(nil), s.claims[:limit]...)
	s.claims = s.claims[limit:]
	return out, nil
}

func (s *concurrencyStore) ClaimCalls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.claimCalls
}

func (s *concurrencyStore) PromoteClaimedGeneration(context.Context, int64, int64, int64, string, string) (string, error) {
	return "IN_PROGRESS", nil
}

func (s *concurrencyStore) OutboundCheck(context.Context, int64) (postgres.OutboundDecision, error) {
	return s.gate, nil
}

func (s *concurrencyStore) LoadSeed(ctx context.Context, key turn.TurnKey) (turn.ContextSeed, error) {
	return s.mem.LoadSeed(ctx, key)
}

func (s *concurrencyStore) PrepareAttempt(ctx context.Context, cmd turn.PrepareAttempt) (turn.PreparedAttempt, error) {
	return s.mem.PrepareAttempt(ctx, cmd)
}

func (s *concurrencyStore) RecordAttemptOutcome(ctx context.Context, outcome companion.AttemptOutcome) error {
	return s.mem.RecordAttemptOutcome(ctx, outcome)
}

func (s *concurrencyStore) FinalizeGeneration(ctx context.Context, cmd turn.FinalizeCommand) error {
	return s.mem.FinalizeGeneration(ctx, cmd)
}

func (s *concurrencyStore) TerminalizeGeneration(ctx context.Context, cmd turn.TerminalCommand) error {
	return s.mem.TerminalizeGeneration(ctx, cmd)
}

type concurrencyProvider struct {
	release   chan struct{}
	cancelErr chan error
	active    atomic.Int32
	peak      atomic.Int32
	calls     atomic.Int32
	cancelled atomic.Int32
	completed atomic.Int32
}

func newConcurrencyProvider() *concurrencyProvider {
	return &concurrencyProvider{release: make(chan struct{}), cancelErr: make(chan error, 8)}
}

func (p *concurrencyProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls.Add(1)
	active := p.active.Add(1)
	for {
		peak := p.peak.Load()
		if active <= peak || p.peak.CompareAndSwap(peak, active) {
			break
		}
	}
	defer func() {
		p.active.Add(-1)
		p.completed.Add(1)
	}()
	select {
	case <-ctx.Done():
		p.cancelled.Add(1)
		p.cancelErr <- ctx.Err()
		return companion.AttemptResult{}, ctx.Err()
	case <-p.release:
	}
	if err := emit(companion.OutputDelta{Text: "我在。"}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{
		Finish: companion.FinishStop,
		Usage:  companion.Usage{InputTokens: 2, OutputTokens: 2, TotalTokens: 4},
	}, nil
}

func TestLoopCancelOwnerStopsOnlyMatchingProvider(t *testing.T) {
	store := newConcurrencyStore(2)
	store.claims[1].OwnerID = 2
	provider := newConcurrencyProvider()
	loop := NewLoop(nil, testLoopPolicy(2), testTurnBudget())
	loop.Use(store, provider, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("claim %d want 2", got)
	}
	waitFor(t, "two active providers", func() bool { return provider.active.Load() == 2 })
	if got := loop.Cancels().CancelOwner(1); got != 1 {
		t.Fatalf("owner 1 cancels %d want 1", got)
	}
	waitFor(t, "owner 1 provider cancellation", func() bool {
		return provider.cancelled.Load() == 1 && provider.active.Load() == 1
	})
	select {
	case err := <-provider.cancelErr:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("provider cancellation error %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("provider did not report cancellation")
	}
	if got := loop.Cancels().CancelOwner(1); got != 0 {
		t.Fatalf("repeated owner 1 cancels %d want 0", got)
	}

	close(provider.release)
	waitFor(t, "owner 2 provider completion", func() bool {
		return provider.completed.Load() == 2 && provider.active.Load() == 0
	})
	if got := provider.cancelled.Load(); got != 1 {
		t.Fatalf("cancelled providers %d want 1", got)
	}
}

func testLoopPolicy(maxConcurrent int) Policy {
	return Policy{
		GenerationLease:    time.Minute,
		ExportLease:        time.Minute,
		DefaultLease:       time.Minute,
		MaxConcurrentTurns: maxConcurrent,
		ClaimLimit:         8,
		RecoverEvery:       time.Minute,
		QueueTimeout:       time.Minute,
		PollIdle:           10 * time.Millisecond,
		PollBusy:           time.Millisecond,
	}
}

func testTurnBudget() companion.TurnBudget {
	return companion.TurnBudget{
		MaxInputTokens:    8000,
		MaxOutputTokens:   100,
		MaxResponseBytes:  4 << 10,
		ConnectTimeout:    time.Second,
		FirstTokenTimeout: time.Second,
		TotalTimeout:      5 * time.Second,
		MaxAttempts:       1,
	}
}

func waitFor(t *testing.T, message string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", message)
}

func TestLoopBoundsConcurrentGenerationsAndDoesNotOverclaim(t *testing.T) {
	store := newConcurrencyStore(4)
	provider := newConcurrencyProvider()
	loop := NewLoop(nil, testLoopPolicy(2), testTurnBudget())
	loop.Use(store, provider, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("first claim %d want 2", got)
	}
	waitFor(t, "two active providers", func() bool { return provider.active.Load() == 2 })
	if got := loop.ClaimOnce(context.Background()); got != 0 {
		t.Fatalf("claim while full %d want 0", got)
	}
	if got := store.ClaimCalls(); got != 1 {
		t.Fatalf("store claim calls while full %d want 1", got)
	}

	close(provider.release)
	waitFor(t, "first wave drain", func() bool {
		return provider.completed.Load() == 2 && loop.Stats().ActiveGenerations == 0
	})
	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("second claim %d want 2", got)
	}
	waitFor(t, "all providers complete", func() bool {
		return provider.completed.Load() == 4 && loop.Stats().ActiveGenerations == 0
	})
	if got := provider.peak.Load(); got != 2 {
		t.Fatalf("provider peak %d want 2", got)
	}
	stats := loop.Stats()
	if stats.PeakGenerations != 2 || stats.Claims != 4 {
		t.Fatalf("loop stats %+v", stats)
	}
}

func TestLoopStopCancelsAndDrainsGeneration(t *testing.T) {
	store := newConcurrencyStore(1)
	provider := newConcurrencyProvider()
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)
	if err := loop.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "active provider", func() bool { return provider.active.Load() == 1 })

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := loop.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	if stats := loop.Stats(); stats.ActiveGenerations != 0 {
		t.Fatalf("active after stop %+v", stats)
	}
}

func TestLoopDeniedOutboundNeverCallsProvider(t *testing.T) {
	store := newConcurrencyStore(1)
	store.gate = postgres.OutboundDecision{Allow: false, Code: "CONSENT_WITHDRAWN", Categories: []string{}}
	provider := newConcurrencyProvider()
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("claim %d want 1", got)
	}
	waitFor(t, "denied handler drain", func() bool {
		return len(loop.generationSlots) == 0
	})
	if got := provider.calls.Load(); got != 0 {
		t.Fatalf("provider calls %d want 0", got)
	}
}
