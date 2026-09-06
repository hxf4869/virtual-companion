package turn

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/safety"
)

// terminalInjectStore wraps MemStore so a test can fail TerminalizeGeneration,
// report an empty status, or override the durable status it returns — the
// latter simulating a concurrent path that won the terminal race with a
// different terminal state.
type terminalInjectStore struct {
	*MemStore
	mu     sync.Mutex
	err    error
	empty  bool
	status string // forced durable status; "" = TerminalStatusFor(phase)
	calls  int
}

func (s *terminalInjectStore) TerminalizeGeneration(ctx context.Context, cmd TerminalCommand) (string, error) {
	s.mu.Lock()
	s.calls++
	err, empty, status := s.err, s.empty, s.status
	s.mu.Unlock()
	if err != nil {
		return "", err
	}
	if empty {
		return "", nil
	}
	stored := status
	if stored == "" {
		stored = TerminalStatusFor(cmd.Phase)
	}
	if _, err := s.MemStore.TerminalizeGeneration(ctx, cmd); err != nil {
		return stored, err
	}
	return stored, nil
}

func (s *terminalInjectStore) inject(err error, empty bool, status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.err, s.empty, s.status = err, empty, status
}

// deniedPrepareInjectStore adds the outbound-denied prepare gate on top of the
// injectable terminalize store.
type deniedPrepareInjectStore struct {
	*terminalInjectStore
}

func (s deniedPrepareInjectStore) PrepareAttempt(context.Context, PrepareAttempt) (PreparedAttempt, error) {
	return PreparedAttempt{}, ErrOutboundDenied
}

// terminalCase drives one Coordinator.Run into a distinct TerminalizeGeneration
// call site and records the outcome the coordinator observes on the normal
// (persist-succeeds) path.
type terminalCase struct {
	name      string
	provider  *scripted
	seed      func() ContextSeed
	noSeed    bool
	denyPrep  bool
	cancelled bool
	budget    func() companion.TurnBudget
	phase     companion.Phase // observed phase on the normal path
	pub       companion.PublicEvent
	calls     int // expected provider calls
}

var terminalCases = []terminalCase{
	{
		name:   "seed missing",
		noSeed: true,
		phase:  companion.PhaseFailed, pub: companion.EventFailed,
	},
	{
		name: "input review blocked",
		seed: func() ContextSeed {
			s := baseSeed()
			s.CurrentUserMessage = "我想自杀"
			return s
		},
		phase: companion.PhaseBlocked, pub: companion.EventBlocked,
	},
	{
		name: "plan required category denied",
		seed: func() ContextSeed {
			s := baseSeed()
			s.AllowedCategories = []DataCategory{CategorySafety}
			return s
		},
		phase: companion.PhaseBlocked, pub: companion.EventBlocked,
	},
	{
		name:   "plan required overflow",
		budget: func() companion.TurnBudget { b := budget(); b.MaxInputTokens = 0; return b },
		phase:  companion.PhaseFailed, pub: companion.EventFailed,
	},
	{
		name:     "outbound denied at prepare",
		denyPrep: true,
		phase:    companion.PhaseBlocked, pub: companion.EventBlocked,
	},
	{
		name:      "cancelled before stream",
		cancelled: true,
		phase:     companion.PhaseCancelled, pub: companion.EventCancelled,
	},
	{
		name: "stream blocked by rolling review",
		provider: &scripted{
			deltas: []string{"今天天气不错。", "其实我是真人。"},
			result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 4}},
		},
		phase: companion.PhaseBlocked, pub: companion.EventBlocked,
		calls: 1,
	},
	{
		name: "stream failed after published delta",
		provider: &scripted{
			deltas: []string{"partial"},
			err:    companion.Disconnected(companion.DeliveryNotSent),
		},
		phase: companion.PhaseFailed, pub: companion.EventFailed,
		calls: 1,
	},
}

// terminalRun is the observable outcome of one scenario execution.
type terminalRun struct {
	res       Result
	hubEv     companion.PublicEvent
	calls     int
	memPhase  companion.Phase
	termCalls int
}

// execute runs the scenario against the given store and returns its outcome.
func (tc terminalCase) execute(t *testing.T, store *terminalInjectStore) terminalRun {
	t.Helper()
	provider := &scripted{}
	if tc.provider != nil {
		// Clone per run: calls is a mutable counter and subtests run parallel.
		*provider = *tc.provider
	}
	hub := realtime.New()
	hub.Accepted("turn-1")
	sub, err := hub.Subscribe("turn-1")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sub.Close)
	c := &Coordinator{Store: store, Provider: provider, Policy: safety.New(), Hub: hub}
	if !tc.noSeed {
		seed := baseSeed()
		if tc.seed != nil {
			seed = tc.seed()
		}
		store.PutSeed(seed)
	}
	if tc.denyPrep {
		c.Store = deniedPrepareInjectStore{terminalInjectStore: store}
	}
	b := budget()
	if tc.budget != nil {
		b = tc.budget()
	}
	ctx := context.Background()
	if tc.cancelled {
		ctx = cancelledContext()
	}
	res := c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-terminal", Budget: b})
	return terminalRun{
		res:       res,
		hubEv:     nextTurnTerminalEvent(t, sub),
		calls:     provider.calls,
		memPhase:  store.Phase("turn-1"),
		termCalls: store.calls,
	}
}

