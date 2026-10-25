package openai

import (
	"context"
	"fmt"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOutputBudgetKeepsReviewedPrefixThroughAdapter(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"abcd\"},\"finish_reason\":null}]}\n\n")
		w.(http.Flusher).Flush()
		fmt.Fprint(w, "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"e\"},\"finish_reason\":null}]}\n\n")
		w.(http.Flusher).Flush()
	}))
	defer srv.Close()
	a, err := New(Config{Endpoint: srv.URL + "/v1/chat/completions", BearerToken: "synthetic", Model: "synthetic", AllowLoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	out := companion.StreamAttempt(context.Background(), companion.StreamInput{Provider: a, Request: companion.ModelRequest{Stream: true, Messages: []companion.Message{{Role: companion.RoleUser, Content: "hello"}}}, Budget: companion.TurnBudget{MaxOutputTokens: 1, MaxAttempts: 1, MaxResponseBytes: 1024, TotalTimeout: time.Second, ConnectTimeout: time.Second, FirstTokenTimeout: time.Second}})
	if out.Status != companion.AttemptSucceeded || out.Text != "abcd" || !out.Persistable {
		t.Fatalf("output budget should retain reviewed prefix, got status=%s finish=%s text=%q withdraw=%v error=%v", out.Status, out.Finish, out.Text, out.Withdraw, out.ProviderErr)
	}
}
