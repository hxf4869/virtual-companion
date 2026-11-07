package stsource

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const cutoverTestRun = "00000000-0000-4000-8000-000000000001"
const cutoverTestEpoch = "90071992547409930001"

type cutoverCall func(context.Context, int64, string, string) (ChatCutoverStatus, error)

func cutoverResponse() map[string]any {
	return map[string]any{"ownerAccountId": "101", "runId": cutoverTestRun, "authorityEpoch": cutoverTestEpoch, "state": "DRAINED", "closed": true, "durable": true, "activeHandlers": 0}
}

func TestChatCutoverPrivateRoutesAuthenticationAndSeparateBudget(t *testing.T) {
	for _, op := range []string{"freeze", "drain", "status"} {
		t.Run(op, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.Path != "/internal/v1/st/chat-cutover/"+op || r.Header.Get("Authorization") != "Bearer "+strings.Repeat("s", 32) || r.Header.Get("Content-Type") != "application/json" {
					t.Error("invalid private request method, route or authentication headers")
				}
				if _, ok := r.Header["Origin"]; ok {
					t.Error("private request contains Origin")
				}
				var body map[string]string
				if json.NewDecoder(r.Body).Decode(&body) != nil || !reflect.DeepEqual(body, map[string]string{"ownerAccountId": "101", "runId": cutoverTestRun, "authorityEpoch": cutoverTestEpoch}) {
					t.Error("request does not contain the exact owner/run/epoch strings")
				}
				time.Sleep(20 * time.Millisecond)
				_ = json.NewEncoder(w).Encode(cutoverResponse())
			}))
			defer server.Close()
			client, _ := NewClient(server.URL, strings.Repeat("s", 32))
			if client.http.Timeout != 10*time.Second {
				t.Fatal("ordinary source/inbox budget changed")
			}
			// A deliberately tiny ordinary budget must not leak into control operations.
			client.http.Timeout = time.Millisecond
			transport := &cutoverBudgetTransport{t: t, next: http.DefaultTransport}
			client.http.Transport = transport
			calls := map[string]cutoverCall{"freeze": client.FreezeChatAdmission, "drain": client.DrainChatHandlers, "status": client.ChatDrainStatus}
			out, err := calls[op](context.Background(), 101, cutoverTestRun, cutoverTestEpoch)
			if err != nil || out.State != "DRAINED" || !out.Durable || !out.Closed || out.ActiveHandlers != 0 || out.AuthorityEpoch != cutoverTestEpoch {
				t.Fatalf("control result = %+v, %v", out, err)
			}
			if client.http.Timeout != time.Millisecond {
				t.Fatal("control mutated the ordinary client budget")
			}
		})
	}
}

type cutoverBudgetTransport struct {
	t    *testing.T
	next http.RoundTripper
}

func (tr *cutoverBudgetTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	deadline, ok := r.Context().Deadline()
	if !ok || time.Until(deadline) < 149*time.Second || time.Until(deadline) > 150*time.Second {
		tr.t.Error("control request lacks independent 150 second budget")
	}
	return tr.next.RoundTrip(r)
}

func TestChatCutoverFixedErrorMapping(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
		want   error
	}{
		{400, "INVALID_REQUEST", ErrChatCutoverInvalidRequest},
		{401, "AUTHENTICATION_REQUIRED", ErrChatCutoverAuthenticationRequired},
		{403, "ACCESS_DENIED", ErrChatCutoverAccessDenied},
		{409, "REVISION_CONFLICT", ErrChatCutoverConflict},
		{503, "CHAT_TRANSFER_TIMEOUT", ErrChatTransferTimeout},
		{503, "SCHEMA_UNAVAILABLE", ErrChatCutoverSchemaUnavailable},
		{500, "CHAT_TRANSFER_TIMEOUT", ErrUnavailable},
		{503, "arbitrary upstream diagnostic", ErrUnavailable},
	} {
		t.Run(tc.code+http.StatusText(tc.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_ = json.NewEncoder(w).Encode(map[string]string{"code": tc.code})
			}))
			defer server.Close()
			client, _ := NewClient(server.URL, strings.Repeat("s", 32))
			if out, err := client.DrainChatHandlers(context.Background(), 101, cutoverTestRun, cutoverTestEpoch); !errors.Is(err, tc.want) || out.State != "" {
				t.Fatalf("result = %+v, %v; want %v and no status", out, err, tc.want)
			}
		})
	}
}

