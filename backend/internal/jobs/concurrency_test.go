package jobs

import (
	"context"
	"errors"
	"fmt"
	"runtime"
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
	mu           sync.Mutex
	claims       []postgres.JobClaim
	claimCalls   int
	mem          *turn.MemStore
	gate         postgres.OutboundDecision
	enqueueErr   error
	enqueueCalls int
	// extract surface used by the async-extraction tests.
	extractInput postgres.MemoryExtractInput
	extractSaved []postgres.AutoSavedMemoryCreate
	retryCalls   int
	closes       []extractClose
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

// ClaimJobs mirrors the V129 per-kind claim contract: each kind is capped by
// the capacity the loop passed for it (its free slots), the overall limit
// still bounds the batch, and jobs of a kind without capacity stay PENDING.
func (s *concurrencyStore) ClaimJobs(_ context.Context, _, _, _ time.Duration, limit, generationLimit, extractLimit int) ([]postgres.JobClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimCalls++
	var out, rest []postgres.JobClaim
	gen, extract := generationLimit, extractLimit
	for _, c := range s.claims {
		allowed := false
		switch c.Kind {
		case KindGeneration:
			allowed = gen > 0
		case KindMemoryExtract:
			allowed = extract > 0
		default:
			allowed = true
		}
		if allowed && len(out) < limit {
			switch c.Kind {
			case KindGeneration:
				gen--
			case KindMemoryExtract:
				extract--
			}
			out = append(out, c)
		} else {
			rest = append(rest, c)
		}
	}
	s.claims = rest
	return out, nil
}

// pendingByKind reports the unclaimed jobs the fake still holds for a kind.
func (s *concurrencyStore) pendingByKind(kind string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.claims {
		if c.Kind == kind {
			n++
		}
	}
	return n
}

func (s *concurrencyStore) ClaimCalls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.claimCalls
}

func (s *concurrencyStore) GetExport(context.Context, int64, int64) (postgres.Export, error) {
	// Non-PENDING short-circuits the handler to a DONE close, so the test
	// exercises claim + dispatch + complete without the export build.
	return postgres.Export{ID: 980, Status: "COMPLETED"}, nil
}

// TestLoopClaimsExportWhileGenerationAndExtractSlotsFull pins audit L2: when
// the generation slot and the extract slot are both held by hung jobs, a
// DATA_EXPORT job must still be claimed and completed — the V129 claim
// contract caps DATA_EXPORT by the overall batch limit only, never by the
// gen/extract slots, and the loop must not pre-emptively return 0.
func TestLoopClaimsExportWhileGenerationAndExtractSlotsFull(t *testing.T) {
	store := newConcurrencyStore(1)
	armExtractInput(store)
	store.claims = append([]postgres.JobClaim{extractClaim(900, 500)}, store.claims...)
	extract := &blockingExtractProvider{
		release: make(chan struct{}),
		output:  `[]`,
	}
	generation := newConcurrencyProvider()
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, &kindSplitProvider{extract: extract, generation: generation}, nil, nil)

	// Both kind slots fill up with blocked jobs.
	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("claim %d want 2 (generation + extract)", got)
	}
	waitFor(t, "both kind slots busy", func() bool {
		return generation.active.Load() == 1 && extract.active.Load() == 1
	})

	// The export arrives while both slots are held.
	store.mu.Lock()
	store.claims = append(store.claims, postgres.JobClaim{
		OwnerID: 1, JobID: 990, Kind: KindExport, RefID: 980, Token: "tk-exp", Fence: "fk-exp",
	})
	store.mu.Unlock()
	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("export claim while both slots full %d, want 1", got)
	}
	waitFor(t, "export job completed", func() bool {
		store.mu.Lock()
		defer store.mu.Unlock()
		for _, c := range store.closes {
			if c.status == "DONE" {
				return true
			}
		}
		return false
	})
	if got := store.pendingByKind(KindExport); got != 0 {
		t.Fatalf("pending exports %d, want 0 (claimed and completed)", got)
	}

	close(generation.release)
	close(extract.release)
	waitFor(t, "blocked handlers drained", func() bool {
		return generation.completed.Load() == 1 && extract.done.Load() == 1
	})
}

