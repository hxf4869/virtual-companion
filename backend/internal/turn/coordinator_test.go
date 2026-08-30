package turn

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/safety"
)

type scripted struct {
	deltas []string
	result companion.AttemptResult
	err    error
	calls  int
}

type deniedPrepareStore struct{ *MemStore }

func (s deniedPrepareStore) PrepareAttempt(context.Context, PrepareAttempt) (PreparedAttempt, error) {
	return PreparedAttempt{}, ErrOutboundDenied
}

func (s *scripted) Stream(ctx context.Context, req companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	s.calls++
	for _, d := range s.deltas {
		if ctx.Err() != nil {
			return companion.AttemptResult{}, companion.Canceled(companion.DeliveryUnknown)
		}
		if err := emit(companion.OutputDelta{Text: d}); err != nil {
			return companion.AttemptResult{}, err
		}
	}
	if s.err != nil {
		return companion.AttemptResult{}, s.err
	}
	return s.result, nil
}

func newCoord(t *testing.T, p companion.Provider, seed ContextSeed) (*Coordinator, *MemStore, *bytes.Buffer) {
	t.Helper()
	store := NewMemStore()
	store.PutSeed(seed)
	buf := &bytes.Buffer{}
	log := observability.NewLogger("info", buf)
	return &Coordinator{Store: store, Provider: p, Policy: safety.New(), Log: log}, store, buf
}

func TestCoordinatorCompletesReviewedStream(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"听起来你今天真的很累。"},
		result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 8, OutputTokens: 6, TotalTokens: 14}},
	}
	c, store, _ := newCoord(t, p, baseSeed())
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-a", Budget: budget()})
	if res.Phase != companion.PhaseCompleted || res.Public != companion.EventCompleted {
		t.Fatalf("got %+v", res)
	}
	if store.FinalText("turn-1") != "听起来你今天真的很累。" {
		t.Fatalf("final %q", store.FinalText("turn-1"))
	}
	if res.Attempt.Billing != companion.BillingUsageReported {
		t.Fatalf("billing %+v", res.Attempt)
	}
}

func TestInputSafetyBlocksWithoutProviderOrFinalText(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"should-not-run"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 1}}}
	seed := baseSeed()
	seed.CurrentUserMessage = "我想自杀"
	c, store, _ := newCoord(t, p, seed)
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-b", Budget: budget()})
	if p.calls != 0 {
		t.Fatal("provider called")
	}
	if res.Public != companion.EventBlocked || res.Phase != companion.PhaseBlocked {
		t.Fatalf("%+v", res)
	}
	if store.FinalText("turn-1") != "" {
		t.Fatal("blocked turn persisted text")
	}
	if res.SafetyCode != "input-imminent-self-harm" {
		t.Fatalf("code %s", res.SafetyCode)
	}
}

func TestPrepareGateChangeBlocksWithoutProvider(t *testing.T) {
	t.Parallel()
	provider := &scripted{
		deltas: []string{"should-not-run"},
		result: companion.AttemptResult{Finish: companion.FinishStop},
	}
	mem := NewMemStore()
	mem.PutSeed(baseSeed())
	coord := &Coordinator{
		Store: deniedPrepareStore{MemStore: mem}, Provider: provider,
		Policy: safety.New(), Log: observability.NewLogger("error", bytes.NewBuffer(nil)),
	}
	res := coord.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-gate", Budget: budget()})
	if provider.calls != 0 {
		t.Fatal("provider called after prepare gate denial")
	}
	if res.Phase != companion.PhaseBlocked || res.Public != companion.EventBlocked || res.SafetyCode != "OUTBOUND_DENIED" {
		t.Fatalf("result %+v", res)
	}
	if mem.Phase("turn-1") != companion.PhaseBlocked {
		t.Fatalf("durable phase %s", mem.Phase("turn-1"))
	}
}

func TestRollingSafetyDoesNotCompleteAndClearsDraft(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"今天天气不错。", "其实我是真人。"},
		result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 4}},
	}
	c, store, _ := newCoord(t, p, baseSeed())
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-c", Budget: budget()})
	if res.Public == companion.EventCompleted {
		t.Fatal("must not complete")
	}
	if res.Public != companion.EventBlocked || !res.Withdraw {
		t.Fatalf("%+v", res)
	}
	if store.FinalText("turn-1") != "" {
		t.Fatal("partial persisted")
	}
	if len(res.Published) != 1 || res.Published[0] != "今天天气不错。" {
		t.Fatalf("published %#v", res.Published)
	}
	if MapPublicTerminal(res.Phase, false) == companion.EventCompleted {
		t.Fatal("mapping")
	}
}

func TestProviderFailureDoesNotRetryOnUnknownOutbound(t *testing.T) {
	t.Parallel()
	p := &scripted{err: companion.Disconnected(companion.DeliveryUnknown)}
	c, store, _ := newCoord(t, p, baseSeed())
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-d", Budget: budget()})
	if res.Public != companion.EventFailed {
		t.Fatalf("%+v", res)
	}
	if res.RetryAllowed {
		t.Fatal("unknown outbound must not retry")
	}
	if store.FinalText("turn-1") != "" {
		t.Fatal("text")
	}
}

