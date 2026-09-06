package jobs

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// extractTestStore fakes the extraction slice of the durable surface.
type extractTestStore struct {
	Store
	mu          sync.Mutex
	input       postgres.MemoryExtractInput
	inputErr    error
	pref        bool
	prefErr     error
	gate        postgres.OutboundDecision
	gateErr     error
	routes      []postgres.ProviderRoute
	routeErr    error
	saved       []postgres.AutoSavedMemoryCreate
	saveErr     error
	retryCalls  int
	retryAction string
	retryErr    error
	completeErr error
	closes      []extractClose
}

type extractClose struct {
	status string
	reason string
}

func (s *extractTestStore) ResolveProviderRoutes(context.Context) ([]postgres.ProviderRoute, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.routeErr != nil {
		return nil, s.routeErr
	}
	return append([]postgres.ProviderRoute(nil), s.routes...), nil
}

func (s *extractTestStore) ReadMemoryExtractInput(context.Context, int64, int64) (postgres.MemoryExtractInput, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.inputErr != nil {
		return postgres.MemoryExtractInput{}, s.inputErr
	}
	return s.input, nil
}

func (s *extractTestStore) GetMemoryAutoSavePref(context.Context, int64) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.prefErr != nil {
		return false, s.prefErr
	}
	return s.pref, nil
}

func (s *extractTestStore) OutboundCheck(context.Context, int64) (postgres.OutboundDecision, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.gateErr != nil {
		return postgres.OutboundDecision{}, s.gateErr
	}
	return s.gate, nil
}

func (s *extractTestStore) CreateAutoSavedMemory(_ context.Context, _ int64, in postgres.AutoSavedMemoryCreate) (postgres.Memory, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveErr != nil {
		return postgres.Memory{}, s.saveErr
	}
	s.saved = append(s.saved, in)
	return postgres.Memory{ID: int64(len(s.saved)), AutoSaved: true, Status: "ACCEPTED"}, nil
}

func (s *extractTestStore) RetryMemoryExtract(context.Context, int64, int64, string, string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retryCalls++
	if s.retryErr != nil {
		return "", s.retryErr
	}
	return s.retryAction, nil
}

func (s *extractTestStore) CompleteJob(_ context.Context, _, _ int64, _, _, status, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closes = append(s.closes, extractClose{status: status, reason: reason})
	if s.completeErr != nil {
		return s.completeErr
	}
	return nil
}

func (s *extractTestStore) closeCalls() []extractClose {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]extractClose(nil), s.closes...)
}

type extractTestProvider struct {
	callN int32
	text  string
	err   error
	mu    sync.Mutex
	last  companion.ModelRequest
}

func (p *extractTestProvider) Stream(ctx context.Context, req companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.mu.Lock()
	p.last = req
	p.callN++
	p.mu.Unlock()
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if err := emit(companion.OutputDelta{Text: p.text}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop}, nil
}

func (p *extractTestProvider) callCount() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return int(p.callN)
}

// routeCaptureProvider stands in for a provider built from a database route.
// It records the resolved route seen by the factory and whether the dynamic
// provider was closed after the bounded call.
type routeCaptureProvider struct {
	mu     sync.Mutex
	route  modelprovider.Route
	calls  int
	closed int
	text   string
	err    error
}

func (p *routeCaptureProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.mu.Lock()
	p.calls++
	p.mu.Unlock()
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if err := emit(companion.OutputDelta{Text: p.text}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop}, nil
}

func (p *routeCaptureProvider) Close() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed++
}

func (p *routeCaptureProvider) stats() (calls, closed int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.calls, p.closed
}

func extractTestClaim() postgres.JobClaim {
	return postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindMemoryExtract, RefID: 5, Token: "token", Fence: "fence"}
}

