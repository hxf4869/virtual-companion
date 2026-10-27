package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
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

// TestRealHTTPSlowSubscriberIsolatedAndExits proves slow-subscriber isolation
// and bounded exit on a real TCP socket with genuine kernel backpressure, not
// a hub-level slow queue. The slow client connects through the full
// Server.Handler() chain (small SO_RCVBUF before connect, small SO_SNDBUF on
// the accepted side) and never reads the body; the payload is `<`, which
// json.Marshal expands ~6x on the wire (~1.2 MiB for 200 KiB logical), past
// what macOS loopback auto-tuning absorbs, so the handler's writes really
// stall in the kernel. Publishing steps with the fast reader's observed
// frame progress so the healthy subscriber's queue is never flooded. Required outcomes: the hub drops the non-draining subscriber from
// fan-out while the fast subscriber — draining concurrently the whole time —
// receives the full committed result with exactly one terminal (so the drop
// hit the slow one), each stalled handler exits on the per-write deadline
// while nobody reads its socket (observed via ConnState StateClosed, which
// fires only after the connection goroutine returns), and only then does
// draining see a definitive EOF or peer reset. The commit/complete step is a
// fixture standing in for the worker and DB: this test covers the Go HTTP
// regression slice; the G12 full public-chain slow scenario stays open.
func TestRealHTTPSlowSubscriberIsolatedAndExits(t *testing.T) {
	t.Parallel()
	env := newRTWithEnv(t, map[string]string{"VC_HTTP_SSE_WRITE_TIMEOUT": "200ms"})
	watch := &connStateWatch{idle: map[string]bool{}, closed: map[string]bool{}}
	// The same handler is served twice: the tight-buffer listener carries the
	// stalled subscribers, the normal one the fast subscriber, so a slow
	// stream cannot perturb the healthy stream's kernel buffers.
	slowTS := httptest.NewUnstartedServer(env.srv.Handler())
	slowTS.Config.ConnState = watch.hook
	// Wrap the listener httptest already created; replacing it would leak it.
	slowTS.Listener = &tightBufferListener{Listener: slowTS.Listener, fail: func(err error) {
		t.Errorf("tight buffer listener: %v", err)
	}}
	slowTS.Start()
	t.Cleanup(slowTS.Close)
	fastTS := httptest.NewServer(env.srv.Handler())
	t.Cleanup(fastTS.Close)
	env.hub.Accepted(testGID)

	// Handshake proves the server-side subscribe and stream head completed
	// before anything is published; the body stays unread.
	slowLive := dialSlowSSE(t, slowTS.Listener.Addr().String())

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	fast := openSSE(t, fastTS.URL, ctx)
	defer fast.Body.Close()
	drained := drainFast(fast.Body)

	// Push well past one subscriber queue (128 events / 128 KiB) and past
	// the slow connection's 8 KiB send + 4 KiB receive buffers.
	// `<` expands to \u003c under json.Marshal: ~6 KiB on the wire per event,
	// within the 16 KiB event cap, while the logical accumulator stays at
	// 200 KiB total — no production limit is relaxed.
	chunk := strings.Repeat("<", 1024)
	const totalChunks = 200
	published := 0
	pubDone := make(chan struct{})
	go func() {
		defer close(pubDone)
		for published < totalChunks {
			for i := 0; i < 16 && published < totalChunks; i++ {
				env.hub.Append(testGID, chunk)
				published++
			}
			// Step with the fast reader's actual progress instead of
			// flooding all queues at once.
			want := published
			deadline := time.Now().Add(2 * time.Second)
			for time.Now().Before(deadline) {
				if countEvents(drained.framesOf(), "chat.delta") >= want {
					break
				}
				time.Sleep(5 * time.Millisecond)
			}
		}
	}()
	select {
	case <-pubDone:
	case <-time.After(10 * time.Second):
		t.Fatal("publisher blocked by real slow subscriber")
	}
	// The non-draining subscriber is dropped from fan-out; the fast
	// subscriber's full closure below proves it survived this drop.
	waitFor(t, func() bool { return env.hub.Stats().SlowDisconnects >= 1 }, "slow live disconnect")

	// Fixture completion standing in for the worker/DB commit.
	finalText := strings.Repeat("<", 200*1024)
	env.snaps.put(1, testGID, realtime.Snapshot{Terminal: companion.EventCompleted, Text: finalText})
	env.hub.TTL = 500 * time.Millisecond
	env.hub.Completed(testGID)

	select {
	case <-drained.done:
	case <-time.After(2 * time.Second):
		t.Fatal("fast stream did not finish")
	}
	evs := drained.framesOf()
	if len(evs) == 0 {
		t.Fatal("fast subscriber received nothing")
	}
	// The committed replay splits into one chat.snapshot followed by
	// chat.delta chunks (§12.2: snapshot replaces the draft, deltas append).
	// Replay the frames the way the H5 store does; the final draft must be
	// exactly the one committed result and the terminal must be unique.
	var draft strings.Builder
	terminals := 0
	for _, fr := range evs {
		switch fr.name {
		case "chat.completed", "chat.blocked", "chat.failed", "chat.cancelled":
			terminals++
		case "chat.snapshot":
			draft.Reset()
			draft.WriteString(sseText(t, fr))
		case "chat.delta":
			draft.WriteString(sseText(t, fr))
		}
	}
	if terminals != 1 || evs[len(evs)-1].name != "chat.completed" {
		t.Fatalf("expected exactly one terminal chat.completed, got %d", terminals)
	}
	if draft.String() != finalText {
		t.Fatalf("fast final draft bytes %d want %d", draft.Len(), len(finalText))
	}

	// The same stalled-drain pattern on the closed-hub catch-up path (before
	// the TTL drop) and on the durable snapshot path (after it).
	slowDone := dialSlowSSE(t, slowTS.Listener.Addr().String())
	waitFor(t, func() bool { return !env.hub.Exists(testGID) }, "hub ttl drop")
	slowSnapshot := dialSlowSSE(t, slowTS.Listener.Addr().String())

	// Handler exit observed without reading or closing anything. The live
	// subscriber can only ever receive the hub queue's bounded slice
	// (~21 events ≈ 126 KiB on the wire before the overflow disconnect), less
	// than the kernel absorbs, so its bounded exit may legitimately end in
	// keep-alive idle; the catch-up and durable snapshot streams push the
	// full ~1.2 MiB each, genuinely stall in the kernel, and must be closed
	// by the server after the write deadline fires.
	waitFor(t, func() bool { return watch.handlerFinished(slowLive.LocalAddr().String()) }, "slow live handler exit")
	waitFor(t, func() bool { return watch.isClosed(slowDone.LocalAddr().String()) }, "slow done server close")
	waitFor(t, func() bool { return watch.isClosed(slowSnapshot.LocalAddr().String()) }, "slow snapshot server close")

	// Only connections the server actually closed: draining must see
	// definitive EOF or a peer reset, never a read deadline or anything else.
	drainClosedConn(t, slowDone)
	drainClosedConn(t, slowSnapshot)

	waitFor(t, func() bool { return env.hub.Stats().Subscribers == 0 }, "subscriber cleanup")
	cancel()
	fast.Body.Close()
	waitFor(t, func() bool { return env.hub.Stats().Subscribers == 0 && env.hub.LiveSubscribers(testGID) == 0 }, "fast cleanup")
}

