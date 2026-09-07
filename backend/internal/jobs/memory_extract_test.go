package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
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

	// V133 attempt surface. prepareDecision defaults to EXTRACTABLE; the
	// prior payload replays through the parser without a second model call.
	prepareDecision string
	prepareErr      error
	priorPayload    string
	prepareCalls    int
	prepared        []postgres.JobClaim
	outcomes        []postgres.MemoryExtractOutcome
	outcomeErr      error
}

type extractClose struct {
	status string
	reason string
}

func (s *extractTestStore) PrepareMemoryExtractAttempt(_ context.Context, owner, jobID, generationID int64, token, fence, providerID, supplierName, modelID string) (postgres.MemoryExtractPreparation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prepareCalls++
	s.prepared = append(s.prepared, postgres.JobClaim{OwnerID: owner, JobID: jobID, RefID: generationID, Token: token, Fence: fence})
	if s.prepareErr != nil {
		return postgres.MemoryExtractPreparation{}, s.prepareErr
	}
	decision := s.prepareDecision
	if decision == "" {
		decision = "EXTRACTABLE"
	}
	prep := postgres.MemoryExtractPreparation{Decision: decision, PriorPayload: s.priorPayload}
	// 8a: a replay-only run (prior payload hit) registers no new attempt —
	// the Go side returns attemptID 0 and must not record an outcome.
	if decision == "EXTRACTABLE" && s.priorPayload == "" {
		prep.AttemptID = int64(s.prepareCalls)
		prep.AttemptNo = s.prepareCalls
	}
	return prep, nil
}

