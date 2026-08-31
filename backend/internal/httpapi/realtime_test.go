package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/realtime"
)

const testOrigin = "https://vc.test"
const testCookie = "owner-session-token"
const testGID = "42"

type memSessions map[string]auth.Principal

func (m memSessions) Lookup(_ context.Context, token string) (*auth.Principal, error) {
	p, ok := m[token]
	if !ok {
		return nil, nil
	}
	cp := p
	return &cp, nil
}

type memSnapshots struct {
	mu     sync.Mutex
	rows   map[int64]map[string]realtime.Snapshot
	inTx   atomic.Int32
	peakTx atomic.Int32
}

func newMemSnapshots() *memSnapshots {
	return &memSnapshots{rows: map[int64]map[string]realtime.Snapshot{}}
}

func (m *memSnapshots) put(owner int64, gid string, snap realtime.Snapshot) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.rows[owner] == nil {
		m.rows[owner] = map[string]realtime.Snapshot{}
	}
	m.rows[owner][gid] = snap
}

func (m *memSnapshots) Load(_ context.Context, owner int64, gid string) (realtime.Snapshot, bool, error) {
	n := m.inTx.Add(1)
	defer m.inTx.Add(-1)
	if n > m.peakTx.Load() {
		m.peakTx.Store(n)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[owner][gid]
	return row, ok, nil
}

func TestTicketEndpointNotRegistered(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	rec := httptest.NewRecorder()
	env.srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/realtime/tickets", strings.NewReader(`{}`)))
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("ticket endpoint must not exist, got %d", rec.Code)
	}
}

func TestSSEAllowsMissingOriginButRequiresCookie(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	h := env.srv.Handler()

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/realtime/streams/"+testGID, nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing cookie %d", rec.Code)
	}
	assertEnvelope(t, rec, "AUTHENTICATION_REQUIRED")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/realtime/streams/"+testGID, nil)
	req.Header.Set("Origin", "https://evil.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")

	req = httptest.NewRequest(http.MethodGet, "/api/v1/realtime/streams/"+testGID, nil)
	req.Header.Set("Origin", testOrigin)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("missing cookie %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/realtime/streams/"+testGID, nil)
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Authorization", "Bearer pretend-jwt")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer must not authenticate SSE %d", rec.Code)
	}
}

func TestSSEHidesForeignGeneration(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	req := authed(http.MethodGet, "/api/v1/realtime/streams/99")
	rec := httptest.NewRecorder()
	env.srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("code %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "NOT_FOUND_OR_FORBIDDEN") {
		t.Fatalf("body %s", rec.Body.String())
	}
}

