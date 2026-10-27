package openai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

// New applies withDefaults, so these go through the real construction path:
// an explicit Temperature=0 must survive it and reach the request body.
func TestExplicitTemperatureReachesRequestBody(t *testing.T) {
	cases := []struct {
		name string
		temp float64
		want float64
	}{
		{"explicit zero stays zero", 0, 0},
		{"non-zero preserved", 0.7, 0.7},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			bodyCh := make(chan []byte, 1)
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				bodyCh <- body
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n")
				fmt.Fprint(w, "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n")
				fmt.Fprint(w, "data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"model\":\"synthetic\",\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}\n\n")
				fmt.Fprint(w, "data: [DONE]\n\n")
				w.(http.Flusher).Flush()
			}))
			defer srv.Close()
			a, err := New(Config{
				Endpoint: srv.URL + "/v1/chat/completions", BearerToken: "synthetic", Model: "synthetic",
				Temperature: tc.temp, AllowLoopbackHTTP: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			defer a.Close()
			out := companion.StreamAttempt(context.Background(), companion.StreamInput{
				Provider: a,
				Request:  companion.ModelRequest{Stream: true, Messages: []companion.Message{{Role: companion.RoleUser, Content: "hello"}}},
				Budget:   companion.TurnBudget{MaxOutputTokens: 4, MaxAttempts: 1, MaxResponseBytes: 1024, TotalTimeout: time.Second, ConnectTimeout: time.Second, FirstTokenTimeout: time.Second},
			})
			if out.Status != companion.AttemptSucceeded {
				t.Fatalf("stream failed: %+v", out)
			}
			var payload map[string]any
			if err := json.Unmarshal(<-bodyCh, &payload); err != nil {
				t.Fatal(err)
			}
			if payload["temperature"] != tc.want {
				t.Fatalf("request temperature %v, want %v", payload["temperature"], tc.want)
			}
		})
	}
}