func (s *extractTestStore) RecordMemoryExtractOutcome(_ context.Context, _, _, _ int64, out postgres.MemoryExtractOutcome) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.outcomeErr != nil {
		return 0, s.outcomeErr
	}
	s.outcomes = append(s.outcomes, out)
	return 1, nil
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
		// message start, "喜欢安静的地方"/"喜欢清晨散步"/"住在杭州" each right
		// after a first-person 我. "测试轮次回复" only exists in the assistant
		// content.
		SourceMessageID:    &src,
		AssistantMessageID: &asst,
		UserContent:        "合成测试轮次：我喜欢安静的地方。我喜欢清晨散步。我住在杭州。",
		AssistantContent:   "合成测试轮次回复",
		ModelEligible:      true,
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
	// Every surviving item must carry evidence quoted from the user message
	// and covering the same statement the summary lands on.
	provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"},{"summary":"用户住在杭州","category":"FACT","evidence":"住在杭州"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := len(store.saved); got != 2 {
		t.Fatalf("saved %d, want 2", got)
	}
	// The evidence refs bind the user source message only: the assistant
	// message is not an extraction source, and the V57 tombstone flip on the
	// user message is what re-suppresses a deleted memory's source.
	wantEvidence := []string{"message:101"}
	for i, in := range store.saved {
		if in.RelationshipID != 3 || in.ConversationID != 4 {
			t.Fatalf("item %d binding %+v", i, in)
		}
		wantKey := fmt.Sprintf("auto%d-%d", 5, i)
		if in.IdempotencyKey != wantKey {
			t.Fatalf("item %d key %q, want %q", i, in.IdempotencyKey, wantKey)
		}
		if len(in.Evidence) != 1 || in.Evidence[0] != wantEvidence[0] {
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
	// N-04 outbound boundary: only the authorized user message goes out. The
	// assistant reply is not an extraction source and must not be in the payload.
	if got := provider.last.Messages[1].Content; got != extractUserPrompt("合成测试轮次：我喜欢安静的地方。我喜欢清晨散步。我住在杭州。") {
		t.Fatalf("outbound user message %q", got)
	}
	if strings.Contains(provider.last.Messages[1].Content, "合成测试轮次回复") {
		t.Fatalf("outbound payload leaked the assistant reply: %q", provider.last.Messages[1].Content)
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
		{"summary":"用户喜欢安静的地方","category":"FACT","evidence":"喜欢安静的地方"},
		{"summary":"用户喜欢清晨散步","category":"FACT","evidence":"我喜欢清晨散步"},
		{"summary":"用户住在杭州","category":"PREFERENCE","evidence":"住在杭州"},
		{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`}
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
		{"summary":"用户喜欢清晨散步","category":"PREFERENCE","evidence":"我喜欢清晨散步"},
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
		provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`}
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
		{"model ineligible source", func(_ *extractTestStore, in *postgres.MemoryExtractInput) { in.ModelEligible = false }, "SOURCE_NOT_MODEL_ELIGIBLE"},
		{"consent withdrawn", func(s *extractTestStore, _ *postgres.MemoryExtractInput) {
			s.prepareDecision = "CONSENT_WITHDRAWN"
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

// TestParseExtractOutputRefusesThirdPartyAndConditional pins the audit
// counterexamples: a summary whose subject the model cannot bind to an
// explicit first-person statement of the user never auto-saves. Reported
// speech ("同事说，...") and conditionals ("如果以后搬家，...") are the
// canonical refusals; the summary must name the subject (用户/我 prefix) and
// land on a verbatim span whose context anchors it to the user.
func TestParseExtractOutputRefusesThirdPartyAndConditional(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		user    string
		payload string
	}{
		{"reported speech", "同事说，喜欢喝咖啡。",
			`[{"summary":"用户喜欢喝咖啡","category":"PREFERENCE","evidence":"喜欢喝咖啡"}]`},
		{"reported speech as FACT", "同事说，喜欢喝咖啡。",
			`[{"summary":"用户喜欢喝咖啡","category":"FACT","evidence":"喜欢喝咖啡"}]`},
		{"conditional", "如果以后搬家，想去成都生活。",
			`[{"summary":"用户想去成都生活","category":"FACT","evidence":"想去成都生活"}]`},
		{"conditional with 我", "如果我以后搬家，想去成都生活。",
			`[{"summary":"用户想去成都生活","category":"FACT","evidence":"想去成都生活"}]`},
		{"third-person subject named in summary", "同事说，喜欢喝咖啡。",
			`[{"summary":"用户同事说喜欢喝咖啡","category":"FACT","evidence":"同事说喜欢喝咖啡"}]`},
		{"question about the other person", "你喜欢喝茶吗？",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"}]`},
		// Audit round-A counterexamples the immediate-"我" anchor used to wave
		// through: the anchored span's own clause is a conditional, embedded
		// reported speech, or a negated restatement.
		{"conditional first-person span", "如果我喜欢喝咖啡，就会买咖啡机。",
			`[{"summary":"用户喜欢喝咖啡","category":"PREFERENCE","evidence":"喜欢喝咖啡"}]`},
		{"embedded reported speech", "妈妈说我应该早睡。",
			`[{"summary":"用户应该早睡","category":"FACT","evidence":"我应该早睡"}]`},
		// Audit gap: 建议/推荐 carry third-person attribution just like 说,
		// so an advice span must not borrow the earlier 我 as its subject.
		{"advice reported speech", "我朋友建议我早睡。",
			`[{"summary":"用户早睡","category":"PREFERENCE","evidence":"早睡"}]`},
		{"recommendation reported speech", "我朋友推荐我早睡。",
			`[{"summary":"用户早睡","category":"PREFERENCE","evidence":"早睡"}]`},
		// Cross-clause negation: the second clause opens with 不是, so the span
		// asserts what the user denied.
		{"negated clause-open span", "我讨厌辣，不是喜欢喝茶。",
			`[{"summary":"用户不是喜欢喝茶","category":"PREFERENCE","evidence":"不是喜欢喝茶"}]`},
		// Same message, plain span: the negation right in front of it must
		// refuse the item at the subject check, not by anchor accident.
		{"span directly behind the negation", "我讨厌辣，不是喜欢喝茶。",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"喜欢喝茶"}]`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.payload, extractMaxItems, tc.user)
			if !ok {
				t.Fatalf("array payload reported malformed")
			}
			if len(got) != 0 {
				t.Fatalf("saved %d items %+v, want 0", len(got), got)
			}
		})
	}
}

// TestParseExtractOutputEvidenceBindsSummary pins the evidence-source rule:
// the evidence quote must come from the current source user message AND be the
// same statement the summary lands on. Two unrelated fragments of the user
// message (or an assistant-only quote) are not corroboration.
func TestParseExtractOutputEvidenceBindsSummary(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		user    string
		payload string
	}{
		{"evidence only in assistant reply", "我喜欢喝茶。",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"仅供参考"}]`},
		{"evidence is an unrelated user fragment", "我喜欢喝茶。我住在杭州。",
			`[{"summary":"用户住在杭州","category":"FACT","evidence":"我喜欢喝茶"}]`},
		{"evidence from another clause", "合成测试轮次：我喜欢安静的地方。",
			`[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"合成测试"}]`},
		{"evidence misses the summary span", "我喜欢喝茶。",
			`[{"summary":"用户喜欢喝茶","category":"PREFERENCE","evidence":"我喜欢喝"}]`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.payload, extractMaxItems, tc.user)
			if !ok {
				t.Fatalf("array payload reported malformed")
			}
			if len(got) != 0 {
				t.Fatalf("saved %d items %+v, want 0", len(got), got)
			}
		})
	}
}

// TestParseExtractOutputRefusesIdentifiers pins the identifier denial: a
// summary or evidence carrying a synthetic email address, phone number or
// national id number must never pass as FACT/PREFERENCE, with or without a
// keyword like 邮箱 in the text.
func TestParseExtractOutputRefusesIdentifiers(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		user    string
		payload string
	}{
		{"email with keyword", "我的邮箱是 heping@example.com。",
			`[{"summary":"用户的邮箱是heping@example.com","category":"FACT","evidence":"heping@example.com"}]`},
		{"email without keyword", "我常用 heping@example.com。",
			`[{"summary":"用户常用heping@example.com","category":"FACT","evidence":"heping@example.com"}]`},
		{"mobile number", "我的手机号是 13812345678。",
			`[{"summary":"用户的手机号是13812345678","category":"FACT","evidence":"13812345678"}]`},
		{"bare phone number", "我的号码是 13812345678。",
			`[{"summary":"用户的号码是13812345678","category":"FACT","evidence":"13812345678"}]`},
		{"id card number", "我的证件号是 11010119900307851X。",
			`[{"summary":"用户的证件号是11010119900307851X","category":"FACT","evidence":"11010119900307851X"}]`},
		{"identifier only in evidence", "我住在杭州。",
			`[{"summary":"用户住在杭州","category":"FACT","evidence":"住在杭州 13812345678"}]`},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, ok := parseExtractOutput(tc.payload, extractMaxItems, tc.user)
			if !ok {
				t.Fatalf("array payload reported malformed")
			}
			if len(got) != 0 {
				t.Fatalf("saved %d items %+v, want 0", len(got), got)
			}
		})
	}
}

