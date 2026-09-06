package jobs

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

// terminalTestStore fakes the durable generation surface for terminal
// broadcast tests. Persist calls are individually failable and the snapshot
// stands in for the authoritative reconnect view. terminalStatus overrides the
// status a successful TerminalizeGeneration reports, simulating a concurrent
// path that won the race with a different terminal state.
type terminalTestStore struct {
	Store
	mu             sync.Mutex
	terminalErr    error
	terminalStatus string
	emptyStatus    bool
	terminalCalls  int
	finalizeErr    error
	finalizeCalls  int
	snapshot       postgres.GenerationSnapshot
}

func (s *terminalTestStore) TerminalizeGeneration(_ context.Context, cmd turn.TerminalCommand) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.terminalCalls++
	if s.emptyStatus {
		return "", s.terminalErr
	}
	status := s.terminalStatus
	if status == "" {
		status = turn.TerminalStatusFor(cmd.Phase)
	}
	return status, s.terminalErr
}

func (s *terminalTestStore) FinalizeGeneration(context.Context, turn.FinalizeCommand) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalizeCalls++
	return s.finalizeErr
}

func (s *terminalTestStore) GenerationSnapshot(context.Context, int64, int64) (postgres.GenerationSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshot, nil
}

func subscribeGenerationHub(t *testing.T, turnID string) (*realtime.Hub, *realtime.Sub) {
	t.Helper()
	hub := realtime.New()
	hub.Accepted(turnID)
	sub, err := hub.Subscribe(turnID)
	if err != nil {
		t.Fatal(err)
	}
	return hub, sub
}

// nextTerminalEvent drains non-terminal events and returns the first terminal
// event, or "" when none arrives before the deadline.
func nextTerminalEvent(t *testing.T, sub *realtime.Sub) companion.PublicEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	for {
		ev, ok := sub.Recv(ctx)
		if !ok {
			return ""
		}
		switch ev.Name {
		case companion.EventCompleted, companion.EventBlocked, companion.EventFailed, companion.EventCancelled:
			return ev.Name
		}
	}
}

func terminalTestClaim() postgres.JobClaim {
	return postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindGeneration, RefID: 5, Token: "token", Fence: "fence"}
}

func TestTerminalBroadcastsAfterPersistSucceeds(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		phase companion.Phase
		want  companion.PublicEvent
	}{
		{companion.PhaseFailed, companion.EventFailed},
		{companion.PhaseBlocked, companion.EventBlocked},
		{companion.PhaseCancelled, companion.EventCancelled},
	} {
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(&terminalTestStore{}, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), tc.phase, "REASON"); err != nil {
			t.Fatal(err)
		}
		if got := nextTerminalEvent(t, sub); got != tc.want {
			t.Fatalf("phase %s event %q, want %q", tc.phase, got, tc.want)
		}
	}
}

func TestTerminalWithoutPersistConfirmDoesNotBroadcast(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name     string
		snapshot postgres.GenerationSnapshot
	}{
		{"non-terminal snapshot", postgres.GenerationSnapshot{Status: "IN_PROGRESS"}},
		{"different terminal won", postgres.GenerationSnapshot{Status: "CANCELLED"}},
	} {
		store := &terminalTestStore{terminalErr: errors.New("persist unavailable"), snapshot: tc.snapshot}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), companion.PhaseFailed, "OUTBOUND_CHECK"); err == nil {
			t.Fatalf("%s: expected persist error to propagate", tc.name)
		}
		if got := nextTerminalEvent(t, sub); got != "" {
			t.Fatalf("%s: unexpected terminal event %q", tc.name, got)
		}
	}
}

func TestTerminalWithConfirmedSnapshotBroadcastsSnapshotState(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		phase  companion.Phase
		status string
		want   companion.PublicEvent
	}{
		{companion.PhaseFailed, "FAILED_FINAL", companion.EventFailed},
		{companion.PhaseBlocked, "OUTPUT_BLOCKED", companion.EventBlocked},
		{companion.PhaseCancelled, "CANCELLED", companion.EventCancelled},
	} {
		store := &terminalTestStore{terminalErr: errors.New("persist unavailable"), snapshot: postgres.GenerationSnapshot{Status: tc.status}}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), tc.phase, "REASON"); err == nil {
			t.Fatalf("phase %s: expected persist error to propagate", tc.phase)
		}
		if got := nextTerminalEvent(t, sub); got != tc.want {
			t.Fatalf("phase %s status %s event %q, want %q", tc.phase, tc.status, got, tc.want)
		}
	}
}

