package contracttest

import (
	"context"
	"io"
	"net"
	"net/http"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/provider/openai"
)

func TestConnectPhaseTimeoutAfterTCPConnectIsOutcomeUnknown(t *testing.T) {
	t.Parallel()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	endpoint := "http://" + ln.Addr().String() + "/v1/chat/completions"
	a := testAdapter(t, endpoint, func(cfg *openai.Config) {
		cfg.ConnectTimeout = 150 * time.Millisecond
		cfg.FirstTokenTimeout = time.Second
		cfg.TotalTimeout = 2 * time.Second
	})
	req := textReq(true, "connect timeout")
	req.Timeouts = companion.TimeoutBudget{
		Connect:    150 * time.Millisecond,
		FirstToken: time.Second,
		Total:      2 * time.Second,
	}
	start := time.Now()
	_, result, err := collect(t, a, req)
	if time.Since(start) > 3*time.Second {
		t.Fatal("connect timeout took too long")
	}
	if result != (companion.AttemptResult{}) {
		t.Fatalf("result %+v", result)
	}
	pe := requireCode(t, err, companion.CodeTimeout)
	if pe.Phase != companion.TimeoutConnect {
		t.Fatalf("phase %s", pe.Phase)
	}
	// net.Listen leaves the TCP accept queue open, so the client can connect
	// and write the request before timing out on response headers. That is not
	// safe to replay even though the server handler never accepted the socket.
	if pe.Delivery != companion.DeliveryUnknown {
		t.Fatalf("delivery %s", pe.Delivery)
	}
}

func TestFirstTokenTimeout(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, ": keepalive\n\n")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
	})
	a := testAdapter(t, m.endpoint(), func(cfg *openai.Config) {
		cfg.ConnectTimeout = time.Second
		cfg.FirstTokenTimeout = 150 * time.Millisecond
		cfg.TotalTimeout = 2 * time.Second
	})
	req := textReq(true, "first token")
	req.Timeouts = companion.TimeoutBudget{
		Connect:    time.Second,
		FirstToken: 150 * time.Millisecond,
		Total:      2 * time.Second,
	}
	_, result, err := collect(t, a, req)
	if result != (companion.AttemptResult{}) {
		t.Fatalf("result %+v", result)
	}
	pe := requireCode(t, err, companion.CodeTimeout)
	if pe.Phase != companion.TimeoutFirstToken {
		t.Fatalf("phase %s", pe.Phase)
	}
}

func TestTotalTimeoutAfterPartialDelta(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, sse(choiceChunk(ptr("partial-before-total-timeout"), nil)))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
	})
	a := testAdapter(t, m.endpoint(), func(cfg *openai.Config) {
		cfg.ConnectTimeout = time.Second
		cfg.FirstTokenTimeout = time.Second
		cfg.TotalTimeout = 300 * time.Millisecond
	})
	req := textReq(true, "total")
	req.Timeouts = companion.TimeoutBudget{
		Connect:    time.Second,
		FirstToken: time.Second,
		Total:      300 * time.Millisecond,
	}
	deltas, result, err := collect(t, a, req)
	if result != (companion.AttemptResult{}) {
		t.Fatalf("result %+v", result)
	}
	if len(deltas) == 0 || deltas[0] != "partial-before-total-timeout" {
		t.Fatalf("deltas %v", deltas)
	}
	pe := requireCode(t, err, companion.CodeTimeout)
	if pe.Phase != companion.TimeoutTotal {
		t.Fatalf("phase %s", pe.Phase)
	}
}

func TestContextCancelStopsStream(t *testing.T) {
	t.Parallel()
	first := make(chan struct{})
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, sse(choiceChunk(ptr("before-cancel"), nil)))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done()
	})
	a := testAdapter(t, m.endpoint(), nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var deltas []string
	done := make(chan error, 1)
	go func() {
		_, err := a.Stream(ctx, textReq(true, "cancel"), func(d companion.OutputDelta) error {
			deltas = append(deltas, d.Text)
			select {
			case <-first:
			default:
				close(first)
			}
			return nil
		})
		done <- err
	}()
	select {
	case <-first:
	case <-time.After(3 * time.Second):
		t.Fatal("first delta not received")
	}
	cancel()
	select {
	case err := <-done:
		requireCode(t, err, companion.CodeCanceled)
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not complete")
	}
}

func TestLateEventAfterDoneIsDiscarded(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w, sse(choiceChunk(ptr("on-time"), nil))+
			sse(choiceChunk(nil, ptr("stop")))+
			sse(usageChunk(1, 1))+
			done()+
			sse(choiceChunk(ptr("late-must-be-discarded"), nil)))
	})
	deltas, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(true, "late"))
	if err != nil {
		t.Fatal(err)
	}
	if stringsJoin(deltas) != "on-time" {
		t.Fatalf("deltas %v", deltas)
	}
	if result.Finish != companion.FinishStop {
		t.Fatalf("result %+v", result)
	}
}