func (s *concurrencyStore) PromoteClaimedGeneration(context.Context, int64, int64, int64, string, string) (string, error) {
	return "IN_PROGRESS", nil
}

// EnqueueMemoryExtract stands in for the V125 trigger. Real dedup lives in
// the SQL function; the fake only counts calls.
func (s *concurrencyStore) EnqueueMemoryExtract(context.Context, int64, int64) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.enqueueCalls++
	if s.enqueueErr != nil {
		return 0, s.enqueueErr
	}
	return 900 + int64(s.enqueueCalls), nil
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

func (s *concurrencyStore) TerminalizeGeneration(ctx context.Context, cmd turn.TerminalCommand) (string, error) {
	return s.mem.TerminalizeGeneration(ctx, cmd)
}

func (s *concurrencyStore) ReadMemoryExtractInput(_ context.Context, _, _ int64) (postgres.MemoryExtractInput, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.extractInput, nil
}

func (s *concurrencyStore) GetMemoryAutoSavePref(context.Context, int64) (bool, error) {
	return true, nil
}

func (s *concurrencyStore) CreateAutoSavedMemory(_ context.Context, _ int64, in postgres.AutoSavedMemoryCreate) (postgres.Memory, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.extractSaved = append(s.extractSaved, in)
	return postgres.Memory{ID: int64(len(s.extractSaved)), AutoSaved: true, Status: "ACCEPTED"}, nil
}

func (s *concurrencyStore) RetryMemoryExtract(context.Context, int64, int64, string, string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retryCalls++
	return "RETRY_SCHEDULED", nil
}

func (s *concurrencyStore) CompleteJob(_ context.Context, _, _ int64, _, _, status, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closes = append(s.closes, extractClose{status: status, reason: reason})
	return nil
}

// blockingExtractProvider models a hung extraction model call. It honours
// context cancellation so Stop can unwind in-flight extractions.
type blockingExtractProvider struct {
	release chan struct{}
	output  string
	calls   atomic.Int32
	active  atomic.Int32
	done    atomic.Int32
}

func (p *blockingExtractProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls.Add(1)
	p.active.Add(1)
	defer func() {
		p.active.Add(-1)
		p.done.Add(1)
	}()
	select {
	case <-ctx.Done():
		return companion.AttemptResult{}, ctx.Err()
	case <-p.release:
	}
	if err := emit(companion.OutputDelta{Text: p.output}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop}, nil
}

// kindSplitProvider routes each request by call shape: extraction is the
// bounded non-streaming call with the extract token budget; generation uses
// the turn budget. One loop instance holds one provider for both handlers.
type kindSplitProvider struct {
	extract    *blockingExtractProvider
	generation *concurrencyProvider
}

func (p *kindSplitProvider) Stream(ctx context.Context, req companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if req.MaxTokens == extractMaxTokens {
		return p.extract.Stream(ctx, req, emit)
	}
	return p.generation.Stream(ctx, req, emit)
}

// extractClaim builds one MEMORY_EXTRACT claim and arms the extract input so
// the handler reaches the provider call.
func extractClaim(jobID, refID int64) postgres.JobClaim {
	return postgres.JobClaim{OwnerID: 1, JobID: jobID, Kind: KindMemoryExtract, RefID: refID,
		Token: fmt.Sprintf("et-%d", jobID), Fence: fmt.Sprintf("ef-%d", jobID)}
}

func armExtractInput(s *concurrencyStore) {
	src := int64(201)
	asst := int64(202)
	s.extractInput = postgres.MemoryExtractInput{
		RelationshipID:     3,
		ConversationID:     4,
		Status:             "COMPLETED",
		SourceMessageID:    &src,
		AssistantMessageID: &asst,
		UserContent:        "用户喜欢安静",
		AssistantContent:   "合成助手回复",
	}
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

	// Per-kind capacity: only the two free generation slots authorise claims.
	// The idle extract slot can no longer be spent on a third generation.
	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("first claim %d want 2 (free generation slots)", got)
	}
	waitFor(t, "two active providers", func() bool { return provider.active.Load() == 2 })
	// No free slot for the kinds on offer: nothing is claimed, nothing waits.
	if got := loop.ClaimOnce(context.Background()); got != 0 {
		t.Fatalf("claim while full %d want 0", got)
	}
	if got := store.ClaimCalls(); got != 2 {
		t.Fatalf("store claim calls while full %d want 2", got)
	}

	close(provider.release)
	waitFor(t, "first pair completes", func() bool {
		return provider.completed.Load() == 2 && loop.Stats().ActiveGenerations == 0
	})
	if got := provider.peak.Load(); got != 2 {
		t.Fatalf("provider peak %d want 2", got)
	}
	// The held-back generations are not lost: freed slots re-open claims.
	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("second round claim %d want 2", got)
	}
	waitFor(t, "all providers complete", func() bool {
		return provider.completed.Load() == 4 && loop.Stats().ActiveGenerations == 0
	})
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

