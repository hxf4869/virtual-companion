package turn

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/safety"
)

// ctxProbeStore wraps MemStore and records the contexts the coordinator hands
// to finalization writes. stallRecord/stallTerm simulate a context-aware store
// stuck on a slow write (like a stalled database): the call only returns when
// the caller's context deadline fires, so the finalize deadline must be what
// ends the turn.
type ctxProbeStore struct {
	*MemStore
	recordCtxs  []context.Context
	termCtxs    []context.Context
	recordErrAt []error
	termErrAt   []error
	stallRecord bool
	stallTerm   bool
}

func (s *ctxProbeStore) RecordAttemptOutcome(ctx context.Context, outcome companion.AttemptOutcome) error {
	s.recordErrAt = append(s.recordErrAt, ctx.Err())
	s.recordCtxs = append(s.recordCtxs, ctx)
	if s.stallRecord {
		<-ctx.Done()
		return ctx.Err()
	}
	return s.MemStore.RecordAttemptOutcome(ctx, outcome)
}

func (s *ctxProbeStore) TerminalizeGeneration(ctx context.Context, cmd TerminalCommand) (string, error) {
	s.termErrAt = append(s.termErrAt, ctx.Err())
	s.termCtxs = append(s.termCtxs, ctx)
	if s.stallTerm {
		<-ctx.Done()
		return "", ctx.Err()
	}
	return s.MemStore.TerminalizeGeneration(ctx, cmd)
}

// cancelMidStreamProvider emits one delta, then cancels the turn context and
// reports a canceled provider call, like a user cancel racing the stream.
type cancelMidStreamProvider struct {
	cancel context.CancelFunc
	calls  int
}

func (p *cancelMidStreamProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls++
	if err := emit(companion.OutputDelta{Text: "前半"}); err != nil {
		return companion.AttemptResult{}, err
	}
	p.cancel()
	return companion.AttemptResult{}, companion.Canceled(companion.DeliveryUnknown)
}

func boundedDeadline(errAtCall error, ctx context.Context, limit time.Duration) bool {
	if errAtCall != nil {
		return false
	}
	d, ok := ctx.Deadline()
	if !ok {
		return false
	}
	remaining := time.Until(d)
	return remaining > 0 && remaining <= limit
}

func TestCancelAfterPreparePersistsWithBoundedLiveContext(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"x"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 1}}}
	store := &ctxProbeStore{MemStore: NewMemStore()}
	store.PutSeed(baseSeed())
	c := &Coordinator{Store: store, Provider: p, Policy: safety.New()}
	type ctxKey struct{}
	parent := context.WithValue(context.Background(), ctxKey{}, "owner-binding")
	ctx, cancel := context.WithCancel(parent)
	cancel()
	res := c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-fin1", Budget: budget()})
	if p.calls != 0 {
		t.Fatal("provider called after cancel")
	}
	if res.Public != companion.EventCancelled {
		t.Fatalf("%+v", res)
	}
	if len(store.recordCtxs) != 1 || len(store.termCtxs) != 1 {
		t.Fatalf("finalize writes not attempted: %d/%d", len(store.recordCtxs), len(store.termCtxs))
	}
	for name, i := range map[string]int{"record": 0, "terminal": 0} {
		ctxs, errs := store.recordCtxs, store.recordErrAt
		if name == "terminal" {
			ctxs, errs = store.termCtxs, store.termErrAt
		}
		if !boundedDeadline(errs[i], ctxs[i], c.finWriteTimeout()) {
			t.Fatalf("%s context not live with bounded deadline at call time: err=%v", name, errs[i])
		}
	}
	if store.recordCtxs[0].Value(ctxKey{}) != "owner-binding" {
		t.Fatal("finalize context lost parent values")
	}
	if store.Phase("turn-1") != companion.PhaseCancelled {
		t.Fatalf("durable phase %s", store.Phase("turn-1"))
	}
}

func TestCancelDuringStreamPersistsOutcomeAndTerminal(t *testing.T) {
	t.Parallel()
	store := &ctxProbeStore{MemStore: NewMemStore()}
	store.PutSeed(baseSeed())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	p := &cancelMidStreamProvider{cancel: cancel}
	c := &Coordinator{Store: store, Provider: p, Policy: safety.New()}
	res := c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-fin2", Budget: budget()})
	if p.calls != 1 {
		t.Fatalf("provider calls %d", p.calls)
	}
	if res.Public != companion.EventCancelled {
		t.Fatalf("%+v", res)
	}
	if len(store.recordCtxs) != 1 || len(store.termCtxs) != 1 {
		t.Fatalf("finalize writes not attempted: %d/%d", len(store.recordCtxs), len(store.termCtxs))
	}
	if !boundedDeadline(store.recordErrAt[0], store.recordCtxs[0], c.finWriteTimeout()) {
		t.Fatal("outcome context must be live and bounded after mid-stream cancel")
	}
	if !boundedDeadline(store.termErrAt[0], store.termCtxs[0], c.finWriteTimeout()) {
		t.Fatal("terminal context must be live and bounded after mid-stream cancel")
	}
	if store.Phase("turn-1") != companion.PhaseCancelled {
		t.Fatalf("durable phase %s", store.Phase("turn-1"))
	}
}

func TestStalledFinalizeWriteEndsWithinDeadline(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"x"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 1}}}
	store := &ctxProbeStore{MemStore: NewMemStore(), stallRecord: true, stallTerm: true}
	store.PutSeed(baseSeed())
	c := &Coordinator{Store: store, Provider: p, Policy: safety.New(), finalizeWriteTimeout: 150 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan Result, 1)
	go func() { done <- c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-fin3", Budget: budget()}) }()
	select {
	case res := <-done:
		if res.Public != companion.EventCancelled {
			t.Fatalf("process-local phase must still report cancelled: %+v", res)
		}
	case <-time.After(c.finWriteTimeout() + 3*time.Second):
		t.Fatal("finalize writes did not end within the deadline")
	}
}

func TestUnconfirmedFinalizeWriteIsNotBroadcastAsTerminal(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"x"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 1}}}
	store := &ctxProbeStore{MemStore: NewMemStore(), stallRecord: true, stallTerm: true}
	store.PutSeed(baseSeed())
	c := &Coordinator{Store: store, Provider: p, Policy: safety.New(), finalizeWriteTimeout: 150 * time.Millisecond}
	hub := realtime.New()
	c.Hub = hub
	hub.Accepted("turn-1")
	sub, err := hub.Subscribe("turn-1")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-fin4", Budget: budget()})
	if res.Public == "" {
		t.Fatal("caller keeps the process-local phase")
	}
	for _, ev := range drainSub(t, sub) {
		if ev.Terminal() {
			t.Fatalf("unconfirmed terminal persisted state must not be broadcast, got %v", ev.Name)
		}
	}
}