func TestSSEWriteTimeoutConfig(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	if d := env.srv.cfg.HTTP.SSEWriteTimeout; d != 10*time.Second {
		t.Fatalf("default sse write timeout %s", d)
	}
}

func sseText(t *testing.T, fr sseFrame) string {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(fr.data), &payload); err != nil {
		t.Fatalf("frame %s: %v", fr.name, err)
	}
	text, _ := payload["text"].(string)
	return text
}

// connStateWatch records per-connection terminal ConnState transitions.
// StateClosed fires only after the connection goroutine returned and the
// server closed the socket; StateIdle fires when a handler finished and the
// connection returned to keep-alive. Both prove the handler exited — the
// test never reads or closes the connection to find out.
type connStateWatch struct {
	mu     sync.Mutex
	idle   map[string]bool
	closed map[string]bool
}

func (w *connStateWatch) hook(c net.Conn, cs http.ConnState) {
	switch cs {
	case http.StateIdle:
		w.mu.Lock()
		w.idle[c.RemoteAddr().String()] = true
		w.mu.Unlock()
	case http.StateClosed:
		w.mu.Lock()
		w.closed[c.RemoteAddr().String()] = true
		w.mu.Unlock()
	}
}

func (w *connStateWatch) handlerFinished(remote string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.idle[remote] || w.closed[remote]
}

func (w *connStateWatch) isClosed(remote string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed[remote]
}

// sseDrain reads an SSE stream concurrently and keeps what it saw.
type sseDrain struct {
	mu     sync.Mutex
	frames []sseFrame
	done   chan struct{}
}

func drainFast(body io.Reader) *sseDrain {
	d := &sseDrain{done: make(chan struct{})}
	go func() {
		defer close(d.done)
		br := bufio.NewReader(body)
		var frames []sseFrame
		publish := func() {
			d.mu.Lock()
			d.frames = frames
			d.mu.Unlock()
		}
		for {
			fr, err := readFrame(br)
			if err != nil {
				publish()
				return
			}
			frames = append(frames, fr)
			switch fr.name {
			case "chat.completed", "chat.blocked", "chat.failed", "chat.cancelled":
				publish()
				return
			default:
				publish()
			}
		}
	}()
	return d
}

func (d *sseDrain) framesOf() []sseFrame {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.frames
}

