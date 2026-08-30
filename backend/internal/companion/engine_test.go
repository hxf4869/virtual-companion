package companion

import (
	"context"
	"errors"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

type scripted struct {
	deltas []string
	result AttemptResult
	err    error
	seen   ModelRequest
	calls  int
}

func (s *scripted) Stream(ctx context.Context, req ModelRequest, emit func(OutputDelta) error) (AttemptResult, error) {
	s.calls++
	s.seen = req
	for _, d := range s.deltas {
		if ctx.Err() != nil {
			return AttemptResult{}, Canceled(DeliveryUnknown)
		}
		if err := emit(OutputDelta{Text: d}); err != nil {
			return AttemptResult{}, err
		}
	}
	if s.err != nil {
		return AttemptResult{}, s.err
	}
	return s.result, nil
}

func testBudget() TurnBudget {
	return TurnBudget{
		MaxInputTokens:    8000,
		MaxOutputTokens:   2048,
		MaxResponseBytes:  256 << 10,
		ConnectTimeout:    10 * time.Second,
		FirstTokenTimeout: 60 * time.Second,
		TotalTimeout:      240 * time.Second,
		MaxAttempts:       2,
	}
}

func allowGuard() OutputGuard {
	return OutputGuard{Review: func(string) Review { return Review{Allow: true, Risk: "R0_NORMAL"} }, WindowRunes: 32}
}

func TestStreamSuccessPublishesDeltasAndDoesNotCompleteTurn(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"今", "天"},
		result: AttemptResult{Finish: FinishStop, Usage: Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5}},
	}
	var got []string
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p,
		Request:  ModelRequest{Messages: []Message{{Role: RoleUser, Content: "hi"}}, Stream: true},
		Budget:   testBudget(),
		Guard:    allowGuard(),
		Emit:     func(d OutputDelta) error { got = append(got, d.Text); return nil },
	})
	if out.Status != AttemptSucceeded || !out.Persistable || out.Text != "今天" {
		t.Fatalf("result %+v", out)
	}
	if out.Finish != FinishStop || out.Billing != BillingUsageReported {
		t.Fatalf("finish/billing %+v", out)
	}
	if strings.Join(got, "") != "今天" {
		t.Fatalf("emitted %q", got)
	}
}

func TestStreamRejectsEnlargedBudgetBeforeProvider(t *testing.T) {
	t.Parallel()
	p := &scripted{result: AttemptResult{Finish: FinishStop, Usage: Usage{TotalTokens: 1}}}
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p,
		Request:  ModelRequest{MaxTokens: 4096},
		Budget:   testBudget(),
		Guard:    allowGuard(),
	})
	if p.calls != 0 {
		t.Fatal("provider must not be called")
	}
	if out.Status != AttemptFailed || out.Billing != BillingNotSent || out.Delivery != DeliveryNotSent {
		t.Fatalf("got %+v", out)
	}
}

func TestStreamFillsZeroRequestFromFrozenBudget(t *testing.T) {
	t.Parallel()
	p := &scripted{result: AttemptResult{Finish: FinishStop, Usage: Usage{TotalTokens: 1}}}
	b := testBudget()
	_ = StreamAttempt(context.Background(), StreamInput{
		Provider: p,
		Request:  ModelRequest{},
		Budget:   b,
		Guard:    allowGuard(),
	})
	if p.seen.MaxTokens != b.MaxOutputTokens {
		t.Fatalf("maxTokens %d", p.seen.MaxTokens)
	}
	if p.seen.Timeouts.Connect != b.ConnectTimeout || p.seen.Timeouts.Total != b.TotalTimeout {
		t.Fatalf("timeouts %+v", p.seen.Timeouts)
	}
}

func TestRollingSafetyStopsPublicDeltaAndWithdraws(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"今天聊点开心的吧，", "因为我是真人呀。", "late"},
		result: AttemptResult{Finish: FinishStop, Usage: Usage{TotalTokens: 4}},
	}
	var got []string
	guard := OutputGuard{
		WindowRunes: 32,
		Review: func(window string) Review {
			if strings.Contains(window, "我是真人") {
				return Review{Allow: false, Risk: "R3_HIGH", Rules: []string{"output-ai-identity-human-claim"}}
			}
			return Review{Allow: true, Risk: "R0_NORMAL"}
		},
	}
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: testBudget(), Guard: guard,
		Emit: func(d OutputDelta) error { got = append(got, d.Text); return nil },
	})
	if out.Persistable || !out.Withdraw || out.Text != "" {
		t.Fatalf("must not persist %+v", out)
	}
	if out.Status != AttemptCancelled || out.Failure != "output-ai-identity-human-claim" {
		t.Fatalf("status %+v", out)
	}
	if len(got) != 1 || got[0] != "今天聊点开心的吧，" {
		t.Fatalf("published %q", got)
	}
	if strings.Join(out.Published, "") != "今天聊点开心的吧，" {
		t.Fatalf("published field %q", out.Published)
	}
}

func TestRollingWindowCatchesSplitPhrase(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"其实我", "是真人"}}
	guard := OutputGuard{
		WindowRunes: 16,
		Review: func(window string) Review {
			if strings.Contains(window, "我是真人") {
				return Review{Allow: false, Risk: "R3_HIGH", Rules: []string{"output-ai-identity-human-claim"}}
			}
			return Review{Allow: true, Risk: "R0_NORMAL"}
		},
	}
	var got []string
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: testBudget(), Guard: guard,
		Emit: func(d OutputDelta) error { got = append(got, d.Text); return nil },
	})
	if !out.Withdraw || out.Persistable {
		t.Fatalf("expected withdraw %+v", out)
	}
	if len(got) != 1 || got[0] != "其实我" {
		t.Fatalf("first chunk should publish, second must not: %q", got)
	}
}