func TestCancelBeforeStream(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"x"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 1}}}
	c, _, _ := newCoord(t, p, baseSeed())
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	res := c.Run(ctx, Command{TurnID: "turn-1", RunID: "run-e", Budget: budget()})
	if res.Public != companion.EventCancelled && res.Public != companion.EventFailed {
		t.Fatalf("%+v", res)
	}
}

func TestLogsOmitBodiesAndIdentifiers(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"嗯。"},
		result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2}},
	}
	seed := baseSeed()
	seed.CurrentUserMessage = "私密倾诉正文不得出现在日志"
	c, _, buf := newCoord(t, p, seed)
	_ = c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-log", Budget: budget()})
	raw := buf.String()
	if strings.Contains(raw, "私密倾诉正文不得出现在日志") || strings.Contains(raw, "嗯。") {
		t.Fatalf("body in logs: %s", raw)
	}
	if strings.Contains(raw, "turn-1") {
		t.Fatalf("durable id in logs: %s", raw)
	}
	var n int
	for _, line := range bytes.Split(buf.Bytes(), []byte("\n")) {
		if len(line) == 0 {
			continue
		}
		n++
		var obj map[string]any
		if err := json.Unmarshal(line, &obj); err != nil {
			t.Fatalf("json %s", line)
		}
	}
	if n == 0 {
		t.Fatal("expected structured logs")
	}
}

func TestMemStoreRejectsFinalizeWithoutClosedSucceededAttempt(t *testing.T) {
	t.Parallel()
	m := NewMemStore()
	m.PutSeed(baseSeed())
	ctx := context.Background()
	if err := m.FinalizeGeneration(ctx, FinalizeCommand{TurnID: "turn-1", AttemptID: "missing", Text: "x"}); err == nil {
		t.Fatal("missing attempt")
	}
	prep, err := m.PrepareAttempt(ctx, PrepareAttempt{TurnID: "turn-1", Budget: budget()})
	if err != nil {
		t.Fatal(err)
	}
	if err := m.FinalizeGeneration(ctx, FinalizeCommand{TurnID: "turn-1", AttemptID: prep.AttemptID, Text: "x"}); err == nil {
		t.Fatal("created attempt is not closed")
	}
}

func TestConnectTimeoutMayRetryOnce(t *testing.T) {
	t.Parallel()
	p := &scripted{err: companion.Timeout(companion.TimeoutConnect, companion.DeliveryNotSent)}
	c, store, _ := newCoord(t, p, baseSeed())
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-r", Budget: budget()})
	if !res.RetryAllowed {
		t.Fatalf("retry %+v", res)
	}
	if res.Public == companion.EventCompleted {
		t.Fatal("completed")
	}
	if store.Phase("turn-1") == companion.PhaseFailed || store.Phase("turn-1") == companion.PhaseCancelled {
		t.Fatal("in-process retry must not terminalize the generation")
	}
}

func TestHighRelMemoryPreferredOverOldHistory(t *testing.T) {
	t.Parallel()
	seed := baseSeed()
	seed.AllowedCategories = []DataCategory{CategoryMessage, CategoryMemory}
	seed.EligibleMemories = []MemoryCandidate{{Summary: "确认：养了一只猫", Confirmed: true, Relevance: 95}}
	seed.RecentMessages = []HistoryMessage{
		{Role: companion.RoleUser, Content: strings.Repeat("古史", 60)},
		{Role: companion.RoleUser, Content: "刚才那句"},
	}
	full := Build(seed, budget())
	b := budget()
	// Leave room for policy + current + memory + recent history, not ancient history.
	b.MaxInputTokens = full.Trace.EstimatedTokens - companion.EstimateTokens(strings.Repeat("古史", 60)) + 4
	p := Build(seed, b)
	joined := strings.Join(contents(p), "\n")
	if !strings.Contains(joined, "养了一只猫") {
		t.Fatalf("memory dropped: %s drops=%v", joined, p.Trace.Drops)
	}
}

func TestBudgetFrozenOnPreparedAttempt(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"好。"}, result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 2, InputTokens: 1, OutputTokens: 1}}}
	c, store, _ := newCoord(t, p, baseSeed())
	b := budget()
	b.MaxOutputTokens = 128
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-f", Budget: b})
	if res.Attempt.Budget.MaxOutputTokens != 128 {
		t.Fatalf("not frozen %+v", res.Attempt.Budget)
	}
	if store.Attempt(res.Attempt.AttemptID).Budget.MaxOutputTokens != 128 {
		t.Fatal("store budget")
	}
}

func TestPublicMappingNeverCompletesBlocked(t *testing.T) {
	t.Parallel()
	if MapPublicTerminal(companion.PhaseBlocked, true) != companion.EventBlocked {
		t.Fatal("blocked")
	}
	if MapPublicTerminal(companion.PhaseCompleted, false) != companion.EventFailed {
		t.Fatal("unpersistable completed maps away from completed")
	}
}

func TestCoordinatorDoesNotImportProviderSDK(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("coordinator.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "openai") || strings.Contains(string(src), "EventSink") {
		t.Fatal("coordinator must not reference openai or EventSink")
	}
}