// TestLoopExtractDoesNotBlockGenerationClaiming pins defect 8: a hung
// extraction model call must not stop the single ClaimOnce loop from
// claiming and completing later GENERATION jobs.
func TestLoopExtractDoesNotBlockGenerationClaiming(t *testing.T) {
	store := newConcurrencyStore(1)
	armExtractInput(store)
	store.claims = append([]postgres.JobClaim{extractClaim(900, 500)}, store.claims...)

	extract := &blockingExtractProvider{
		release: make(chan struct{}),
		output:  `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`,
	}
	generation := newConcurrencyProvider()
	close(generation.release) // generation completes immediately
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, &kindSplitProvider{extract: extract, generation: generation}, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("claim %d want 2 (extract + generation)", got)
	}
	waitFor(t, "blocked extraction active", func() bool { return extract.active.Load() == 1 })
	// While the extraction call hangs, the generation must still be claimed,
	// executed and finalized.
	waitFor(t, "generation completed during blocked extract", func() bool {
		return generation.completed.Load() == 1
	})
	store.mu.Lock()
	enqueued := store.enqueueCalls
	saved := len(store.extractSaved)
	store.mu.Unlock()
	if enqueued != 1 {
		t.Fatalf("generation enqueue calls %d, want 1 while extract blocked", enqueued)
	}
	if saved != 0 {
		t.Fatalf("extract saved %d items before release", saved)
	}

	close(extract.release)
	waitFor(t, "extraction drained", func() bool { return extract.done.Load() == 1 })
	store.mu.Lock()
	saved = len(store.extractSaved)
	store.mu.Unlock()
	if saved != 1 || store.extractSaved[0].IdempotencyKey != "auto500-0" {
		t.Fatalf("saved %+v", store.extractSaved)
	}
}

// TestLoopBoundsConcurrentExtracts pins the per-kind extract capacity and the
// claim-takes-the-slot contract: with one slot, only the first extraction is
// claimed; the second stays PENDING in the store until the slot frees, so no
// claimed-but-waiting handler ever exists.
func TestLoopBoundsConcurrentExtracts(t *testing.T) {
	store := newConcurrencyStore(0)
	armExtractInput(store)
	store.claims = []postgres.JobClaim{extractClaim(901, 501), extractClaim(902, 502)}

	extract := &blockingExtractProvider{
		release: make(chan struct{}),
		output:  `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`,
	}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, extract, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("claim %d want 1 (single extract slot)", got)
	}
	waitFor(t, "first extraction active", func() bool { return extract.active.Load() == 1 })
	if got := extract.calls.Load(); got != 1 {
		t.Fatalf("concurrent extract calls %d, want 1 (cap enforced)", got)
	}
	if got := store.pendingByKind(KindMemoryExtract); got != 1 {
		t.Fatalf("pending extracts %d, want 1 held back unclaimed", got)
	}

	close(extract.release)
	waitFor(t, "first extraction drained", func() bool { return extract.done.Load() == 1 })
	// The held-back job is not starved: the freed slot re-opens the claim.
	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("second round claim %d want 1", got)
	}
	waitFor(t, "both extractions drained", func() bool {
		return extract.calls.Load() == 2 && extract.done.Load() == 2 && extract.active.Load() == 0
	})
	store.mu.Lock()
	defer store.mu.Unlock()
	if len(store.extractSaved) != 2 ||
		store.extractSaved[0].IdempotencyKey != "auto501-0" || store.extractSaved[1].IdempotencyKey != "auto502-0" {
		t.Fatalf("saved %+v", store.extractSaved)
	}
}