func TestTwoSubscribersSameSequence(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.Accepted(testGID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	a := openSSE(t, ts.URL, ctx)
	b := openSSE(t, ts.URL, ctx)
	defer a.Body.Close()
	defer b.Body.Close()

	env.hub.Append(testGID, "你好")
	env.hub.Append(testGID, "世界")
	env.snaps.put(1, testGID, realtime.Snapshot{Terminal: companion.EventCompleted, Text: "你好世界"})
	env.hub.Completed(testGID)

	gotA := readUntilTerminal(t, a.Body)
	gotB := readUntilTerminal(t, b.Body)
	if compact(gotA) != compact(gotB) {
		t.Fatalf("mismatch\nA=%s\nB=%s", compact(gotA), compact(gotB))
	}
	joined := textsOf(gotA)
	if !strings.Contains(joined, "你好") || !strings.Contains(joined, "世界") {
		t.Fatalf("text %q", joined)
	}
	for _, ev := range gotA {
		if strings.Contains(ev.raw, "\nid:") {
			t.Fatal("sse id")
		}
	}
}

func TestSlowSubscriberDoesNotBlockProvider(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.Accepted(testGID)

	slow, err := env.hub.Subscribe(testGID)
	if err != nil {
		t.Fatal(err)
	}
	defer slow.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	fast := openSSE(t, ts.URL, ctx)
	defer fast.Body.Close()

	var fastN atomic.Int32
	go func() {
		br := bufio.NewReader(fast.Body)
		for {
			_, err := readFrame(br)
			if err != nil {
				return
			}
			fastN.Add(1)
		}
	}()

	chunk := strings.Repeat("n", 1024)
	pubDone := make(chan struct{})
	go func() {
		for i := 0; i < 200; i++ {
			env.hub.Append(testGID, chunk)
		}
		close(pubDone)
	}()
	select {
	case <-pubDone:
	case <-time.After(2 * time.Second):
		t.Fatal("publisher blocked")
	}
	waitFor(t, func() bool { return env.hub.Stats().SlowDisconnects >= 1 }, "slow drop")
	waitFor(t, func() bool { return fastN.Load() >= 5 }, "fast events")
}

func TestReconnectAfterTerminalUsesDB(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.TTL = 5 * time.Millisecond
	env.hub.Accepted(testGID)
	env.hub.Append(testGID, "最终回复")
	env.snaps.put(1, testGID, realtime.Snapshot{Terminal: companion.EventCompleted, Text: "最终回复"})
	env.hub.Completed(testGID)
	waitFor(t, func() bool { return !env.hub.Exists(testGID) }, "ttl")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	res := openSSE(t, ts.URL, ctx)
	defer res.Body.Close()
	evs := readUntilTerminal(t, res.Body)
	if evs[0].name != "chat.snapshot" || !strings.Contains(evs[0].data, "最终回复") {
		t.Fatalf("%+v", evs[0])
	}
	if evs[len(evs)-1].name != "chat.completed" {
		t.Fatalf("terminal %+v", evs)
	}
	if env.hub.Stats().SnapshotResumes < 1 {
		t.Fatal("snapshot resume not counted")
	}
}

func TestBlockedReconnectHasNoPartial(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.Accepted(testGID)
	env.hub.Append(testGID, "旧草稿不得重连出现")
	env.snaps.put(1, testGID, realtime.Snapshot{Terminal: companion.EventBlocked, Text: ""})
	env.hub.Blocked(testGID)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	res := openSSE(t, ts.URL, ctx)
	defer res.Body.Close()
	evs := readUntilTerminal(t, res.Body)
	for _, ev := range evs {
		if strings.Contains(ev.data, "旧草稿") {
			t.Fatalf("partial leaked: %+v", ev)
		}
	}
	if evs[len(evs)-1].name != "chat.blocked" {
		t.Fatalf("%+v", evs)
	}
}

func TestNoHubDoesNotInventPartial(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	env.snaps.put(1, testGID, realtime.Snapshot{})
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	res := openSSE(t, ts.URL, ctx)
	defer res.Body.Close()
	evs := readAvailable(t, res.Body)
	if len(evs) < 1 || evs[0].name != "chat.snapshot" {
		t.Fatalf("%+v", evs)
	}
	if strings.Contains(evs[0].data, "partial") {
		t.Fatal("invented partial")
	}
}

func TestNoDBTransactionHeldDuringStream(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.Accepted(testGID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	res := openSSE(t, ts.URL, ctx)
	defer res.Body.Close()
	br := bufio.NewReader(res.Body)
	if _, err := readFrame(br); err != nil {
		t.Fatal(err)
	}
	var held atomic.Bool
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 30; i++ {
			if env.snaps.inTx.Load() != 0 {
				held.Store(true)
			}
			env.hub.Append(testGID, "x")
			time.Sleep(5 * time.Millisecond)
		}
	}()
	<-done
	if held.Load() {
		t.Fatal("snapshot transaction held during SSE")
	}
	if env.snaps.peakTx.Load() > 1 {
		t.Fatalf("overlapping snapshot tx %d", env.snaps.peakTx.Load())
	}
	cancel()
}

func TestSubscriberExitCleansHub(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	env.hub.Accepted(testGID)
	ctx, cancel := context.WithCancel(context.Background())
	res := openSSE(t, ts.URL, ctx)
	_ = readAvailable(t, io.LimitReader(res.Body, 256))
	cancel()
	res.Body.Close()
	waitFor(t, func() bool { return env.hub.LiveSubscribers(testGID) == 0 && env.hub.Stats().Subscribers == 0 }, "sub leak")
	if !env.hub.Exists(testGID) {
		t.Fatal("last client must not cancel generation hub")
	}
	if env.snaps.inTx.Load() != 0 {
		t.Fatal("tx after close")
	}
}

func TestTicketQueryIgnored(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	env.hub.Accepted(testGID)
	env.snaps.put(1, testGID, realtime.Snapshot{Terminal: companion.EventCompleted, Text: "ok"})
	env.hub.Completed(testGID)
	req := authed(http.MethodGet, "/api/v1/realtime/streams/"+testGID+"?ticketId=x&secret=y&sessionId=z")
	req.Header.Set("Last-Event-ID", "99")
	rec := httptest.NewRecorder()
	env.srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "stream.gap") || strings.Contains(body, "stream.reset") {
		t.Fatal("ticket resume protocol")
	}
	if !strings.Contains(body, "chat.snapshot") {
		t.Fatalf("missing snapshot %q", body)
	}
}

