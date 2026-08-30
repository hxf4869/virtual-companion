package openai

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestResponseHeaderTimeoutAfterWriteIsNotReplayable(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(120 * time.Millisecond)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer srv.Close()

	a, err := New(Config{
		Endpoint:    strings.TrimSuffix(srv.URL, "/") + "/v1/chat/completions",
		BearerToken: "offline-token-sentinel", Model: "offline-model-sentinel",
		ConnectTimeout: 40 * time.Millisecond, FirstTokenTimeout: time.Second,
		TotalTimeout: time.Second, MaxResponseBytes: 1024,
		AllowLoopbackHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	_, err = a.Stream(context.Background(), companion.ModelRequest{
		Messages: []companion.Message{{Role: companion.RoleUser, Content: "hi"}},
		Stream:   true,
	}, nil)
	pe := companion.AsError(err)
	if pe == nil || pe.Code != companion.CodeTimeout || pe.Phase != companion.TimeoutConnect ||
		pe.Delivery != companion.DeliveryUnknown {
		t.Fatalf("timeout classification: %+v err=%v", pe, err)
	}
}

func TestStreamFailsClosedOnBlockedDNS(t *testing.T) {
	t.Parallel()
	a, err := newAdapter(Config{
		Endpoint:          "https://models.example/v1/chat/completions",
		BearerToken:       "offline-token-sentinel",
		Model:             "offline-model-sentinel",
		ConnectTimeout:    time.Second,
		FirstTokenTimeout: time.Second,
		TotalTimeout:      2 * time.Second,
		MaxResponseBytes:  1024,
	}, func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("169.254.169.254")}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Close)
	_, err = a.Stream(context.Background(), companion.ModelRequest{
		Messages: []companion.Message{{Role: companion.RoleUser, Content: "hi"}},
		Stream:   true,
		Timeouts: companion.TimeoutBudget{Connect: 200 * time.Millisecond, FirstToken: time.Second, Total: time.Second},
	}, nil)
	pe := companion.AsError(err)
	if pe == nil || pe.Code != companion.CodeMalformed || pe.Delivery != companion.DeliveryNotSent {
		t.Fatalf("blocked DNS: %+v err=%v", pe, err)
	}
	if err.Error() != "provider: MALFORMED" {
		t.Fatalf("error leaked details: %q", err)
	}
}

func TestBlockedIPCategories(t *testing.T) {
	t.Parallel()
	cases := map[string]string{
		"10.0.0.1":        "private",
		"192.168.1.1":     "private",
		"127.0.0.1":       "loopback",
		"169.254.169.254": "link-local",
		"100.64.1.1":      "cgnat",
		"8.8.8.8":         "",
	}
	for ip, want := range cases {
		got := blockedIP(net.ParseIP(ip))
		if got != want {
			t.Fatalf("%s: got %q want %q", ip, got, want)
		}
	}
}