// TestLoopStopCancelsInFlightExtract pins the shutdown contract: Stop cancels
// the in-flight bounded call and waits for the handler; the abandoned claim is
// left for lease-expiry recovery instead of being completed.
func TestLoopStopCancelsInFlightExtract(t *testing.T) {
	store := newConcurrencyStore(0)
	armExtractInput(store)
	store.claims = []postgres.JobClaim{extractClaim(903, 503)}

	extract := &blockingExtractProvider{release: make(chan struct{})}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, extract, nil, nil)
	if err := loop.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "active extraction", func() bool { return extract.active.Load() == 1 })

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := loop.Stop(ctx); err != nil {
		t.Fatalf("stop %v", err)
	}
	if got := extract.done.Load(); got != 1 {
		t.Fatalf("extract done %d, want cancelled handler drained", got)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.retryCalls != 1 {
		t.Fatalf("retry calls %d, want 1 (cancelled claim requeued)", store.retryCalls)
	}
	if len(store.extractSaved) != 0 {
		t.Fatalf("saved after cancelled extract %+v", store.extractSaved)
	}
}

// TestLoopClaimsExtractOnlyWithinFreeSlots pins the Codex audit finding 4
// repro: with one generation slot and one extract slot, a hung extraction
// must not turn the idle generation slot into MEMORY_EXTRACT claims. Under
// the old kind-blind sum budget, continuous polling claimed all queued
// extractions and piled up waiting goroutines; now it claims none, the
// generation still flows, and the held-back extractions stay claimable.
func TestLoopClaimsExtractOnlyWithinFreeSlots(t *testing.T) {
	store := newConcurrencyStore(1)
	armExtractInput(store)
	queued := []postgres.JobClaim{extractClaim(900, 500)}
	for i := int64(1); i <= 12; i++ {
		queued = append(queued, extractClaim(900+i, 500+i))
	}
	queued = append(queued, store.claims...) // the generation claim
	store.claims = queued

	extract := &blockingExtractProvider{
		release: make(chan struct{}),
		output:  `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`,
	}
	generation := newConcurrencyProvider()
	close(generation.release) // generation completes immediately
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, &kindSplitProvider{extract: extract, generation: generation}, nil, nil)

	before := runtime.NumGoroutine()
	if got := loop.ClaimOnce(context.Background()); got != 2 {
		t.Fatalf("first claim %d want 2 (blocked extract + generation)", got)
	}
	waitFor(t, "blocked extraction active", func() bool { return extract.active.Load() == 1 })
	waitFor(t, "generation completed during blocked extract", func() bool {
		return generation.completed.Load() == 1
	})
	// Continuous polling while the extraction hangs: the extract slot is busy,
	// so no further MEMORY_EXTRACT claim is issued and nothing waits.
	for i := 0; i < 12; i++ {
		if got := loop.ClaimOnce(context.Background()); got != 0 {
			t.Fatalf("poll round %d claimed %d jobs, want 0", i, got)
		}
	}
	if got := extract.calls.Load(); got != 1 {
		t.Fatalf("extract provider calls %d, want 1", got)
	}
	if got := store.pendingByKind(KindMemoryExtract); got != 12 {
		t.Fatalf("pending extracts %d, want 12 unclaimed", got)
	}
	if stats := loop.Stats(); stats.Claims != 2 {
		t.Fatalf("claimed jobs %d, want 2 (extract + generation)", stats.Claims)
	}
	if grew := runtime.NumGoroutine() - before; grew > 3 {
		t.Fatalf("goroutines grew by %d while polling, want bounded (no waiting dispatch)", grew)
	}

	// Releasing the extraction re-opens capacity: the held-back jobs are not
	// starved, one per freed slot.
	close(extract.release)
	waitFor(t, "blocked extraction drained", func() bool { return extract.done.Load() == 1 })
	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("post-release claim %d want 1", got)
	}
	waitFor(t, "reclaimed extraction drained", func() bool { return extract.done.Load() == 2 })
}

// leaseClaimState is one job's durable claim inside leaseClaimStore.
type leaseClaimState struct {
	pending  postgres.JobClaim
	kind     string
	status   string
	token    string
	fence    string
	leaseEnd time.Time
	attempts int
}

// leaseCloseCall records one CompleteJob attempt and whether fencing refused.
type leaseCloseCall struct {
	jobID  int64
	status string
	fenced bool
}