func TestChatCutoverRejectsUnprovenDrainAndWrongIdentity(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"wrong owner", func(b map[string]any) { b["ownerAccountId"] = "102" }},
		{"wrong run", func(b map[string]any) { b["runId"] = "00000000-0000-4000-8000-000000000002" }},
		{"wrong epoch", func(b map[string]any) { b["authorityEpoch"] = "2" }},
		{"missing count", func(b map[string]any) { delete(b, "activeHandlers") }},
		{"negative count", func(b map[string]any) { b["activeHandlers"] = -1 }},
		{"open gate", func(b map[string]any) { b["closed"] = false }},
		{"not durable", func(b map[string]any) { b["durable"] = false }},
		{"active drained", func(b map[string]any) { b["activeHandlers"] = 1 }},
		{"closed zero", func(b map[string]any) { b["state"] = "CLOSED" }},
		{"not yet drained", func(b map[string]any) { b["state"] = "CLOSED"; b["activeHandlers"] = 1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body := cutoverResponse()
				tc.mutate(body)
				_ = json.NewEncoder(w).Encode(body)
			}))
			defer server.Close()
			client, _ := NewClient(server.URL, strings.Repeat("s", 32))
			if _, err := client.DrainChatHandlers(context.Background(), 101, cutoverTestRun, cutoverTestEpoch); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("accepted unproven drain: %v", err)
			}
		})
	}
}

func TestChatCutoverClosedIsValidForFreezeAndStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := cutoverResponse()
		body["state"], body["activeHandlers"] = "CLOSED", 1
		_ = json.NewEncoder(w).Encode(body)
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, strings.Repeat("s", 32))
	for _, call := range []cutoverCall{client.FreezeChatAdmission, client.ChatDrainStatus} {
		if out, err := call(context.Background(), 101, cutoverTestRun, cutoverTestEpoch); err != nil || out.ActiveHandlers != 1 || out.State != "CLOSED" {
			t.Fatalf("closed state = %+v, %v", out, err)
		}
	}
}

func TestChatCutoverCancellationAndDeadlineAreNotSuccessfulDrain(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		t.Run(map[bool]string{false: "cancel", true: "deadline"}[deadline], func(t *testing.T) {
			entered := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				close(entered)
				<-r.Context().Done()
			}))
			defer server.Close()
			client, _ := NewClient(server.URL, strings.Repeat("s", 32))
			ctx, cancel := context.WithCancel(context.Background())
			if deadline {
				ctx, cancel = context.WithTimeout(context.Background(), 20*time.Millisecond)
			}
			defer cancel()
			result := make(chan error, 1)
			go func() {
				out, err := client.DrainChatHandlers(ctx, 101, cutoverTestRun, cutoverTestEpoch)
				if out.State != "" {
					t.Error("cancellation returned status")
				}
				result <- err
			}()
			<-entered
			if !deadline {
				cancel()
			}
			err := <-result
			if deadline {
				if !errors.Is(err, ErrChatTransferTimeout) || !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("deadline error = %v", err)
				}
			} else if !errors.Is(err, context.Canceled) {
				t.Fatalf("cancel error = %v", err)
			}
		})
	}
}

func TestChatCutoverRejectsInvalidInputAndRedirect(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Redirect(w, r, "/unexpected", http.StatusFound)
	}))
	defer server.Close()
	client, _ := NewClient(server.URL, strings.Repeat("s", 32))
	for _, call := range []cutoverCall{client.FreezeChatAdmission, client.DrainChatHandlers, client.ChatDrainStatus} {
		for _, input := range []struct {
			owner      int64
			run, epoch string
		}{{0, cutoverTestRun, cutoverTestEpoch}, {101, "bad", cutoverTestEpoch}, {101, cutoverTestRun, "0"}} {
			if _, err := call(context.Background(), input.owner, input.run, input.epoch); !errors.Is(err, ErrChatCutoverInvalidRequest) {
				t.Fatalf("invalid input accepted: %v", err)
			}
		}
	}
	if hits.Load() != 0 {
		t.Fatal("invalid input reached ST")
	}
	if _, err := client.DrainChatHandlers(context.Background(), 101, cutoverTestRun, cutoverTestEpoch); !errors.Is(err, ErrUnavailable) || hits.Load() != 1 {
		t.Fatalf("redirect followed or accepted: %v, hits %d", err, hits.Load())
	}
}