func TestTerminalAttemptBroadcastsPerPersistConfirmation(t *testing.T) {
	t.Parallel()
	last := turn.Result{
		Phase:   companion.PhaseBlocked,
		Public:  companion.EventBlocked,
		Attempt: companion.AttemptOutcome{AttemptID: "att-1"},
	}
	t.Run("persist succeeds", func(t *testing.T) {
		t.Parallel()
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(&terminalTestStore{}, nil, hub, nil)
		if err := loop.terminalAttempt(context.Background(), terminalTestClaim(), last); err != nil {
			t.Fatal(err)
		}
		if got := nextTerminalEvent(t, sub); got != companion.EventBlocked {
			t.Fatalf("event %q, want %q", got, companion.EventBlocked)
		}
	})
	t.Run("persist fails without confirm", func(t *testing.T) {
		t.Parallel()
		store := &terminalTestStore{terminalErr: errors.New("persist unavailable")}
		store.snapshot = postgres.GenerationSnapshot{Status: "IN_PROGRESS"}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminalAttempt(context.Background(), terminalTestClaim(), last); err == nil {
			t.Fatal("expected persist error to propagate")
		}
		if got := nextTerminalEvent(t, sub); got != "" {
			t.Fatalf("unexpected terminal event %q", got)
		}
	})
	t.Run("persist fails but snapshot confirms", func(t *testing.T) {
		t.Parallel()
		store := &terminalTestStore{terminalErr: errors.New("persist unavailable")}
		store.snapshot = postgres.GenerationSnapshot{Status: "OUTPUT_BLOCKED"}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminalAttempt(context.Background(), terminalTestClaim(), last); err == nil {
			t.Fatal("expected persist error to propagate")
		}
		if got := nextTerminalEvent(t, sub); got != companion.EventBlocked {
			t.Fatalf("event %q, want %q", got, companion.EventBlocked)
		}
	})
}

func TestRetryFinalizeExhaustionDoesNotBroadcastWithoutConfirm(t *testing.T) {
	t.Parallel()
	store := &terminalTestStore{
		finalizeErr: errors.New("finalize persist unavailable"),
		terminalErr: errors.New("terminalize persist unavailable"),
	}
	store.snapshot = postgres.GenerationSnapshot{Status: "IN_PROGRESS"}
	hub, sub := subscribeGenerationHub(t, "5")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, hub, nil)
	last := turn.Result{Text: "hello", Attempt: companion.AttemptOutcome{AttemptID: "att-1"}}
	if err := loop.retryFinalize(context.Background(), terminalTestClaim(), last); err == nil {
		t.Fatal("expected finalize error to propagate")
	}
	if got := nextTerminalEvent(t, sub); got != "" {
		t.Fatalf("unexpected terminal event %q without confirmed terminal state", got)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.finalizeCalls != 3 {
		t.Fatalf("finalize calls %d, want 3", store.finalizeCalls)
	}
	if store.terminalCalls != 1 {
		t.Fatalf("terminalize calls %d, want 1", store.terminalCalls)
	}
}

func TestRetryFinalizeTerminalizedBroadcastsFailed(t *testing.T) {
	t.Parallel()
	store := &terminalTestStore{finalizeErr: errors.New("finalize persist unavailable")}
	hub, sub := subscribeGenerationHub(t, "5")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, hub, nil)
	last := turn.Result{Text: "hello", Attempt: companion.AttemptOutcome{AttemptID: "att-1"}}
	if err := loop.retryFinalize(context.Background(), terminalTestClaim(), last); err == nil {
		t.Fatal("expected finalize error to propagate")
	}
	if got := nextTerminalEvent(t, sub); got != companion.EventFailed {
		t.Fatalf("event %q, want %q", got, companion.EventFailed)
	}
}