// TestParseExtractOutputKeepsPlainSelfFacts pins the T-13 positive: the
// narrowing must not become "save nothing". Ordinary explicit first-person
// preferences and self-stated facts still pass.
func TestParseExtractOutputKeepsPlainSelfFacts(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		user      string
		payload   string
		wantCount int
		wantFirst string
	}{
		{"preference with detail", "我喜欢喝不加糖的咖啡。",
			`[{"summary":"用户喜欢喝不加糖的咖啡","category":"PREFERENCE","evidence":"喜欢喝不加糖的咖啡"}]`,
			1, "用户喜欢喝不加糖的咖啡"},
		{"self fact", "我住在杭州，喜欢清晨散步。",
			`[{"summary":"用户住在杭州","category":"FACT","evidence":"我住在杭州"}]`,
			1, "用户住在杭州"},
		{"message start fact", "今天降温了，我穿了外套。",
			`[{"summary":"用户今天降温了","category":"FACT","evidence":"今天降温了"}]`,
			1, "用户今天降温了"},
		// A plain negative preference stays extractable: 不 alone is not one of
		// the refusal negation markers, and the anchored clause carries none.
		{"negative preference stays allowed", "我不喜欢熬夜，每天十一点睡。",
			`[{"summary":"用户不喜欢熬夜","category":"PREFERENCE","evidence":"不喜欢熬夜"}]`,
			1, "用户不喜欢熬夜"},
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

// TestParseExtractOutputProtocolEdges pins the payload-protocol boundary:
// `[]` is a legitimate empty result; JSON null (which Go decodes into a nil
// slice without error), a non-array object and broken JSON are protocol
// errors, not "nothing to extract".
func TestParseExtractOutputProtocolEdges(t *testing.T) {
	t.Parallel()
	user := "我喜欢喝茶。"
	if got, ok := parseExtractOutput("[]", 3, user); !ok || len(got) != 0 {
		t.Fatalf("empty array ok=%v %+v", ok, got)
	}
	if got, ok := parseExtractOutput("null", 3, user); ok || got != nil {
		t.Fatalf("null payload ok=%v %+v, want protocol error", ok, got)
	}
	if got, ok := parseExtractOutput("```json\nnull\n```", 3, user); ok || got != nil {
		t.Fatalf("fenced null ok=%v %+v, want protocol error", ok, got)
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
	routed := &routeCaptureProvider{text: `[{"summary":"用户喜欢安静","category":"PREFERENCE","evidence":"喜欢安静"}]`}
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
		{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"喜欢安静的地方"},
		{"summary":"用户有抑郁症病史","category":"FACT","evidence":"喜欢安静的地方"},
		{"summary":"用户住在火星","category":"FACT","evidence":"住在火星"},
		{"summary":"助手复述用户环游世界","category":"FACT","evidence":"测试轮次回复"},
		{"summary":"可能喜欢爬山","category":"FACT","evidence":"喜欢安静的地方"}]`}
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

// TestMemoryExtractSaveFailureReplaysStoredPayload pins the T-26 contract: a
// transient local save failure after a successful model call retries WITHOUT a
// second model call — the prepared attempt's stored payload replays through
// the parser, the retry saves exactly the same single row and no new outcome
// is written for the replayed run. The stored payload is the minimal accepted
// entries (8c), and the replay registers no new attempt (8a, attemptID 0).
func TestMemoryExtractSaveFailureReplaysStoredPayload(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true},
		retryAction: "RETRY_SCHEDULED",
		saveErr:     errors.New("save temporarily unavailable"),
	}
	provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"},
		{"summary":"可能喜欢爬山","category":"FACT","evidence":"喜欢安静的地方"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("model calls %d, want 1", provider.callCount())
	}
	if store.retryCalls != 1 || len(store.saved) != 0 {
		t.Fatalf("retry %d saved %+v, want requeued with nothing saved", store.retryCalls, store.saved)
	}
	// 8c: only the accepted entry persists — the dropped speculative item and
	// the raw model formatting never do.
	wantPayload := `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"}]`
	if len(store.outcomes) != 1 || store.outcomes[0].Status != "SUCCEEDED" || store.outcomes[0].OutputPayload != wantPayload {
		t.Fatalf("outcomes %+v, want one settled SUCCEEDED minimal payload %q", store.outcomes, wantPayload)
	}

	// The retry replays the stored payload through the parser.
	store.saveErr = nil
	store.priorPayload = store.outcomes[0].OutputPayload
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("model calls after replay %d, want 1 (no second model call)", provider.callCount())
	}
	if len(store.saved) != 1 || store.saved[0].Summary != "用户喜欢安静的地方" {
		t.Fatalf("saved %+v, want the replayed single row", store.saved)
	}
	if len(store.outcomes) != 1 {
		t.Fatalf("outcomes %+v, want no second outcome for the replay", store.outcomes)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "DONE" {
		t.Fatalf("closes %+v, want one DONE close", closes)
	}
}

// TestMemoryExtractStoresMinimalAcceptedPayload pins defect 8c at the handler
// level: the replayable attempt payload is the minimal JSON of exactly the
// entries that passed every server-side check — the raw model output (Markdown
// fence, sensitive-filtered items, unknown model fields) is never persisted.
func TestMemoryExtractStoresMinimalAcceptedPayload(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input: extractTestInput(),
		pref:  true,
		gate:  postgres.OutboundDecision{Allow: true, Code: "OK"},
	}
	provider := &extractTestProvider{text: "```json\n[" +
		`{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方","confidence":0.9},` +
		`{"summary":"用户有焦虑","category":"FACT","evidence":"我喜欢安静的地方"},` +
		`{"summary":"用户喜欢清晨散步","category":"PREFERENCE","evidence":"我喜欢清晨散步"}` +
		"]\n```"}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if len(store.saved) != 2 {
		t.Fatalf("saved %+v, want the two valid items", store.saved)
	}
	want := `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"},` +
		`{"summary":"用户喜欢清晨散步","category":"PREFERENCE","evidence":"我喜欢清晨散步"}]`
	if len(store.outcomes) != 1 || store.outcomes[0].Status != "SUCCEEDED" {
		t.Fatalf("outcomes %+v, want one settled SUCCEEDED outcome", store.outcomes)
	}
	if got := store.outcomes[0].OutputPayload; got != want {
		t.Fatalf("stored payload %q, want the minimal accepted entries %q", got, want)
	}
}

