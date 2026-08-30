//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/jobs"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// g10sseFrame is one parsed SSE frame from the authenticated stream endpoint.
type g10sseFrame struct {
	name string
	text string
}

// sseStream opens the cookie-authenticated SSE stream and parses all frames
// until the handler returns (terminal or snapshot-only).
func sseStream(t *testing.T, s *Server, gid string, account int64) []g10sseFrame {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/realtime/streams/"+gid, nil)
	attachAuth(t, s, req, account, false)
	req.Header.Set("Origin", "https://vc.test")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("sse %d %s", rec.Code, rec.Body.String())
	}
	var frames []g10sseFrame
	for _, raw := range strings.Split(rec.Body.String(), "\n\n") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		var ev, data string
		for _, line := range strings.Split(raw, "\n") {
			switch {
			case strings.HasPrefix(line, "event: "):
				ev = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
		}
		var payload struct {
			Event string `json:"event"`
			Text  string `json:"text"`
		}
		_ = json.Unmarshal([]byte(data), &payload)
		if payload.Event != "" {
			ev = payload.Event
		}
		frames = append(frames, g10sseFrame{name: ev, text: payload.Text})
	}
	return frames
}

// fakeStreamProvider is the G10 worker fixture: fixed deltas, then usage.
// It honours ctx so cancel-during-stream is observable.
type fakeStreamProvider struct {
	deltas []string
	delay  time.Duration
	calls  atomic.Int32
}

func (f *fakeStreamProvider) Stream(ctx context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	f.calls.Add(1)
	for _, d := range f.deltas {
		if f.delay > 0 {
			select {
			case <-ctx.Done():
				return companion.AttemptResult{}, ctx.Err()
			case <-time.After(f.delay):
			}
		}
		if err := emit(companion.OutputDelta{Text: d}); err != nil {
			return companion.AttemptResult{}, err
		}
	}
	return companion.AttemptResult{
		Finish: companion.FinishStop,
		Usage:  companion.Usage{InputTokens: 12, OutputTokens: 8, TotalTokens: 20},
	}, nil
}

func g10Policy() jobs.Policy {
	return jobs.Policy{
		GenerationLease: 5 * time.Minute,
		ExportLease:     10 * time.Minute,
		DefaultLease:    60 * time.Second,
		ClaimLimit:      8,
		RecoverEvery:    time.Minute,
		QueueTimeout:    2 * time.Minute,
		PollIdle:        time.Second,
		PollBusy:        50 * time.Millisecond,
	}
}

func g10Budget() companion.TurnBudget {
	return companion.TurnBudget{
		MaxInputTokens:    8000,
		MaxOutputTokens:   2048,
		MaxResponseBytes:  256 << 10,
		ConnectTimeout:    10 * time.Second,
		FirstTokenTimeout: 60 * time.Second,
		TotalTimeout:      240 * time.Second,
		MaxAttempts:       1,
	}
}

// newG10Server wires the full-mode HTTP surface with the worker loop and hub,
// mirroring cmd/companiond wiring.
func newG10Server(t *testing.T, store *postgres.Store, loop *jobs.Loop, hub *realtime.Hub, mutate func(*config.Config)) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "full"
		case "VC_VERSION":
			return "test-version"
		case "VC_HTTP_ORIGINS":
			return "https://vc.test"
		case "VC_SESSION_COOKIE_SECURE":
			return "false"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if mutate != nil {
		mutate(&cfg)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	core := &Core{
		Store: store, Sessions: store, Passwords: pw, Limiter: auth.NewLimiter(), Turns: store,
	}
	if loop != nil {
		core.Cancels = loop.Cancels()
		core.Hub = hub
	}
	rt := &Realtime{Hub: hub, Sessions: store, Snapshots: store}
	return New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), rt, core)
}