func countEvents(frames []sseFrame, name string) int {
	n := 0
	for _, fr := range frames {
		if fr.name == name {
			n++
		}
	}
	return n
}

// tightBufferListener shrinks the accepted connection's send buffer and
// reports any failure to apply it. Together with the slow client's small
// receive buffer and the `<` payload below, the stream's ~1.2 MiB on the
// wire exceeds what macOS loopback auto-tuning absorbs, so the handler's
// writes genuinely stall in the kernel (Root-probed: 53 frames land, then
// the write blocks) — no fault injection anywhere in the write path. No
// production limit moves: the logical accumulator stays 200 KiB < 256 KiB,
// each event encodes to ~6 KiB < the 16 KiB MaxEventBytes cap, and
// splitNamed already slices by encodedLen.
type tightBufferListener struct {
	net.Listener
	fail func(error)
}

func (l *tightBufferListener) Accept() (net.Conn, error) {
	c, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	tc, ok := c.(*net.TCPConn)
	if !ok {
		l.fail(fmt.Errorf("accepted non-TCP conn %T", c))
		return nil, fmt.Errorf("non-tcp conn %T", c)
	}
	if err := tc.SetWriteBuffer(8 << 10); err != nil {
		l.fail(err)
		_ = c.Close()
		return nil, err
	}
	return c, nil
}

// dialSlowSSE opens a raw HTTP/1.1 SSE request over TCP with a small receive
// buffer set before connect (so the peer window really shrinks). It waits for
// the response head so the server-side handler has subscribed and established
// the stream before the caller publishes; the body stays unread.
func dialSlowSSE(t *testing.T, addr string) net.Conn {
	t.Helper()
	d := net.Dialer{Control: func(_, _ string, c syscall.RawConn) error {
		var serr error
		if err := c.Control(func(fd uintptr) {
			serr = syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_RCVBUF, 4<<10)
		}); err != nil {
			return err
		}
		return serr
	}}
	conn, err := d.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	req := "GET /api/v1/realtime/streams/" + testGID + " HTTP/1.1\r\n" +
		"Host: " + addr + "\r\n" +
		"Origin: " + testOrigin + "\r\n" +
		"Accept: text/event-stream\r\n" +
		"Cookie: " + auth.SessionCookieName + "=" + testCookie + "\r\n\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatal(err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(2 * time.Second)); err != nil {
		t.Fatal(err)
	}
	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("slow sse head: %v", err)
	}
	if !strings.HasPrefix(status, "HTTP/1.1 200") {
		t.Fatalf("slow sse status %q", status)
	}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("slow sse head: %v", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
	}
	if err := conn.SetReadDeadline(time.Time{}); err != nil {
		t.Fatal(err)
	}
	return conn
}

// drainClosedConn accepts only definitive server-close evidence: a clean EOF
// or a peer reset. A read deadline or any other error means the server never
// closed the stalled stream and fails the test.
func drainClosedConn(t *testing.T, c net.Conn) {
	t.Helper()
	if err := c.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	_, err := io.Copy(io.Discard, c)
	switch {
	case err == nil, errors.Is(err, io.EOF), errors.Is(err, syscall.ECONNRESET):
		return
	default:
		t.Fatalf("connection not closed by server: %v", err)
	}
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
	ts := httptest.NewServer(env.srv.Handler())
	t.Cleanup(ts.Close)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/realtime/streams/"+testGID+"?ticketId=x&secret=y&sessionId=z", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", testOrigin)
	req.Header.Set("Last-Event-ID", "99")
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: testCookie})
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("code %d %s", res.StatusCode, body)
	}
	if strings.Contains(string(body), "stream.gap") || strings.Contains(string(body), "stream.reset") {
		t.Fatal("ticket resume protocol")
	}
	if !strings.Contains(string(body), "chat.snapshot") {
		t.Fatalf("missing snapshot %q", body)
	}
}

type rtEnv struct {
	srv   *Server
	hub   *realtime.Hub
	snaps *memSnapshots
}

func newRT(t *testing.T) *rtEnv {
	return newRTWithEnv(t, nil)
}

func newRTWithEnv(t *testing.T, extra map[string]string) *rtEnv {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		if v, ok := extra[k]; ok {
			return v
		}
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

func TestSubscriberLimitResponds429RateLimited(t *testing.T) {
	t.Parallel()
	env := newRT(t)
	env.hub.Accepted(testGID)
	for i := 0; i < realtime.MaxSubscribers; i++ {
		if _, err := env.hub.Subscribe(testGID); err != nil {
			t.Fatalf("fill subscriber slots: %v", err)
		}
	}
	rec := httptest.NewRecorder()
	env.srv.Handler().ServeHTTP(rec, authed(http.MethodGet, "/api/v1/realtime/streams/"+testGID))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After header")
	}
	assertEnvelope(t, rec, "RATE_LIMITED")
}