// TestMemoryExtractMalformedPayloadSettlesWithoutReplay pins the T-19/T-26
// split: a non-JSON payload settles the usage it produced, but is not stored
// as the replayable output — a retry must make a fresh model call instead of
// replaying the same broken payload forever.
func TestMemoryExtractMalformedPayloadSettlesWithoutReplay(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true},
		retryAction: "RETRY_SCHEDULED",
	}
	provider := &extractTestProvider{text: "这不是 JSON"}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if store.retryCalls != 1 {
		t.Fatalf("retry calls %d, want 1", store.retryCalls)
	}
	if len(store.outcomes) != 1 || store.outcomes[0].Status != "SUCCEEDED" || store.outcomes[0].OutputPayload != "" {
		t.Fatalf("outcomes %+v, want SUCCEEDED without a replayable payload", store.outcomes)
	}
}

// TestMemoryExtractClaimLostStopsWithoutOutbound pins the T-22 claim half: a
// pre-flight CLAIM_LOST decision fences the holder out with no provider call,
// no save and no retry burn.
func TestMemoryExtractClaimLostStopsWithoutOutbound(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:           extractTestInput(),
		pref:            true,
		gate:            postgres.OutboundDecision{Allow: true},
		prepareDecision: "CLAIM_LOST",
	}
	provider := &extractTestProvider{text: `[{"summary":"用户喜欢安静的地方","category":"PREFERENCE","evidence":"我喜欢安静的地方"}]`}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if provider.callCount() != 0 || len(store.saved) != 0 {
		t.Fatalf("calls %d saved %+v, want no outbound and no save", provider.callCount(), store.saved)
	}
	if store.retryCalls != 0 {
		t.Fatalf("retry calls %d, want 0 (a lost claim never burns a retry)", store.retryCalls)
	}
	if closes := store.closeCalls(); len(closes) != 1 || closes[0].status != "FAILED" || closes[0].reason != "EXTRACT_CLAIM_LOST" {
		t.Fatalf("closes %+v, want one FAILED EXTRACT_CLAIM_LOST close", closes)
	}
}