func createCompanion(t *testing.T, s *Server) int64 {
	t.Helper()
	rec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("create companion %d %s", rec.Code, rec.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	return rel.RelationshipID
}

func createConversation(t *testing.T, s *Server, relID int64) int64 {
	t.Helper()
	rec := doJSON(t, s, http.MethodPost, "/api/v1/conversations",
		fmt.Sprintf(`{"relationshipId":%d}`, relID), 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("create conversation %d %s", rec.Code, rec.Body.String())
	}
	var conv struct {
		ConversationID int64 `json:"conversationId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &conv); err != nil {
		t.Fatal(err)
	}
	return conv.ConversationID
}

func sendGeneration(t *testing.T, s *Server, convID int64, key, content string) *httptest.ResponseRecorder {
	t.Helper()
	body := fmt.Sprintf(`{"idempotencyKey":%q,"userContent":%q,"mode":"AUTO"}`, key, content)
	return doJSON(t, s, http.MethodPost,
		fmt.Sprintf("/api/v1/conversations/%d/generations", convID), body, 1)
}

// grantConsents records the five ADR-0006 outbound consents for owner 1 via
// the API, mirroring the dogfood consent screens.
func grantConsents(t *testing.T, s *Server) {
	t.Helper()
	for _, typ := range []string{
		"SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE",
		"THIRD_PARTY_MODEL_PROCESSING", "SENSITIVE_DATA_PROCESSING",
	} {
		rec := doJSON(t, s, http.MethodPut, "/api/v1/consents",
			fmt.Sprintf(`{"consentType":%q,"version":"2026-08","granted":true}`, typ), 1)
		if rec.Code != http.StatusOK {
			t.Fatalf("consent %s: %d %s", typ, rec.Code, rec.Body.String())
		}
	}
}

func decodeGeneration(t *testing.T, rec *httptest.ResponseRecorder) generationJSON {
	t.Helper()
	var gen generationJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &gen); err != nil {
		t.Fatalf("generation body %s: %v", rec.Body.String(), err)
	}
	return gen
}

// subscribeWhenReady polls the hub until the generation is active, then
// subscribes. It fails when the generation terminalizes before subscribe.
func subscribeWhenReady(t *testing.T, hub *realtime.Hub, gid string, timeout time.Duration) *realtime.Sub {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if sub, err := hub.Subscribe(gid); err == nil {
			return sub
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("hub entry for %s never became subscribable", gid)
	return nil
}

func drainUntilTerminal(t *testing.T, sub *realtime.Sub, timeout time.Duration) []realtime.Event {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	var out []realtime.Event
	for {
		ev, ok := sub.Recv(ctx)
		if !ok {
			t.Fatalf("stream ended before terminal; got %d events", len(out))
		}
		out = append(out, ev)
		if ev.Terminal() {
			return out
		}
	}
}

func accumulatedText(events []realtime.Event) string {
	var b strings.Builder
	for _, ev := range events {
		if ev.Name == companion.EventSnapshot || ev.Name == companion.EventDelta {
			b.WriteString(ev.Text)
		}
	}
	return b.String()
}

func waitGenerationStatus(t *testing.T, store *postgres.Store, owner, genID int64, want string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		view, err := store.GetGeneration(context.Background(), owner, genID)
		if err == nil && view.Status == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	view, err := store.GetGeneration(context.Background(), owner, genID)
	t.Fatalf("generation %d not %s in %s: %+v %v", genID, want, timeout, view, err)
}

// isolationRow runs a superuser SELECT for one row of scalars (fixture facts).
func isolationRow(t *testing.T, sql string, args ...any) []any {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, postgres.IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	rows, err := pool.Query(ctx, sql, args...)
	if err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	defer rows.Close()
	if !rows.Next() {
		t.Fatalf("query %q: no row", sql)
	}
	vals, err := rows.Values()
	if err != nil {
		t.Fatalf("row %q: %v", sql, err)
	}
	return vals
}

func TestG10GenerationE2E(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	provider := &fakeStreamProvider{deltas: []string{"你好", "，今天", "累吗"}}
	hub := realtime.New()
	loop := jobs.NewLoop(slog.New(slog.DiscardHandler), g10Policy(), g10Budget())
	loop.Use(store, provider, hub, nil)
	s := newG10Server(t, store, loop, hub, nil)

	relID := createCompanion(t, s)
	convID := createConversation(t, s, relID)
	grantConsents(t, s)

	send := sendGeneration(t, s, convID, "e2e-1", "今天很累")
	if send.Code != http.StatusAccepted {
		t.Fatalf("send %d %s", send.Code, send.Body.String())
	}
	gen := decodeGeneration(t, send)
	if gen.Status != "QUEUED" {
		t.Fatalf("status %s", gen.Status)
	}

	// §19.5: idempotent replay returns the same recorded generation.
	replay := sendGeneration(t, s, convID, "e2e-1", "今天很累")
	if replay.Code != http.StatusAccepted {
		t.Fatalf("replay %d %s", replay.Code, replay.Body.String())
	}
	again := decodeGeneration(t, replay)
	if again.GenerationID != gen.GenerationID {
		t.Fatalf("replay id %s want %s", again.GenerationID, gen.GenerationID)
	}

	go func() { _ = loop.ClaimOnce(context.Background()) }()
	sub := subscribeWhenReady(t, hub, gen.GenerationID, 5*time.Second)
	defer sub.Close()
	events := drainUntilTerminal(t, sub, 15*time.Second)

	if events[0].Name != companion.EventSnapshot {
		t.Fatalf("first event %s want chat.snapshot", events[0].Name)
	}
	last := events[len(events)-1]
	if last.Name != companion.EventCompleted {
		t.Fatalf("terminal %s want chat.completed", last.Name)
	}
	if got := accumulatedText(events); got != "你好，今天累吗" {
		t.Fatalf("streamed text %q", got)
	}

	// Durable snapshot endpoint: terminal status, final message, usage.
	snapRec := doJSON(t, s, http.MethodGet, "/api/v1/generations/"+gen.GenerationID+"/snapshot", "", 1)
	if snapRec.Code != http.StatusOK {
		t.Fatalf("snapshot %d %s", snapRec.Code, snapRec.Body.String())
	}
	var snap generationSnapshotJSON
	if err := json.Unmarshal(snapRec.Body.Bytes(), &snap); err != nil {
		t.Fatal(err)
	}
	if snap.Status != "COMPLETED" || snap.AssistantMessageID == nil {
		t.Fatalf("snapshot %+v", snap)
	}
	if snap.Usage == nil || snap.Usage.InputTokens != 12 || snap.Usage.OutputTokens != 8 {
		t.Fatalf("usage %+v", snap.Usage)
	}

	// DB truth: one attempt SUCCEEDED + USAGE_REPORTED, one job, final message.
	genID, err := strconv.ParseInt(gen.GenerationID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	row := isolationRow(t,
		`SELECT status, billing_disposition FROM vc.attempt_intent
		  WHERE owner_user_id = 1 AND generation_id = $1`, genID)
	if row[0] == nil || fmt.Sprint(row[0]) != "SUCCEEDED" ||
		fmt.Sprint(row[1]) != "USAGE_REPORTED" {
		t.Fatalf("attempt %v", row)
	}
	jobCount := isolationRow(t,
		`SELECT count(*) FROM vc.work_item
		  WHERE owner_user_id = 1 AND kind = 'GENERATION' AND ref_id = $1`, genID)
	if fmt.Sprint(jobCount[0]) != "1" {
		t.Fatalf("job count %v", jobCount)
	}

	// The final assistant message is decryptable through the API.
	msgs := doJSON(t, s, http.MethodGet,
		fmt.Sprintf("/api/v1/conversations/%d/messages", convID), "", 1)
	if msgs.Code != http.StatusOK {
		t.Fatalf("messages %d %s", msgs.Code, msgs.Body.String())
	}
	var history []messageJSON
	if err := json.Unmarshal(msgs.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history) != 2 || history[1].Role != "assistant" || history[1].Content != "你好，今天累吗" {
		t.Fatalf("history %+v", history)
	}

	// §12.3: reconnect after terminal gets the durable snapshot, not a draft.
	sse := sseStream(t, s, gen.GenerationID, 1)
	if len(sse) < 2 {
		t.Fatalf("reconnect frames %v", sse)
	}
	if sse[0].name != "chat.snapshot" || sse[0].text != "你好，今天累吗" {
		t.Fatalf("reconnect snapshot %+v", sse[0])
	}
	if sse[len(sse)-1].name != "chat.completed" {
		t.Fatalf("reconnect terminal %+v", sse[len(sse)-1])
	}
}

func TestG10CancelDuringStream(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	provider := &fakeStreamProvider{
		deltas: []string{"一", "二", "三", "四", "五"},
		delay:  150 * time.Millisecond,
	}
	hub := realtime.New()
	loop := jobs.NewLoop(slog.New(slog.DiscardHandler), g10Policy(), g10Budget())
	loop.Use(store, provider, hub, nil)
	s := newG10Server(t, store, loop, hub, nil)

	relID := createCompanion(t, s)
	convID := createConversation(t, s, relID)
	grantConsents(t, s)
	gen := decodeGeneration(t, sendGeneration(t, s, convID, "cancel-1", "先别说完"))

	go func() { _ = loop.ClaimOnce(context.Background()) }()
	sub := subscribeWhenReady(t, hub, gen.GenerationID, 5*time.Second)
	defer sub.Close()

	// Wait for the first reviewed delta to hit the hub, then cancel.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	sawDelta := false
	for !sawDelta {
		ev, ok := sub.Recv(ctx)
		if !ok {
			t.Fatal("no delta before cancel")
		}
		sawDelta = ev.Name == companion.EventDelta
	}

	rec := doJSON(t, s, http.MethodPost, "/api/v1/generations/"+gen.GenerationID+"/cancel", "", 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel %d %s", rec.Code, rec.Body.String())
	}

	events := drainUntilTerminal(t, sub, 10*time.Second)
	if events[len(events)-1].Name != companion.EventCancelled {
		t.Fatalf("terminal %s want chat.cancelled", events[len(events)-1].Name)
	}
	if got := hub.Accumulator(gen.GenerationID); got != "" {
		t.Fatalf("accumulator not cleared after cancel: %q", got)
	}

	// DB: generation CANCELLED, attempt closed as OUTCOME_UNKNOWN-compatible,
	// no final assistant message, no assistant message in history.
	genID, err := strconv.ParseInt(gen.GenerationID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	waitGenerationStatus(t, store, 1, genID, "CANCELLED", 10*time.Second)
	row := isolationRow(t,
		`SELECT status, billing_disposition FROM vc.attempt_intent
		  WHERE owner_user_id = 1 AND generation_id = $1`, genID)
	if fmt.Sprint(row[0]) != "ABANDONED_LATE" ||
		fmt.Sprint(row[1]) != "UNKNOWN" {
		t.Fatalf("attempt after cancel %v", row)
	}
	msgs := doJSON(t, s, http.MethodGet,
		fmt.Sprintf("/api/v1/conversations/%d/messages", convID), "", 1)
	var history []messageJSON
	_ = json.Unmarshal(msgs.Body.Bytes(), &history)
	for _, m := range history {
		if m.Role == "assistant" {
			t.Fatalf("assistant message survived cancel: %+v", history)
		}
	}
	snap := doJSON(t, s, http.MethodGet, "/api/v1/generations/"+gen.GenerationID+"/snapshot", "", 1)
	var gs generationSnapshotJSON
	_ = json.Unmarshal(snap.Body.Bytes(), &gs)
	if gs.Status != "CANCELLED" || gs.AssistantMessageID != nil {
		t.Fatalf("snapshot after cancel %+v", gs)
	}
}

func TestG10OutstandingCapReturns429(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	hub := realtime.New()
	loop := jobs.NewLoop(slog.New(slog.DiscardHandler), g10Policy(), g10Budget())
	loop.Use(store, &fakeStreamProvider{deltas: []string{"好"}}, hub, nil)
	s := newG10Server(t, store, loop, hub, func(c *config.Config) {
		c.Concurrency.MaxOutstandingTurns = 2
	})

	relID := createCompanion(t, s)
	convID := createConversation(t, s, relID)
	grantConsents(t, s)

	var ids []int64
	for i := 0; i < 2; i++ {
		rec := sendGeneration(t, s, convID, fmt.Sprintf("cap-%d", i), "排队")
		if rec.Code != http.StatusAccepted {
			t.Fatalf("send %d: %d %s", i, rec.Code, rec.Body.String())
		}
		gen := decodeGeneration(t, rec)
		id, _ := strconv.ParseInt(gen.GenerationID, 10, 64)
		ids = append(ids, id)
	}

	// §19.5: at the cap, no message/generation/job is created; 429 + Retry-After.
	rec := sendGeneration(t, s, convID, "cap-2", "满了吗")
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("over cap %d %s", rec.Code, rec.Body.String())
	}
	if got := rec.Result().Header.Get("Retry-After"); got != "2" {
		t.Fatalf("Retry-After %q want 2", got)
	}
	assertEnvelope(t, rec, "RATE_LIMITED")
	row := isolationRow(t,
		`SELECT count(*) FROM vc.generation WHERE owner_user_id = $1 AND idempotency_key = $2`, 1, "cap-2")
	if fmt.Sprint(row[0]) != "0" {
		t.Fatalf("over-cap generation created %v", row)
	}

	// Drain the two queued generations, then the same key is accepted.
	go func() { _ = loop.ClaimOnce(context.Background()) }()
	for _, id := range ids {
		waitGenerationStatus(t, store, 1, id, "COMPLETED", 15*time.Second)
	}
	rec = sendGeneration(t, s, convID, "cap-2", "满了吗")
	if rec.Code != http.StatusAccepted {
		t.Fatalf("after drain %d %s", rec.Code, rec.Body.String())
	}
}