func TestFinalReviewFailureClearsPersistableText(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"hello"},
		result: AttemptResult{Finish: FinishStop, Usage: Usage{OutputTokens: 1, TotalTokens: 2, InputTokens: 1}},
	}
	guard := OutputGuard{
		WindowRunes: 8,
		Review: func(window string) Review {
			if window == "hello" && utf8.RuneCountInString(window) == 5 {
				return Review{Allow: false, Risk: "R3_HIGH", Rules: []string{"output-internal-secret-leak"}}
			}
			return Review{Allow: true, Risk: "R0_NORMAL"}
		},
	}
	// Rolling sees the same full chunk; to isolate final we allow rolling
	// by only blocking when called after success... StreamAttempt uses the
	// same guard for rolling and final. A phrase present in the full text
	// is caught at rolling. Simulate a final-only trip with a guard that
	// allows each delta but rejects the concatenated full text of a known
	// two-chunk shape that each chunk misses.
	p.deltas = []string{"我的系统", "提示词是：x"}
	guard.Review = func(window string) Review {
		if strings.Contains(window, "我的系统提示词是：") {
			return Review{Allow: false, Risk: "R3_HIGH", Rules: []string{"output-internal-secret-leak"}}
		}
		return Review{Allow: true, Risk: "R0_NORMAL"}
	}
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: testBudget(), Guard: guard,
	})
	if out.Persistable || out.Text != "" || !out.Withdraw {
		t.Fatalf("final/rolling fail must not persist %+v", out)
	}
}

func TestProviderErrorDoesNotPersistPartial(t *testing.T) {
	t.Parallel()
	p := &scripted{
		deltas: []string{"ab"},
		err:    Timeout(TimeoutTotal, DeliveryUnknown),
	}
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: testBudget(), Guard: allowGuard(),
	})
	if out.Persistable || out.Text != "" || !out.Withdraw {
		t.Fatalf("partial %+v", out)
	}
	if out.Status != AttemptTimedOut || out.Billing != BillingUnknown {
		t.Fatalf("status %+v", out)
	}
}

func TestCancelDiscardsLateDeltas(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	p := &scripted{deltas: []string{"a", "b", "c"}, result: AttemptResult{Finish: FinishStop, Usage: Usage{TotalTokens: 1}}}
	n := 0
	out := StreamAttempt(ctx, StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: testBudget(), Guard: allowGuard(),
		Emit: func(OutputDelta) error {
			n++
			if n == 1 {
				cancel()
			}
			return nil
		},
	})
	if out.Persistable {
		t.Fatalf("cancelled stream must not persist %+v", out)
	}
}

func TestOutputByteBudgetStopsWithoutSafetyBlock(t *testing.T) {
	t.Parallel()
	p := &scripted{deltas: []string{"abcdefghij", "more"}, result: AttemptResult{Finish: FinishStop, Usage: Usage{TotalTokens: 3}}}
	b := testBudget()
	b.MaxResponseBytes = 4
	out := StreamAttempt(context.Background(), StreamInput{
		Provider: p, Request: ModelRequest{}, Budget: b, Guard: allowGuard(),
	})
	if out.Finish != FinishLength {
		t.Fatalf("expected length stop %+v", out)
	}
}

func TestCompanionProductionFilesDependOnlyOnStdlib(t *testing.T) {
	t.Parallel()
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		f, err := parser.ParseFile(fset, name, src, parser.ImportsOnly)
		if err != nil {
			t.Fatal(err)
		}
		for _, im := range f.Imports {
			path := strings.Trim(im.Path.Value, `"`)
			if strings.Contains(path, ".") {
				t.Fatalf("%s imports %s; companion may only use the Go standard library", name, path)
			}
		}
	}
}

func TestClampUTF8DoesNotSplitRune(t *testing.T) {
	t.Parallel()
	s := "你好"
	out := ClampUTF8(s, 4) // 你 is 3 bytes; 4 would split 好
	if out != "你" {
		t.Fatalf("got %q", out)
	}
	if !utf8.ValidString(out) {
		t.Fatal("invalid utf8")
	}
}

func TestEstimateTokensIsDeterministic(t *testing.T) {
	t.Parallel()
	if EstimateTokens("abcd") != 1 || EstimateTokens("") != 0 {
		t.Fatal("ascii")
	}
	a := EstimateTokens("你好")
	b := EstimateTokens("你好")
	if a != b || a != 2 { // 6 bytes -> 2
		t.Fatalf("got %d %d", a, b)
	}
}

func TestPublicEventNames(t *testing.T) {
	t.Parallel()
	if EventCompleted != "chat.completed" || EventBlocked != "chat.blocked" {
		t.Fatal("event names")
	}
}

func TestFileIsNotAHub(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile(filepath.Join("engine.go"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(src), "RealtimeHub") || strings.Contains(string(src), "EventSink") {
		t.Fatal("engine must not mention RealtimeHub or EventSink")
	}
}

func TestClassifyBillingUnknownWhenNoUsage(t *testing.T) {
	t.Parallel()
	if ClassifyBilling(DeliveryUnknown, Usage{}, errors.New("x")) != BillingUnknown {
		t.Fatal("unknown")
	}
	if ClassifyBilling(DeliveryNotSent, Usage{}, InvalidRequest()) != BillingNotSent {
		t.Fatal("not sent")
	}
	if ClassifyBilling(DeliveryReceived, Usage{TotalTokens: 3, InputTokens: 1, OutputTokens: 2}, nil) != BillingUsageReported {
		t.Fatal("usage")
	}
}