type rtEnv struct {
	srv   *Server
	hub   *realtime.Hub
	snaps *memSnapshots
}

func newRT(t *testing.T) *rtEnv {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "full"
		case "VC_VERSION":
			return "test-version"
		case "VC_COMMIT":
			return "deadbeef"
		case "VC_HTTP_ORIGINS":
			return testOrigin
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	hub := realtime.New()
	snaps := newMemSnapshots()
	snaps.put(1, testGID, realtime.Snapshot{})
	rt := &Realtime{
		Hub:       hub,
		Sessions:  memSessions{testCookie: {AccountID: 1}},
		Snapshots: snaps,
	}
	srv := New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), rt, nil)
	return &rtEnv{srv: srv, hub: hub, snaps: snaps}
}

func authed(method, path string) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Origin", testOrigin)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testCookie})
	return req
}

func openSSE(t *testing.T, base string, ctx context.Context) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/realtime/streams/"+testGID, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Accept", "text/event-stream")
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testCookie})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("sse %d %s", res.StatusCode, b)
	}
	return res
}

type sseFrame struct {
	name string
	data string
	raw  string
}

func readUntilTerminal(t *testing.T, r io.Reader) []sseFrame {
	t.Helper()
	br := bufio.NewReader(r)
	var out []sseFrame
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		fr, err := readFrame(br)
		if err != nil {
			break
		}
		out = append(out, fr)
		switch fr.name {
		case "chat.completed", "chat.blocked", "chat.failed", "chat.cancelled":
			return out
		}
	}
	if len(out) == 0 {
		t.Fatal("no sse frames")
	}
	return out
}

func readAvailable(t *testing.T, r io.Reader) []sseFrame {
	t.Helper()
	br := bufio.NewReader(r)
	var out []sseFrame
	_ = r
	fr, err := readFrame(br)
	if err != nil {
		t.Fatal(err)
	}
	out = append(out, fr)
	return out
}

func readFrame(br *bufio.Reader) (sseFrame, error) {
	var raw bytes.Buffer
	var name, data string
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return sseFrame{}, err
		}
		raw.WriteString(line)
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if name == "" && data == "" {
				continue
			}
			return sseFrame{name: name, data: data, raw: raw.String()}, nil
		}
		if strings.HasPrefix(line, "event:") {
			name = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		}
		if strings.HasPrefix(line, "data:") {
			data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
	}
}

func compact(evs []sseFrame) string {
	var b strings.Builder
	for _, ev := range evs {
		b.WriteString(ev.name)
		b.WriteByte('|')
		b.WriteString(ev.data)
		b.WriteByte(';')
	}
	return b.String()
}

func textsOf(evs []sseFrame) string {
	var b strings.Builder
	for _, ev := range evs {
		var payload map[string]any
		_ = json.Unmarshal([]byte(ev.data), &payload)
		if t, ok := payload["text"].(string); ok {
			b.WriteString(t)
		}
	}
	return b.String()
}

func waitFor(t *testing.T, ok func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}