func extractTestInput() postgres.MemoryExtractInput {
	src := int64(101)
	asst := int64(102)
	return postgres.MemoryExtractInput{
		RelationshipID: 3,
		ConversationID: 4,
		Status:         "COMPLETED",
		// Anchored spans available for synthetic summaries: "合成测试" at the
		// message start, "喜欢安静的地方"/"喜欢安静" after 我, "喜欢清晨散步"/
		// "住在杭州" after clause breaks. "测试轮次回复" only exists in the
		// assistant content.
		SourceMessageID:    &src,
		AssistantMessageID: &asst,
		UserContent:        "合成测试轮次：我喜欢安静的地方。喜欢清晨散步。住在杭州。",
		AssistantContent:   "合成测试轮次回复",
	}
}

func newExtractTestLoop(store *extractTestStore, provider companion.Provider) *Loop {
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)
	return loop
}

func TestMemoryExtractSavesWhitelistedItems(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input: extractTestInput(),
		pref:  true,
		gate:  postgres.OutboundDecision{Allow: true, Code: "OK"},
	}
	// Every surviving item must carry evidence quoted from the user message.
	provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"合成测试"},{"summary":"用户住在杭州","category":"FACT","evidence":"测试轮次"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := len(store.saved); got != 2 {
		t.Fatalf("saved %d, want 2", got)
	}
	wantEvidence := []string{"message:101", "message:102"}
	for i, in := range store.saved {
		if in.RelationshipID != 3 || in.ConversationID != 4 {
			t.Fatalf("item %d binding %+v", i, in)
		}
		wantKey := fmt.Sprintf("auto%d-%d", 5, i)
		if in.IdempotencyKey != wantKey {
			t.Fatalf("item %d key %q, want %q", i, in.IdempotencyKey, wantKey)
		}
		if len(in.Evidence) != 2 || in.Evidence[0] != wantEvidence[0] || in.Evidence[1] != wantEvidence[1] {
			t.Fatalf("item %d evidence %v", i, in.Evidence)
		}
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" || closes[0].reason != "" {
		t.Fatalf("closes %+v", closes)
	}
	if provider.last.Stream {
		t.Fatal("extraction must not stream")
	}
	if provider.last.MaxTokens != extractMaxTokens {
		t.Fatalf("max tokens %d, want %d", provider.last.MaxTokens, extractMaxTokens)
	}
	if len(provider.last.Messages) != 2 {
		t.Fatalf("messages %d, want 2 (system + turn)", len(provider.last.Messages))
	}
	if provider.last.Timeouts.Total != extractTotalTimeout {
		t.Fatalf("total timeout %s, want %s", provider.last.Timeouts.Total, extractTotalTimeout)
	}
}

func TestMemoryExtractTruncatesToThree(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input: extractTestInput(),
		pref:  true,
		gate:  postgres.OutboundDecision{Allow: true, Code: "OK"},
	}
	// Five grounded items from the synthetic turn; only the first extractMaxItems
	// survive the per-turn cap.
	provider := &extractTestProvider{text: `[
		{"summary":"用户合成测试","category":"FACT","evidence":"合成测试"},
		{"summary":"用户喜欢安静的地方","category":"FACT","evidence":"测试轮次"},
		{"summary":"用户喜欢清晨散步","category":"FACT","evidence":"清晨散步"},
		{"summary":"用户住在杭州","category":"PREFERENCE","evidence":"住在杭州"},
		{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"合成测试"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := len(store.saved); got != extractMaxItems {
		t.Fatalf("saved %d, want %d", got, extractMaxItems)
	}
}

func TestMemoryExtractDropsInvalidItemsAndRetriesMalformedPayload(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true, Code: "OK"},
		retryAction: "RETRY_SCHEDULED",
	}
	// One valid item survives; empty summary, non-whitelisted category,
	// over-long summary and a missing-evidence item are dropped server-side.
	long := strings.Repeat("长", extractMaxSummaryRunes+1)
	provider := &extractTestProvider{text: `[
		{"summary":"","category":"PREFERENCE"},
		{"summary":"健康陈述","category":"HEALTH"},
		{"summary":"用户喜欢清晨散步","category":"PREFERENCE","evidence":"合成测试"},
		{"summary":"无依据陈述","category":"FACT"},
		{"summary":"` + long + `","category":"FACT","evidence":"合成测试"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := len(store.saved); got != 1 || store.saved[0].Summary != "用户喜欢清晨散步" {
		t.Fatalf("saved %+v", store.saved)
	}

	malformed := &extractTestProvider{text: "这不是 JSON"}
	loop2 := newExtractTestLoop(store, malformed)
	if err := loop2.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if store.retryCalls != 1 {
		t.Fatalf("retry calls %d, want 1", store.retryCalls)
	}
	if closes := store.closeCalls(); len(closes) != 1 {
		t.Fatalf("malformed payload must not close the job itself: %+v", closes)
	}
}

func TestMemoryExtractBoundedRetryThenDeadLetter(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true, Code: "OK"},
		retryAction: "RETRY_SCHEDULED",
	}
	provider := &extractTestProvider{err: companion.UpstreamUnavailable()}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if store.retryCalls != 1 || store.retryAction != "RETRY_SCHEDULED" {
		t.Fatalf("retry %d action %q", store.retryCalls, store.retryAction)
	}

	// Requeue scheduling itself failing closes the job FAILED exactly once.
	store.retryErr = errors.New("requeue unavailable")
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != "EXTRACT_PROVIDER" {
		t.Fatalf("closes %+v", closes)
	}
}