func TestRetryFinalizeFinalizeSuccessBroadcastsCompleted(t *testing.T) {
	t.Parallel()
	store := &terminalTestStore{}
	hub, sub := subscribeGenerationHub(t, "5")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, hub, nil)
	last := turn.Result{Text: "hello", Attempt: companion.AttemptOutcome{AttemptID: "att-1"}}
	if err := loop.retryFinalize(context.Background(), terminalTestClaim(), last); err != nil {
		t.Fatal(err)
	}
	if got := nextTerminalEvent(t, sub); got != companion.EventCompleted {
		t.Fatalf("event %q, want %q", got, companion.EventCompleted)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.finalizeCalls != 1 || store.terminalCalls != 0 {
		t.Fatalf("finalize calls %d terminalize calls %d", store.finalizeCalls, store.terminalCalls)
	}
}

// raceTerminalStore mirrors vc.go_terminalize_generation's race semantics: the
// first terminalize persists its phase and every later caller is told the
// already-stored terminal status.
type raceTerminalStore struct {
	Store
	mu  sync.Mutex
	won string
}

func (s *raceTerminalStore) TerminalizeGeneration(_ context.Context, cmd turn.TerminalCommand) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.won == "" {
		s.won = turn.TerminalStatusFor(cmd.Phase)
	}
	return s.won, nil
}

func (s *raceTerminalStore) winner() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.won
}

func TestTerminalBroadcastsActuallyPersistedStatus(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name           string
		phase          companion.Phase
		terminalStatus string
		want           companion.PublicEvent
	}{
		{"failed request lands as requested", companion.PhaseFailed, "FAILED_FINAL", companion.EventFailed},
		{"blocked request lands as requested", companion.PhaseBlocked, "OUTPUT_BLOCKED", companion.EventBlocked},
		{"cancel request lands as requested", companion.PhaseCancelled, "CANCELLED", companion.EventCancelled},
		{"cancel request loses to failed final", companion.PhaseCancelled, "FAILED_FINAL", companion.EventFailed},
		{"failed request loses to cancel", companion.PhaseFailed, "CANCELLED", companion.EventCancelled},
		{"blocked request loses to cancel", companion.PhaseBlocked, "CANCELLED", companion.EventCancelled},
	} {
		store := &terminalTestStore{terminalStatus: tc.terminalStatus}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), tc.phase, "REASON"); err != nil {
			t.Fatalf("%s: racing on a persisted terminal must not error: %v", tc.name, err)
		}
		if got := nextTerminalEvent(t, sub); got != tc.want {
			t.Fatalf("%s: event %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestTerminalAttemptBroadcastsActuallyPersistedStatusOnRace(t *testing.T) {
	t.Parallel()
	provider := &routeProvider{}
	hub, sub := subscribeGenerationHub(t, "5")
	store := &terminalTestStore{terminalStatus: "CANCELLED"}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, hub, nil)
	last := turn.Result{
		Phase:   companion.PhaseFailed,
		Public:  companion.EventFailed,
		Attempt: companion.AttemptOutcome{AttemptID: "att-1"},
	}
	if err := loop.terminalAttempt(context.Background(), terminalTestClaim(), last); err != nil {
		t.Fatal(err)
	}
	if got := nextTerminalEvent(t, sub); got != companion.EventCancelled {
		t.Fatalf("event %q, want %q for actually persisted CANCELLED", got, companion.EventCancelled)
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls %d, want 0 (terminal path must not call provider)", provider.calls)
	}
}

func TestTerminalCancelAndFailRaceBroadcastPersistedWinner(t *testing.T) {
	t.Parallel()
	store := &raceTerminalStore{}
	provider := &routeProvider{}
	hub, sub := subscribeGenerationHub(t, "5")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, hub, nil)

	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, phase := range []companion.Phase{companion.PhaseCancelled, companion.PhaseFailed} {
		phase := phase
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- loop.terminal(context.Background(), terminalTestClaim(), phase, "REASON")
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("race loser must not error: %v", err)
		}
	}
	// The hub closes a generation on its first terminal event, so subscribers
	// observe exactly one terminal broadcast and it must match the durable
	// winner the racing paths both reported.
	want := persistedTerminalEvent(store.winner())
	first := nextTerminalEvent(t, sub)
	if first != want {
		t.Fatalf("event %q, want %q for persisted winner %s", first, want, store.winner())
	}
	if provider.calls != 0 {
		t.Fatalf("provider calls %d, want 0 on terminal race path", provider.calls)
	}
}