// leaseClaimStore wraps concurrencyStore with a durable-claim model that
// mirrors the SQL fencing: a claim is live only while its work item is
// CLAIMED with the presented token/fence and the lease has not elapsed.
// CompleteJob and PromoteClaimedGeneration are the fence-checked commit
// points; recovery requeues expired claims with the token reset.
type leaseClaimStore struct {
	*concurrencyStore

	mu         sync.Mutex
	now        time.Time
	seq        int
	claims     map[int64]*leaseClaimState
	queue      []postgres.JobClaim
	recoveries int
	closeCalls []leaseCloseCall
	saveKeys   map[string]int
	saveCalls  int

	// promoteGate, when non-nil, parks the first PromoteClaimedGeneration
	// caller to model a handler that has not started executing yet.
	promoteGate     chan struct{}
	promotesWaiting int
	promoteConflics int
}

// Accessors fan the wrapped state out to test assertions; each takes the
// wrapper lock so reads see a consistent claim model.
func (s *leaseClaimStore) recoveryCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.recoveries
}

func (s *leaseClaimStore) fencedCloseCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.closeCalls {
		if c.fenced {
			n++
		}
	}
	return n
}

func (s *leaseClaimStore) savedRowCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.saveKeys)
}

func (s *leaseClaimStore) savedCallCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveCalls
}

// finalCloseDone reports whether the last CompleteJob attempt committed DONE.
func (s *leaseClaimStore) finalCloseDone() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.closeCalls) > 0 && !s.closeCalls[len(s.closeCalls)-1].fenced && s.closeCalls[len(s.closeCalls)-1].status == "DONE"
}

func (s *leaseClaimStore) promotesWaitingCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.promotesWaiting
}

func (s *leaseClaimStore) promoteConflictCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.promoteConflics
}

func newLeaseClaimStore() *leaseClaimStore {
	return &leaseClaimStore{
		concurrencyStore: newConcurrencyStore(0),
		now:              time.Unix(0, 0),
		claims:           map[int64]*leaseClaimState{},
		saveKeys:         map[string]int{},
	}
}

func (s *leaseClaimStore) enqueue(c postgres.JobClaim) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queue = append(s.queue, c)
}

func (s *leaseClaimStore) advance(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.now = s.now.Add(d)
}

func (s *leaseClaimStore) ClaimJobs(_ context.Context, generationLease, exportLease, defaultLease time.Duration, limit, generationLimit, extractLimit int) ([]postgres.JobClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out, rest []postgres.JobClaim
	gen, extract := generationLimit, extractLimit
	for _, c := range s.queue {
		allowed := false
		lease := defaultLease
		switch c.Kind {
		case KindGeneration:
			allowed, lease = gen > 0, generationLease
		case KindMemoryExtract:
			allowed = extract > 0
		default:
			allowed, lease = true, exportLease
		}
		if !allowed || len(out) >= limit {
			rest = append(rest, c)
			continue
		}
		switch c.Kind {
		case KindGeneration:
			gen--
		case KindMemoryExtract:
			extract--
		}
		s.seq++
		issued := c
		issued.Token = fmt.Sprintf("tk%d", s.seq)
		issued.Fence = fmt.Sprintf("fk%d", s.seq)
		s.claims[c.JobID] = &leaseClaimState{
			pending: issued, kind: c.Kind, status: "CLAIMED",
			token: issued.Token, fence: issued.Fence,
			leaseEnd: s.now.Add(lease),
		}
		out = append(out, issued)
	}
	s.queue = rest
	return out, nil
}

// liveLocked reports whether (jobID, token, fence) still names the live claim.
// Caller must hold s.mu.
func (s *leaseClaimStore) liveLocked(jobID int64, token, fence string) bool {
	st, ok := s.claims[jobID]
	return ok && st.status == "CLAIMED" && st.token == token && st.fence == fence && st.leaseEnd.After(s.now)
}