// TestExtractOutcomeUsageMapping pins the T-24 rule: provider-reported tokens
// are recorded real; missing usage decodes to nil pointers (the SQL then
// settles UNKNOWN, never zero), a provider error is FAILED with its failure
// class and a cancelled call is CANCELLED.
func TestExtractOutcomeUsageMapping(t *testing.T) {
	t.Parallel()
	usage := companion.AttemptResult{Usage: companion.Usage{InputTokens: 11, OutputTokens: 7, TotalTokens: 18}}
	out := extractOutcome(usage, nil, "[]")
	if out.Status != "SUCCEEDED" || out.InputTokens == nil || *out.InputTokens != 11 || out.OutputTokens == nil || *out.OutputTokens != 7 {
		t.Fatalf("reported usage %+v", out)
	}
	out = extractOutcome(companion.AttemptResult{}, nil, "")
	if out.Status != "SUCCEEDED" || out.InputTokens != nil || out.OutputTokens != nil {
		t.Fatalf("missing usage %+v, want nil tokens (UNKNOWN disposition)", out)
	}
	out = extractOutcome(companion.AttemptResult{}, companion.UpstreamUnavailable(), "")
	if out.Status != "FAILED" || out.FailureCode != "HTTP_5XX" || out.OutputPayload != "" {
		t.Fatalf("failed outcome %+v", out)
	}
	out = extractOutcome(companion.AttemptResult{}, context.Canceled, "")
	if out.Status != "CANCELLED" {
		t.Fatalf("cancelled outcome %+v", out)
	}
}

