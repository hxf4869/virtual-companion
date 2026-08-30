package realtime

import (
	"context"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestFanOutSameOrderTwoSubscribers(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	a, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	h.Append("g1", "你好")
	h.Append("g1", "世界")
	h.Completed("g1")
	gotA := drain(t, a, 3)
	gotB := drain(t, b, 3)
	if names(gotA) != names(gotB) || texts(gotA) != texts(gotB) {
		t.Fatalf("mismatch\nA=%v\nB=%v", gotA, gotB)
	}
	if !strings.Contains(texts(gotA), "你好") || !strings.Contains(texts(gotA), "世界") {
		t.Fatalf("text %q", texts(gotA))
	}
}

func TestSubscribeSnapshotThenLiveDeltaOrder(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	h.Append("g1", "前缀")
	sub, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	h.Append("g1", "后缀")
	snap, ok := recvTimeout(t, sub)
	if !ok || snap.Name != companion.EventSnapshot || snap.Text != "前缀" {
		t.Fatalf("snapshot %+v ok=%v", snap, ok)
	}
	delta, ok := recvTimeout(t, sub)
	if !ok || delta.Name != companion.EventDelta || delta.Text != "后缀" {
		t.Fatalf("delta %+v ok=%v", delta, ok)
	}
}

func TestSlowSubscriberDoesNotBackpressure(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	slow, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer slow.Close()
	fast, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer fast.Close()

	var n atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		for {
			_, ok := fast.Recv(ctx)
			if !ok {
				return
			}
			n.Add(1)
		}
	}()

	chunk := strings.Repeat("z", 1024)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 300; i++ {
			h.Append("g1", chunk)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("publisher blocked by slow subscriber")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if h.Stats().SlowDisconnects >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if h.Stats().SlowDisconnects < 1 {
		t.Fatal("slow subscriber was not dropped")
	}
	if n.Load() < 10 {
		t.Fatalf("fast subscriber starved, got %d", n.Load())
	}
	if h.Accumulator("g1") == "" {
		t.Fatal("generation accumulator cleared")
	}
}

func TestBlockedClearsAccumulator(t *testing.T) {
	t.Parallel()
	h := New()
	h.TTL = 50 * time.Millisecond
	h.Accepted("g1")
	h.Append("g1", "旧草稿")
	live, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	h.Blocked("g1")
	if h.Accumulator("g1") != "" {
		t.Fatal("blocked must clear accumulator")
	}
	evs := drain(t, live, 2)
	var sawBlocked bool
	for _, ev := range evs {
		if ev.Name == companion.EventBlocked {
			sawBlocked = true
		}
	}
	if !sawBlocked {
		t.Fatalf("missing blocked: %+v", evs)
	}
	re, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	defer re.Close()
	again := drain(t, re, 2)
	if again[0].Name != companion.EventSnapshot || again[0].Text != "" {
		t.Fatalf("reconnect snapshot %+v", again[0])
	}
	if again[1].Name != companion.EventBlocked {
		t.Fatalf("reconnect terminal %+v", again[1])
	}
}

func TestLateAppendAfterTerminalDropped(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	h.Append("g1", "x")
	h.Failed("g1")
	h.Append("g1", "晚到")
	if h.Accumulator("g1") != "" {
		t.Fatal("late token entered accumulator")
	}
}

func TestLastSubscriberLeaveDoesNotCancel(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	sub, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	sub.Close()
	if !h.Exists("g1") {
		t.Fatal("hub entry removed when last subscriber left")
	}
	h.Append("g1", "仍在生成")
	if h.Accumulator("g1") != "仍在生成" {
		t.Fatalf("acc %q", h.Accumulator("g1"))
	}
}

func TestIdleHasNoHub(t *testing.T) {
	t.Parallel()
	h := New()
	if h.Exists("missing") {
		t.Fatal("idle")
	}
	if _, err := h.Subscribe("missing"); err != ErrNotFound {
		t.Fatalf("err %v", err)
	}
}

func TestSubscriberLimit(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	var subs []*Sub
	for i := 0; i < MaxSubscribers; i++ {
		s, err := h.Subscribe("g1")
		if err != nil {
			t.Fatal(err)
		}
		subs = append(subs, s)
	}
	defer func() {
		for _, s := range subs {
			s.Close()
		}
	}()
	if _, err := h.Subscribe("g1"); err != ErrTooMany {
		t.Fatalf("got %v", err)
	}
}

func TestUnsubscribeCleansChannel(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	before := runtime.NumGoroutine()
	sub, err := h.Subscribe("g1")
	if err != nil {
		t.Fatal(err)
	}
	if h.LiveSubscribers("g1") != 1 || h.Stats().Subscribers != 1 {
		t.Fatal("count")
	}
	sub.Close()
	if h.LiveSubscribers("g1") != 0 || h.Stats().Subscribers != 0 {
		t.Fatalf("leaked subs live=%d stats=%d", h.LiveSubscribers("g1"), h.Stats().Subscribers)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if runtime.NumGoroutine() <= before+2 {
			return
		}
		runtime.GC()
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("goroutines %d -> %d", before, runtime.NumGoroutine())
}

func TestTerminalTTLRemovesHub(t *testing.T) {
	t.Parallel()
	h := New()
	h.TTL = 20 * time.Millisecond
	h.Accepted("g1")
	h.Completed("g1")
	if !h.Exists("g1") {
		t.Fatal("ttl should keep hub briefly")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if !h.Exists("g1") {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("hub not cleaned after ttl")
}

func TestConcurrentSubscribeDuringAppend(t *testing.T) {
	t.Parallel()
	h := New()
	h.Accepted("g1")
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			h.Append("g1", "x")
		}
	}()
	var seen []Event
	for i := 0; i < 8; i++ {
		s, err := h.Subscribe("g1")
		if err != nil {
			t.Fatal(err)
		}
		ev, ok := s.Recv(context.Background())
		if !ok || ev.Name != companion.EventSnapshot {
			t.Fatalf("first %+v ok=%v", ev, ok)
		}
		seen = append(seen, ev)
		s.Close()
	}
	wg.Wait()
	if len(seen) != 8 {
		t.Fatal("missing snapshots")
	}
}

func recvTimeout(t *testing.T, s *Sub) (Event, bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	return s.Recv(ctx)
}

func drain(t *testing.T, s *Sub, atLeast int) []Event {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var out []Event
	for {
		ev, ok := s.Recv(ctx)
		if !ok {
			break
		}
		out = append(out, ev)
		if ev.Terminal() {
			break
		}
	}
	if len(out) < atLeast {
		t.Fatalf("drained %d want >= %d", len(out), atLeast)
	}
	return out
}

func names(evs []Event) string {
	var b strings.Builder
	for i, ev := range evs {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(string(ev.Name))
	}
	return b.String()
}

func texts(evs []Event) string {
	var b strings.Builder
	for _, ev := range evs {
		b.WriteString(ev.Text)
	}
	return b.String()
}