func (s *leaseClaimStore) PromoteClaimedGeneration(_ context.Context, _, _, jobID int64, token, fence string) (string, error) {
	if gate := func() chan struct{} {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.promotesWaiting++
		return s.promoteGate
	}(); gate != nil {
		<-gate
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.promotesWaiting--
	if !s.liveLocked(jobID, token, fence) {
		s.promoteConflics++
		return "", postgres.ErrConflict
	}
	return "IN_PROGRESS", nil
}

func (s *leaseClaimStore) CompleteJob(_ context.Context, _, jobID int64, token, fence, status, _ string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	live := s.liveLocked(jobID, token, fence)
	s.closeCalls = append(s.closeCalls, leaseCloseCall{jobID: jobID, status: status, fenced: !live})
	if !live {
		return postgres.ErrConflict
	}
	s.claims[jobID].status = status
	return nil
}

// CreateAutoSavedMemory dedups by idempotency key like the V125 SQL function:
// a repeated key returns the existing row instead of duplicating memory.
func (s *leaseClaimStore) CreateAutoSavedMemory(_ context.Context, _ int64, in postgres.AutoSavedMemoryCreate) (postgres.Memory, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saveCalls++
	if n := s.saveKeys[in.IdempotencyKey]; n > 0 {
		return postgres.Memory{ID: int64(n), AutoSaved: true, Status: "ACCEPTED"}, nil
	}
	s.saveKeys[in.IdempotencyKey] = len(s.saveKeys) + 1
	return postgres.Memory{ID: int64(len(s.saveKeys)), AutoSaved: true, Status: "ACCEPTED"}, nil
}

func (s *leaseClaimStore) ListExpiredMemoryExtractJobs(_ context.Context, limit int) ([]postgres.JobClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []postgres.JobClaim
	for id, st := range s.claims {
		if st.kind == KindMemoryExtract && st.status == "CLAIMED" && !st.leaseEnd.After(s.now) && len(out) < limit {
			out = append(out, postgres.JobClaim{OwnerID: st.pending.OwnerID, JobID: id, Kind: KindMemoryExtract})
		}
	}
	return out, nil
}

// RecoverExpiredMemoryExtract mirrors the V127 requeue: expired claims lose
// token/fence and rejoin the pending queue with an attempt counted.
func (s *leaseClaimStore) RecoverExpiredMemoryExtract(_ context.Context, _, jobID int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.claims[jobID]
	if !ok || st.kind != KindMemoryExtract {
		return "", postgres.ErrNotFound
	}
	if st.status != "CLAIMED" {
		return "IDEMPOTENT_NON_CLAIMED", nil
	}
	if st.leaseEnd.After(s.now) {
		return "LEASE_ACTIVE", nil
	}
	st.attempts++
	st.status = "PENDING"
	st.token, st.fence = "", ""
	s.queue = append(s.queue, st.pending)
	s.recoveries++
	return "REQUEUED", nil
}

func (s *leaseClaimStore) ListExpiredGenerationJobs(_ context.Context, limit int) ([]postgres.JobClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []postgres.JobClaim
	for id, st := range s.claims {
		if st.kind == KindGeneration && st.status == "CLAIMED" && !st.leaseEnd.After(s.now) && len(out) < limit {
			out = append(out, postgres.JobClaim{OwnerID: st.pending.OwnerID, JobID: id, Kind: KindGeneration})
		}
	}
	return out, nil
}

// RecoverExpiredGeneration models the V117 REQUEUE_NO_INTENT branch: the
// blocked handler never reached the provider, so no attempt intent exists and
// the expired claim requeues.
func (s *leaseClaimStore) RecoverExpiredGeneration(_ context.Context, _, jobID int64) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.claims[jobID]
	if !ok || st.kind != KindGeneration {
		return "", postgres.ErrNotFound
	}
	if st.status != "CLAIMED" {
		return "IDEMPOTENT_NON_CLAIMED", nil
	}
	if st.leaseEnd.After(s.now) {
		return "LEASE_ACTIVE", nil
	}
	st.status = "PENDING"
	st.token, st.fence = "", ""
	s.queue = append(s.queue, st.pending)
	s.recoveries++
	return "REQUEUE_NO_INTENT", nil
}