func cancelledContext() context.Context {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	return ctx
}

// nextTurnTerminalEvent drains buffered events and returns the first terminal
// event, or "" when none arrives before the deadline.
func nextTurnTerminalEvent(t *testing.T, sub *realtime.Sub) companion.PublicEvent {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
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

func terminalCaseByName(t *testing.T, name string) terminalCase {
	t.Helper()
	for _, tc := range terminalCases {
		if tc.name == name {
			return tc
		}
	}
	t.Fatalf("unknown terminal case %q", name)
	return terminalCase{}
}

// Persist error means the durable terminal state is unconfirmed: the turn
// Store has no snapshot read to reconcile against, so nothing is broadcast and
// the Result keeps the observed process-local outcome.
func TestCoordinatorTerminalPersistErrorDoesNotBroadcast(t *testing.T) {
	t.Parallel()
	for _, tc := range terminalCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &terminalInjectStore{MemStore: NewMemStore()}
			store.inject(errors.New("terminalize persist unavailable"), false, "")
			run := tc.execute(t, store)
			if run.hubEv != "" {
				t.Fatalf("unexpected terminal broadcast %q", run.hubEv)
			}
			if run.res.Phase != tc.phase || run.res.Public != tc.pub {
				t.Fatalf("result %+v, want %s/%s", run.res, tc.phase, tc.pub)
			}
			if !run.res.Withdraw {
				t.Fatalf("result must withdraw: %+v", run.res)
			}
			if run.calls != tc.calls {
				t.Fatalf("provider calls %d, want %d", run.calls, tc.calls)
			}
			if run.termCalls != 1 {
				t.Fatalf("terminalize calls %d, want 1", run.termCalls)
			}
		})
	}
}

// Normal persist: the broadcast and Result follow the requested phase — the
// store reports the status that requested phase lands on.
func TestCoordinatorTerminalNormalPersistBroadcastsRequestedPhase(t *testing.T) {
	t.Parallel()
	for _, tc := range terminalCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &terminalInjectStore{MemStore: NewMemStore()}
			run := tc.execute(t, store)
			if run.hubEv != tc.pub {
				t.Fatalf("hub event %q, want %q", run.hubEv, tc.pub)
			}
			if run.res.Phase != tc.phase || run.res.Public != tc.pub {
				t.Fatalf("result %+v, want %s/%s", run.res, tc.phase, tc.pub)
			}
			if run.memPhase != tc.phase {
				t.Fatalf("durable phase %s, want %s", run.memPhase, tc.phase)
			}
			if run.calls != tc.calls {
				t.Fatalf("provider calls %d, want %d", run.calls, tc.calls)
			}
		})
	}
}