// TestMemoryExtractDeletedMemoryDoesNotResurrect proves the tombstone half of
// the deletion contract at the handler level: after a user deletes an
// auto-saved memory, V57 flips the source messages to no_memory, so the
// retried job either sees the marker up front (DONE) or the store guard
// refuses the evidence sources (FAILED, no retry) — never a second insert.
func TestMemoryExtractDeletedMemoryDoesNotResurrect(t *testing.T) {
	t.Parallel()
	t.Run("tombstoned source short-circuits", func(t *testing.T) {
		t.Parallel()
		input := extractTestInput()
		input.AssistantNoMemory = true
		store := &extractTestStore{input: input, pref: true, gate: postgres.OutboundDecision{Allow: true}}
		provider := &extractTestProvider{text: `[{"summary":"复活尝试","category":"FACT","evidence":"合成测试"}]`}
		loop := newExtractTestLoop(store, provider)
		if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
			t.Fatal(err)
		}
		if len(store.saved) != 0 {
			t.Fatalf("resurrected %+v", store.saved)
		}
		if provider.callCount() != 0 {
			t.Fatal("provider must not be called for tombstoned sources")
		}
		if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" || closes[0].reason != "MEMORY_SOURCE_SUPPRESSED" {
			t.Fatalf("closes %+v", closes)
		}
	})
	t.Run("guard refusal never retries", func(t *testing.T) {
		t.Parallel()
		store := &extractTestStore{
			input:   extractTestInput(),
			pref:    true,
			gate:    postgres.OutboundDecision{Allow: true},
			saveErr: postgres.ErrInvalid,
		}
		provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"合成测试"}]`}
		loop := newExtractTestLoop(store, provider)
		if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
			t.Fatal(err)
		}
		if store.retryCalls != 0 {
			t.Fatalf("guard refusal retried %d times", store.retryCalls)
		}
		if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != "MEMORY_SOURCE_GUARDED" {
			t.Fatalf("closes %+v", closes)
		}
	})
}

func TestMemoryExtractSkipsSuppressedTurns(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name   string
		mutate func(*extractTestStore, *postgres.MemoryExtractInput)
		want   string
	}{
		{"pref off", func(s *extractTestStore, _ *postgres.MemoryExtractInput) { s.pref = false }, "AUTO_SAVE_OFF"},
		{"incognito", func(_ *extractTestStore, in *postgres.MemoryExtractInput) { in.Incognito = true }, "MEMORY_SOURCE_SUPPRESSED"},
		{"user no_memory", func(_ *extractTestStore, in *postgres.MemoryExtractInput) { in.UserNoMemory = true }, "MEMORY_SOURCE_SUPPRESSED"},
		{"consent withdrawn", func(s *extractTestStore, _ *postgres.MemoryExtractInput) {
			s.gate = postgres.OutboundDecision{Allow: false, Code: "CONSENT_WITHDRAWN"}
		}, "CONSENT_WITHDRAWN"},
		{"not completed", func(_ *extractTestStore, in *postgres.MemoryExtractInput) { in.Status = "FAILED_FINAL" }, "TURN_NOT_EXTRACTABLE"},
		{"missing assistant", func(_ *extractTestStore, in *postgres.MemoryExtractInput) { in.AssistantMessageID = nil }, "TURN_NOT_EXTRACTABLE"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &extractTestStore{input: extractTestInput(), pref: true, gate: postgres.OutboundDecision{Allow: true}}
			input := store.input
			tc.mutate(store, &input)
			store.input = input
			provider := &extractTestProvider{text: `[{"summary":"x","category":"FACT"}]`}
			loop := newExtractTestLoop(store, provider)
			if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
				t.Fatal(err)
			}
			if len(store.saved) != 0 {
				t.Fatalf("saved %+v", store.saved)
			}
			if provider.callCount() != 0 {
				t.Fatal("provider must not be called")
			}
			if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" || closes[0].reason != tc.want {
				t.Fatalf("closes %+v, want DONE %q", closes, tc.want)
			}
		})
	}
}

// TestEnqueueFailureDoesNotAffectCompletedGeneration drives the real
// handleGeneration completed path with a failing trigger: the chat reply
// terminal state must stay successful and the task may be lost.
func TestEnqueueFailureDoesNotAffectCompletedGeneration(t *testing.T) {
	t.Parallel()
	store := newConcurrencyStore(1)
	store.enqueueErr = errors.New("enqueue unavailable")
	provider := &routeProvider{text: "我在。"}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)
	if err := loop.handleGeneration(context.Background(), store.claims[0], "enqueue-fail"); err != nil {
		t.Fatalf("completed generation returned error: %v", err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.enqueueCalls != 1 {
		t.Fatalf("enqueue calls %d, want 1", store.enqueueCalls)
	}
}

// TestGenerationCompletionEnqueuesOncePerGeneration pins the trigger count on
// the real completed path; per-generation dedup is the SQL unique index.
func TestGenerationCompletionEnqueuesOncePerGeneration(t *testing.T) {
	t.Parallel()
	store := newConcurrencyStore(1)
	provider := &routeProvider{text: "我在。"}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)
	if err := loop.handleGeneration(context.Background(), store.claims[0], "enqueue-count"); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.enqueueCalls != 1 {
		t.Fatalf("enqueue calls %d, want exactly 1", store.enqueueCalls)
	}
}

// TestFailExtractLogsSwallowedCloseFailure pins audit L3: when the requeue
// call fails and the fallback FAILED close also fails, the swallowed
// CompleteJob error must still surface as an outcome=error log.
func TestFailExtractLogsSwallowedCloseFailure(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true, Code: "OK"},
		retryErr:    errors.New("requeue unavailable"),
		completeErr: errors.New("close unavailable"),
	}
	provider := &extractTestProvider{err: companion.UpstreamUnavailable()}
	loop := NewLoop(log, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, provider, nil, nil)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != "EXTRACT_PROVIDER" {
		t.Fatalf("closes %+v", closes)
	}
	line := buf.String()
	for _, want := range []string{
		`operation=memory_extract_retry`,
		`outcome=error`,
		`error_code=EXTRACT_CLOSE_FAILED`,
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("log %q missing %q", line, want)
		}
	}
}

func TestParseExtractOutput(t *testing.T) {
	t.Parallel()
	// Whitespace inside the message must not break the verbatim span match:
	// normalised to "我喜欢清晨散步，住在杭州。" the spans "喜欢清晨散步" (after
	// 我) and "住在杭州" (after ，) are grounded.
	const user = "我 喜欢 清晨散步，住在杭州。"
	items, ok := parseExtractOutput(`[
		{"summary":" 用户喜欢清晨散步 ","category":"fact","evidence":"喜欢 清晨散步"},
		{"summary":"用户住在杭州","category":"PREFERENCE","evidence":"住在杭州"},
		{"summary":"","category":"FACT","evidence":"住在杭州"},
		{"summary":"c","category":"MOOD","evidence":"住在杭州"}]`, extractMaxItems, user)
	if !ok || len(items) != 2 || items[0].Summary != "用户喜欢清晨散步" || items[0].Category != "FACT" || items[1].Summary != "用户住在杭州" {
		t.Fatalf("ok=%v %+v", ok, items)
	}
	if got, ok := parseExtractOutput(`[
		{"summary":"用户我喜欢清晨散步","category":"FACT","evidence":"清晨"},
		{"summary":"我喜欢清晨散步","category":"FACT","evidence":"清晨"},
		{"summary":"用户喜欢清晨散步","category":"FACT","evidence":"清晨"},
		{"summary":"用户住在杭州","category":"FACT","evidence":"清晨"}]`, 3, user); !ok || len(got) != 3 {
		t.Fatalf("truncation ok=%v %d", ok, len(got))
	}
	if got, ok := parseExtractOutput("not json", 3, user); ok || got != nil {
		t.Fatalf("non-array ok=%v %+v", ok, got)
	}
	if got, ok := parseExtractOutput(`{"summary":"x"}`, 3, user); ok || got != nil {
		t.Fatalf("object payload ok=%v %+v", ok, got)
	}
	if got, ok := parseExtractOutput("[]", 3, user); !ok || len(got) != 0 {
		t.Fatalf("empty array ok=%v %+v", ok, got)
	}
	long := strings.Repeat("长", extractMaxSummaryRunes+1)
	if got, ok := parseExtractOutput(fmt.Sprintf(`[{"summary":%q,"category":"FACT","evidence":"清晨"}]`, long), 3, user); !ok || len(got) != 0 {
		t.Fatalf("over-long item survived: ok=%v %d", ok, len(got))
	}
	// Evidence contract: must be a short verbatim quote of the user message
	// (whitespace-normalised substring match), not of the assistant message.
	cases := []struct {
		name    string
		payload string
	}{
		{"missing evidence", `[{"summary":"喜欢散步","category":"FACT"}]`},
		{"empty evidence", `[{"summary":"喜欢散步","category":"FACT","evidence":""}]`},
		{"evidence not in user message", `[{"summary":"用户住在火星","category":"FACT","evidence":"住在火星"}]`},
		{"evidence from assistant text", `[{"summary":"复述","category":"FACT","evidence":"仅供参考"}]`},
		{"over-long evidence", `[{"summary":"引文过长","category":"FACT","evidence":"` + strings.Repeat("清", extractMaxEvidenceRunes+1) + `"}]`},
		{"sensitive health", `[{"summary":"用户有抑郁症","category":"FACT","evidence":"清晨散步"}]`},
		{"sensitive identifier", `[{"summary":"用户身份证丢了","category":"FACT","evidence":"清晨散步"}]`},
		{"speculative summary", `[{"summary":"可能喜欢爬山","category":"FACT","evidence":"清晨散步"}]`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.payload, extractMaxItems, user)
			if !ok || len(got) != 0 {
				t.Fatalf("payload %q survived: ok=%v %+v", tc.name, ok, got)
			}
		})
	}
}

// TestParseExtractOutputStripsMarkdownFence pins audit M1: real providers
// wrap the JSON array in a Markdown code fence. One paired fence (with or
// without a language tag) is stripped before parsing; unpaired fences, pure
// fences without a payload and non-fence text keep the existing malformed
// behaviour.
func TestParseExtractOutputStripsMarkdownFence(t *testing.T) {
	t.Parallel()
	user := "我喜欢喝茶。"
	payload := `[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"}]`
	cases := []struct {
		name    string
		text    string
		wantOK  bool
		wantLen int
	}{
		{"fenced with language tag", "```json\n" + payload + "\n```", true, 1},
		{"fenced without language tag", "```\n" + payload + "\n```", true, 1},
		{"fence with padded lines", "```json\n\n" + payload + "\n\n```", true, 1},
		{"bare json", payload, true, 1},
		{"unpaired opening fence", "```json\n" + payload, false, 0},
		{"pure fence without payload", "```\n```", false, 0},
		{"nested double fence", "```\n```json\n" + payload + "\n```\n```", false, 0},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.text, extractMaxItems, user)
			if ok != tc.wantOK || len(got) != tc.wantLen {
				t.Fatalf("ok=%v items=%d, want ok=%v len=%d", ok, len(got), tc.wantOK, tc.wantLen)
			}
			if tc.wantLen > 0 && (got[0].Summary != "用户喜欢喝茶" || got[0].Category != "PREFERENCE") {
				t.Fatalf("items %+v", got)
			}
		})
	}
}