// TestLoopExpiredExtractRequeueFencesOldHolder pins the expiry coordination:
// an extraction whose claim lease elapsed mid-provider-call is requeued by
// recovery; the old holder may finish its already-started call but its save
// is idempotency-keyed (no duplicate memory) and its CompleteJob is refused
// by fencing, so the retried claim is the only committer.
func TestLoopExpiredExtractRequeueFencesOldHolder(t *testing.T) {
	store := newLeaseClaimStore()
	armExtractInput(store.concurrencyStore)
	store.enqueue(extractClaim(940, 600))

	extract := &blockingExtractProvider{
		release: make(chan struct{}),
		output:  `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`,
	}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, extract, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("claim %d want 1", got)
	}
	waitFor(t, "extraction active", func() bool { return extract.active.Load() == 1 })

	// The provider call outlives the claim lease; recovery requeues the job.
	store.advance(2 * time.Minute)
	if err := loop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := store.recoveryCount(); got != 1 {
		t.Fatalf("recoveries %d want 1", got)
	}
	if got := extract.calls.Load(); got != 1 {
		t.Fatalf("extract calls before release %d want 1", got)
	}

	// The old holder finishes its already-started call: it may save through
	// the idempotency key exactly once, but its commit must be fenced.
	close(extract.release)
	waitFor(t, "old holder fenced on close", func() bool {
		return store.fencedCloseCount() == 1 && len(loop.extractSlots) == 0
	})
	if got := store.savedRowCount(); got != 1 {
		t.Fatalf("saved memories %d want 1 (idempotency key dedup)", got)
	}

	// The requeued job is the only claim that can commit.
	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("retry claim %d want 1", got)
	}
	waitFor(t, "retried extraction drained", func() bool {
		return extract.calls.Load() == 2 && extract.done.Load() == 2
	})
	if got := store.savedRowCount(); got != 1 {
		t.Fatalf("saved memories after retry %d want 1", got)
	}
	if got := store.savedCallCount(); got != 2 {
		t.Fatalf("save attempts %d want 2 (one per run, one row)", got)
	}
	if !store.finalCloseDone() {
		t.Fatal("retried claim did not commit DONE")
	}
	if got := store.recoveryCount(); got != 1 {
		t.Fatalf("recoveries after retry %d want 1", got)
	}
}

// TestLoopExpiredGenerationClaimCannotStartAfterRequeue pins the not-yet-
// started holder case: a claimed generation parked before its first fence
// check must abort there once recovery requeued the job — it never calls the
// provider — and the requeued claim runs exactly once.
func TestLoopExpiredGenerationClaimCannotStartAfterRequeue(t *testing.T) {
	store := newLeaseClaimStore()
	store.enqueue(postgres.JobClaim{OwnerID: 1, JobID: 950, Kind: KindGeneration, RefID: 700})
	store.promoteGate = make(chan struct{})
	armExtractInput(store.concurrencyStore)
	store.mem.PutSeed(turn.ContextSeed{
		TurnID:             "700",
		CurrentUserMessage: "今天有点累。",
		AllowedCategories:  []turn.DataCategory{turn.CategoryMessage},
		ConfigVersion:      "concurrency-test-v1",
	})

	provider := newConcurrencyProvider()
	close(provider.release)
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)

	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("claim %d want 1", got)
	}
	waitFor(t, "old holder parked at fence check", func() bool { return store.promotesWaitingCount() == 1 })

	// Lease elapses while the holder has not started executing; recovery
	// requeues and the retried claim runs to completion.
	store.advance(2 * time.Minute)
	if err := loop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := store.recoveryCount(); got != 1 {
		t.Fatalf("recoveries %d want 1", got)
	}
	close(store.promoteGate)
	// The stale holder aborts at the fence check and releases its slot before
	// the requeued claim can fit the pool again.
	waitFor(t, "stale holder aborted and slot released", func() bool {
		return store.promoteConflictCount() == 1 && len(loop.generationSlots) == 0
	})
	if got := loop.ClaimOnce(context.Background()); got != 1 {
		t.Fatalf("retry claim %d want 1", got)
	}
	waitFor(t, "retried generation completes", func() bool {
		return provider.completed.Load() == 1 && loop.Stats().ActiveGenerations == 0
	})

	// The stale holder was refused at the fence check and never went outbound.
	if got := provider.calls.Load(); got != 1 {
		t.Fatalf("provider calls %d want 1 (stale holder must not go outbound)", got)
	}
	if got := store.promoteConflictCount(); got != 1 {
		t.Fatalf("fenced promotes %d want 1", got)
	}
}