// A concurrent path can win the durable terminal race: the broadcast and the
// Result must follow the status the store actually persisted, not the
// requested phase. An empty or completed return confirms no non-completed
// terminal state, so nothing is broadcast and the observed outcome is kept.
func TestCoordinatorTerminalFollowsActuallyPersistedStatus(t *testing.T) {
	t.Parallel()
	for _, row := range []struct {
		name      string
		caseName  string
		status    string
		empty     bool
		want      companion.PublicEvent // "" = no broadcast expected
		wantPhase companion.Phase
	}{
		{"blocked request loses to cancel", "input review blocked", "CANCELLED", false, companion.EventCancelled, companion.PhaseCancelled},
		{"blocked request loses to failed", "input review blocked", "FAILED_FINAL", false, companion.EventFailed, companion.PhaseFailed},
		{"blocked request lands input blocked", "plan required category denied", "INPUT_BLOCKED", false, companion.EventBlocked, companion.PhaseBlocked},
		{"stream blocked loses to failed", "stream blocked by rolling review", "FAILED_FINAL", false, companion.EventFailed, companion.PhaseFailed},
		{"failed request loses to cancel", "stream failed after published delta", "CANCELLED", false, companion.EventCancelled, companion.PhaseCancelled},
		{"failed request loses to output blocked", "stream failed after published delta", "OUTPUT_BLOCKED", false, companion.EventBlocked, companion.PhaseBlocked},
		{"cancel request loses to failed", "cancelled before stream", "FAILED_FINAL", false, companion.EventFailed, companion.PhaseFailed},
		{"prepare gate loses to cancel", "outbound denied at prepare", "CANCELLED", false, companion.EventCancelled, companion.PhaseCancelled},
		{"seed missing loses to cancel", "seed missing", "CANCELLED", false, companion.EventCancelled, companion.PhaseCancelled},
		{"race won by completion", "stream failed after published delta", "COMPLETED", false, "", companion.PhaseFailed},
		{"race won by fallback completion", "stream failed after published delta", "COMPLETED_FALLBACK", false, "", companion.PhaseFailed},
		{"empty status stays unconfirmed", "input review blocked", "", true, "", companion.PhaseBlocked},
	} {
		row := row
		t.Run(row.name, func(t *testing.T) {
			t.Parallel()
			tc := terminalCaseByName(t, row.caseName)
			store := &terminalInjectStore{MemStore: NewMemStore()}
			store.inject(nil, row.empty, row.status)
			run := tc.execute(t, store)
			if run.hubEv != row.want {
				t.Fatalf("hub event %q, want %q", run.hubEv, row.want)
			}
			if run.res.Phase != row.wantPhase {
				t.Fatalf("result phase %s, want %s (%+v)", run.res.Phase, row.wantPhase, run.res)
			}
			wantPub := row.want
			if wantPub == "" {
				wantPub = tc.pub
			}
			if run.res.Public != wantPub {
				t.Fatalf("result public %q, want %q", run.res.Public, wantPub)
			}
			if run.calls != tc.calls {
				t.Fatalf("provider calls %d, want %d (mapping must not regenerate)", run.calls, tc.calls)
			}
		})
	}
}

// raceWinner is shared between stores so whichever coordinator terminalizes
// first owns the durable winner, mirroring vc.go_terminalize_generation's
// first-writer-wins race.
type raceWinner struct {
	mu  sync.Mutex
	won string
}

func (w *raceWinner) status() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.won
}

type raceTerminalStore struct {
	*MemStore
	winner *raceWinner
}

func (s *raceTerminalStore) TerminalizeGeneration(_ context.Context, cmd TerminalCommand) (string, error) {
	s.winner.mu.Lock()
	defer s.winner.mu.Unlock()
	if s.winner.won == "" {
		s.winner.won = TerminalStatusFor(cmd.Phase)
	}
	return s.winner.won, nil
}

// A cancel and a block racing on the same generation: both coordinators must
// report and broadcast the persisted winner, and neither may call the
// provider from a terminal path.
func TestCoordinatorCancelAndBlockRaceFollowsPersistedWinner(t *testing.T) {
	t.Parallel()
	winner := &raceWinner{}
	mk := func(seed ContextSeed) (*Coordinator, *scripted, *realtime.Sub) {
		store := &raceTerminalStore{MemStore: NewMemStore(), winner: winner}
		store.PutSeed(seed)
		p := &scripted{}
		hub := realtime.New()
		hub.Accepted("turn-1")
		sub, err := hub.Subscribe("turn-1")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(sub.Close)
		return &Coordinator{Store: store, Provider: p, Policy: safety.New(), Hub: hub}, p, sub
	}
	coordC, providerC, subC := mk(baseSeed())
	blockedSeed := baseSeed()
	blockedSeed.AllowedCategories = []DataCategory{CategorySafety}
	coordB, providerB, subB := mk(blockedSeed)

	var wg sync.WaitGroup
	var resC, resB Result
	wg.Add(2)
	go func() {
		defer wg.Done()
		resC = coordC.Run(cancelledContext(), Command{TurnID: "turn-1", RunID: "run-race-c", Budget: budget()})
	}()
	go func() {
		defer wg.Done()
		resB = coordB.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-race-b", Budget: budget()})
	}()
	wg.Wait()

	won := winner.status()
	phase, ev, ok := persistedTerminal(won)
	if !ok {
		t.Fatalf("persisted winner %q is not a supported terminal", won)
	}
	if resC.Phase != phase || resC.Public != ev {
		t.Fatalf("cancel result %+v, want %s/%s for winner %s", resC, phase, ev, won)
	}
	if resB.Phase != phase || resB.Public != ev {
		t.Fatalf("block result %+v, want %s/%s for winner %s", resB, phase, ev, won)
	}
	if got := nextTurnTerminalEvent(t, subC); got != ev {
		t.Fatalf("cancel hub event %q, want %q", got, ev)
	}
	if got := nextTurnTerminalEvent(t, subB); got != ev {
		t.Fatalf("block hub event %q, want %q", got, ev)
	}
	if providerC.calls != 0 || providerB.calls != 0 {
		t.Fatalf("provider calls %d/%d, want 0 on terminal race path", providerC.calls, providerB.calls)
	}
}