// TestParseExtractOutputSummaryGrounding pins the summary-landing contract
// (audit remediation): a passing evidence quote alone does not prove the
// summary is about the user. The summary must be an optional "用户"/"我"
// prefix plus one verbatim contiguous span of the user message whose left
// boundary is a first-person word, the message start, or a clause break.
// Subject drift, unrelated quotes, rewording and sensitive health facts are
// refused per item; clearly low-sensitivity first-person statements pass.
func TestParseExtractOutputSummaryGrounding(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		user      string
		payload   string
		wantCount int
		wantFirst string
	}{
		// Codex round-2 reproductions — all must be refused.
		{"subject drift to colleague", "我的同事喜欢跑步。",
			`[{"summary":"用户喜欢跑步","category":"PREFERENCE","evidence":"喜欢跑步"}]`, 0, ""},
		{"span after 的 never anchors", "我的同事喜欢跑步。",
			`[{"summary":"用户同事喜欢跑步","category":"FACT","evidence":"同事喜欢跑步"}]`, 0, ""},
		{"summary about something else", "我喜欢喝茶。",
			`[{"summary":"用户住在杭州","category":"FACT","evidence":"我喜欢喝茶"}]`, 0, ""},
		{"sensitive health fact as FACT", "我有糖尿病。",
			`[{"summary":"用户有糖尿病","category":"FACT","evidence":"有糖尿病"}]`, 0, ""},
		{"reworded summary", "我喜欢喝茶。",
			`[{"summary":"用户爱喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"}]`, 0, ""},
		{"evidence carries sensitive word", "我常聊到焦虑的话题。",
			`[{"summary":"用户常聊到","category":"FACT","evidence":"聊到焦虑"}]`, 0, ""},
		// Grounded low-sensitivity positives still pass (2 preferences, 2 facts).
		{"preference first-person span", "我喜欢喝茶。",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"}]`, 1, "用户喜欢喝茶"},
		{"preference keeps 我 prefix", "我喜欢喝茶。",
			`[{"summary":"我喜欢喝茶","category":"PREFERENCE","evidence":"我喜欢喝茶"}]`, 1, "我喜欢喝茶"},
		{"fact first-person span", "我住在杭州，喜欢清晨散步。",
			`[{"summary":"用户住在杭州","category":"FACT","evidence":"住在杭州"}]`, 1, "用户住在杭州"},
		{"fact anchored at message start", "今天降温了，我穿了外套。",
			`[{"summary":"用户今天降温了","category":"FACT","evidence":"今天降温"}]`, 1, "用户今天降温了"},
		{"mixed batch drops only the invalid item", "我喜欢喝茶。我讨厌吵闹。",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"},
			  {"summary":"用户讨厌闹","category":"PREFERENCE","evidence":"讨厌吵闹"}]`, 1, "用户喜欢喝茶"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.payload, extractMaxItems, tc.user)
			if !ok {
				t.Fatalf("array payload reported malformed")
			}
			if len(got) != tc.wantCount {
				t.Fatalf("saved %d items %+v, want %d", len(got), got, tc.wantCount)
			}
			if tc.wantCount > 0 && got[0].Summary != tc.wantFirst {
				t.Fatalf("summary %q, want %q", got[0].Summary, tc.wantFirst)
			}
		})
	}
}

// TestMemoryExtractUsesDatabaseRouteWhenEnvProviderDisabled pins defect 2:
// with the env provider factory disabled (nil built-in provider) but a
// database-configured route present, extraction must resolve the route
// through the provider factory, call that provider once, and close it.
func TestMemoryExtractUsesDatabaseRouteWhenEnvProviderDisabled(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input: extractTestInput(),
		pref:  true,
		gate:  postgres.OutboundDecision{Allow: true, Code: "OK"},
		routes: []postgres.ProviderRoute{{
			ProviderID: "route-a", SupplierName: "Supplier A",
			Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://route-a.example/v1",
			Credential: "key-a", ModelID: "model-a", MaxOutputTokens: 256, Priority: 1,
		}},
	}
	routed := &routeCaptureProvider{text: `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"合成测试"}]`}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, nil) // env provider disabled
	var gotRoute modelprovider.Route
	loop.UseProviderFactory(func(route modelprovider.Route) (companion.Provider, error) {
		gotRoute = route
		return routed, nil
	})
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if gotRoute.ProviderID != "route-a" || gotRoute.ModelID != "model-a" || gotRoute.Credential != "key-a" {
		t.Fatalf("factory route %+v", gotRoute)
	}
	if calls, closed := routed.stats(); calls != 1 || closed != 1 {
		t.Fatalf("route provider calls=%d closed=%d, want 1/1", calls, closed)
	}
	if len(store.saved) != 1 || store.saved[0].Summary != "用户喜欢安静" {
		t.Fatalf("saved %+v", store.saved)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" {
		t.Fatalf("closes %+v", closes)
	}
}

// TestMemoryExtractRouteConfigFailures pins the generation admission semantics
// on the extraction path: an unreadable route table or an unfactorable route is
// a terminal FAILED close, never a retry.
func TestMemoryExtractRouteConfigFailures(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name     string
		routeErr error
		factory  func(modelprovider.Route) (companion.Provider, error)
		want     string
	}{
		{"route read failed", errors.New("db down"), nil, "PROVIDER_CONFIG_UNAVAILABLE"},
		{"factory missing", nil, nil, "PROVIDER_CONFIG_UNAVAILABLE"},
		{"factory rejected route", nil, func(modelprovider.Route) (companion.Provider, error) {
			return nil, errors.New("bad route")
		}, "PROVIDER_CONFIG_INVALID"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			store := &extractTestStore{
				input:    extractTestInput(),
				pref:     true,
				gate:     postgres.OutboundDecision{Allow: true, Code: "OK"},
				routeErr: tc.routeErr,
			}
			if tc.routeErr == nil {
				store.routes = []postgres.ProviderRoute{{ProviderID: "route-a"}}
			}
			loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
			loop.Use(store, nil, nil, nil)
			if tc.factory != nil {
				loop.UseProviderFactory(tc.factory)
			}
			if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
				t.Fatal(err)
			}
			if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != tc.want {
				t.Fatalf("closes %+v, want FAILED %s", closes, tc.want)
			}
		})
	}
}

// TestMemoryExtractBatchValidation pins defect 4 end to end: one model payload
// mixing a valid preference with a sensitive "FACT", an unevidenced item, an
// assistant-sourced quote and speculative phrasing must persist only the valid
// item — sensitive content can never masquerade as an auto-saved FACT.
func TestMemoryExtractBatchValidation(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input: extractTestInput(),
		pref:  true,
		gate:  postgres.OutboundDecision{Allow: true, Code: "OK"},
	}
	provider := &extractTestProvider{text: `[
		{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"合成测试"},
		{"summary":"用户有抑郁症病史","category":"FACT","evidence":"合成测试"},
		{"summary":"用户住在火星","category":"FACT","evidence":"住在火星"},
		{"summary":"助手复述用户环游世界","category":"FACT","evidence":"测试轮次回复"},
		{"summary":"可能喜欢爬山","category":"FACT","evidence":"合成测试"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if len(store.saved) != 1 || store.saved[0].Summary != "用户喜欢安静的地方" {
		t.Fatalf("saved %+v, want only the evidenced preference", store.saved)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" {
		t.Fatalf("closes %+v", closes)
	}
}