func TestTerminalEmptyPersistedStatusFallsBackToSnapshot(t *testing.T) {
	t.Parallel()
	t.Run("snapshot confirms requested phase", func(t *testing.T) {
		t.Parallel()
		store := &terminalTestStore{emptyStatus: true, snapshot: postgres.GenerationSnapshot{Status: "FAILED_FINAL"}}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), companion.PhaseFailed, "REASON"); err != nil {
			t.Fatal(err)
		}
		if got := nextTerminalEvent(t, sub); got != companion.EventFailed {
			t.Fatalf("event %q, want %q", got, companion.EventFailed)
		}
	})
	t.Run("snapshot shows other state", func(t *testing.T) {
		t.Parallel()
		store := &terminalTestStore{emptyStatus: true, snapshot: postgres.GenerationSnapshot{Status: "CANCELLED"}}
		hub, sub := subscribeGenerationHub(t, "5")
		loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
		loop.Use(store, nil, hub, nil)
		if err := loop.terminal(context.Background(), terminalTestClaim(), companion.PhaseFailed, "REASON"); err != nil {
			t.Fatal(err)
		}
		if got := nextTerminalEvent(t, sub); got != "" {
			t.Fatalf("unexpected terminal event %q", got)
		}
	})
}

func TestRetryFinalizeTerminalizeRaceBroadcastsPersistedStatus(t *testing.T) {
	t.Parallel()
	store := &terminalTestStore{
		finalizeErr:    errors.New("finalize persist unavailable"),
		terminalStatus: "CANCELLED",
	}
	hub, sub := subscribeGenerationHub(t, "5")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, hub, nil)
	last := turn.Result{Text: "hello", Attempt: companion.AttemptOutcome{AttemptID: "att-1"}}
	if err := loop.retryFinalize(context.Background(), terminalTestClaim(), last); err == nil {
		t.Fatal("expected finalize error to propagate")
	}
	if got := nextTerminalEvent(t, sub); got != companion.EventCancelled {
		t.Fatalf("event %q, want %q for actually persisted CANCELLED", got, companion.EventCancelled)
	}
}

// finalizeFailStore fails every persist and exposes the authoritative snapshot
// as non-terminal, driving the handleGeneration retryFinalize path end to end.
type finalizeFailStore struct {
	*concurrencyStore
	snapshot      postgres.GenerationSnapshot
	finalizeCalls int
	terminalCalls int
}

func (s *finalizeFailStore) FinalizeGeneration(context.Context, turn.FinalizeCommand) error {
	s.finalizeCalls++
	return errors.New("finalize persist unavailable")
}

func (s *finalizeFailStore) TerminalizeGeneration(context.Context, turn.TerminalCommand) (string, error) {
	s.terminalCalls++
	return "", errors.New("terminalize persist unavailable")
}

func (s *finalizeFailStore) GenerationSnapshot(context.Context, int64, int64) (postgres.GenerationSnapshot, error) {
	return s.snapshot, nil
}

func TestGenerationFinalizeFailureDoesNotRegenerateOrBroadcast(t *testing.T) {
	t.Parallel()
	base := newConcurrencyStore(1)
	store := &finalizeFailStore{
		concurrencyStore: base,
		snapshot:         postgres.GenerationSnapshot{Status: "IN_PROGRESS"},
	}
	provider := &routeProvider{text: "我在。"}
	hub, sub := subscribeGenerationHub(t, "1")
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, hub, nil)
	if err := loop.handleGeneration(context.Background(), base.claims[0], "finalize-test"); err == nil {
		t.Fatal("expected finalize failure to propagate")
	}
	if provider.calls != 1 {
		t.Fatalf("provider calls %d, want 1 (terminal path must not regenerate)", provider.calls)
	}
	if store.finalizeCalls != 4 {
		t.Fatalf("finalize calls %d, want 4 (coordinator + 3 retries)", store.finalizeCalls)
	}
	if store.terminalCalls != 1 {
		t.Fatalf("terminalize calls %d, want 1", store.terminalCalls)
	}
	if got := nextTerminalEvent(t, sub); got != "" {
		t.Fatalf("unexpected terminal event %q", got)
	}
}

// EnqueueMemoryExtract stands in for the V125 trigger on the retryFinalize
// success path; real dedup lives in the SQL function.
func (s *terminalTestStore) EnqueueMemoryExtract(context.Context, int64, int64) (int64, error) {
	return 0, nil
}