// TestMemoryExtractRealAdapterResponseCapSettlesTooLarge pins defect 3 against
// the real OpenAI adapter: the adapter classifies a sink error via
// classifyEmit/classifyParse into a companion error and drops the inner
// sentinel, so the handler must judge the cap from its own sink state after
// the call returns. An oversized completion from a local fake HTTP service
// (> extractMaxResponseBytes) must settle the attempt FAILED RESPONSE_TOO_LARGE
// with UNKNOWN usage (the aborted stream reports none), save nothing and burn
// exactly one bounded retry — never DISCONNECTED.
func TestMemoryExtractRealAdapterResponseCapSettlesTooLarge(t *testing.T) {
	t.Parallel()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "chat.completion",
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": strings.Repeat("x", extractMaxResponseBytes+1)},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{"prompt_tokens": 5, "completion_tokens": 900, "total_tokens": 905},
		})
	}))
	defer srv.Close()
	adapter, err := openai.New(openai.Config{
		Endpoint:    strings.TrimSuffix(srv.URL, "/") + "/v1/chat/completions",
		BearerToken: "offline-token-sentinel", Model: "offline-model-sentinel",
		ConnectTimeout: time.Second, FirstTokenTimeout: time.Second, TotalTimeout: 5 * time.Second,
		// Wider than the extraction sink cap: the adapter must pass the payload
		// through so the handler-owned buffer cap is what fires.
		MaxResponseBytes: 1 << 20, AllowLoopbackHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.Close()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true},
		retryAction: "RETRY_SCHEDULED",
	}
	loop := newExtractTestLoop(store, adapter)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := calls.Load(); got != 1 {
		t.Fatalf("provider calls %d, want exactly 1 bounded call", got)
	}
	if len(store.saved) != 0 || store.retryCalls != 1 {
		t.Fatalf("saved %+v retry %d, want nothing saved and one requeue", store.saved, store.retryCalls)
	}
	if len(store.outcomes) != 1 ||
		store.outcomes[0].Status != "FAILED" ||
		store.outcomes[0].FailureCode != "RESPONSE_TOO_LARGE" ||
		store.outcomes[0].InputTokens != nil || store.outcomes[0].OutputTokens != nil {
		t.Fatalf("outcomes %+v, want FAILED RESPONSE_TOO_LARGE with UNKNOWN usage", store.outcomes)
	}
}

// TestMemoryExtractResponseCapSettlesAndRetries pins the fixed extraction
// buffer cap: a payload exceeding extractMaxResponseBytes fails the call at
// the sink, the attempt settles FAILED RESPONSE_TOO_LARGE with no tokens (the
// aborted stream reports no usage — UNKNOWN, never zero), nothing is saved
// and the bounded retry applies without a second in-run model call.
func TestMemoryExtractResponseCapSettlesAndRetries(t *testing.T) {
	t.Parallel()
	store := &extractTestStore{
		input:       extractTestInput(),
		pref:        true,
		gate:        postgres.OutboundDecision{Allow: true},
		retryAction: "RETRY_SCHEDULED",
	}
	provider := &extractTestProvider{text: strings.Repeat("x", extractMaxResponseBytes+1)}
	loop := newExtractTestLoop(store, provider)
	if err := loop.handleMemoryExtract(context.Background(), extractTestClaim()); err != nil {
		t.Fatal(err)
	}
	if got := provider.callCount(); got != 1 {
		t.Fatalf("model calls %d, want 1 (the cap is one bounded call)", got)
	}
	if len(store.saved) != 0 || store.retryCalls != 1 {
		t.Fatalf("saved %+v retry %d, want nothing saved and one requeue", store.saved, store.retryCalls)
	}
	if len(store.outcomes) != 1 ||
		store.outcomes[0].Status != "FAILED" ||
		store.outcomes[0].FailureCode != "RESPONSE_TOO_LARGE" ||
		store.outcomes[0].InputTokens != nil || store.outcomes[0].OutputTokens != nil {
		t.Fatalf("outcomes %+v, want FAILED RESPONSE_TOO_LARGE with UNKNOWN usage", store.outcomes)
	}
}
