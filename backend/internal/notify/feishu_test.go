package notify

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFeishuHTTPBusinessRateAndSuccess(t *testing.T) {
	const secret = "demo-secret"
	now := time.Unix(1_599_360_473, 0).UTC()
	cases := []struct {
		name   string
		status int
		body   string
		kind   string
		code   string
	}{
		{name: "http", status: http.StatusBadGateway, body: `{"code":0}`, kind: KindFailed, code: CodeHTTPError},
		{name: "business", status: http.StatusOK, body: `{"code":19021,"msg":"sign match fail"}`, kind: KindFailed, code: CodeFeishuRejected},
		{name: "missing", status: http.StatusOK, body: `{"StatusCode":0,"StatusMessage":"success"}`, kind: KindFailed, code: CodeFeishuRejected},
		{name: "rate-http", status: http.StatusTooManyRequests, body: `{"code":0}`, kind: KindRetry, code: CodeRateLimited},
		{name: "rate-code", status: http.StatusOK, body: `{"code":9499}`, kind: KindRetry, code: CodeRateLimited},
		{name: "rate-other", status: http.StatusOK, body: `{"code":11232}`, kind: KindRetry, code: CodeRateLimited},
		{name: "ok", status: http.StatusOK, body: `{"code":0,"msg":"success"}`, kind: KindAccepted},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var seen map[string]any
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, _ := io.ReadAll(io.LimitReader(r.Body, 1<<16))
				_ = json.Unmarshal(raw, &seen)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			t.Cleanup(srv.Close)
			sender := NewFeishu(FeishuConfig{WebhookURL: "http://127.0.0.1:1/unused", SignSecret: "process-secret"})
			result, err := sender.Send(context.Background(), Request{
				Channel:    "FEISHU",
				Target:     "group-w10",
				Text:       Title + "\n" + LoginHint + "\n" + GroupVisible,
				DeliveryID: 9,
				Now:        now,
				WebhookURL: srv.URL,
				SignSecret: secret,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != tc.kind || result.FailureCode != tc.code {
				t.Fatalf("result = %+v", result)
			}
			if seen["msg_type"] != "text" {
				t.Fatalf("payload = %#v", seen)
			}
			content, _ := seen["content"].(map[string]any)
			if content["text"] == "" || strings.Contains(result.FailureCode, secret) {
				t.Fatalf("payload or result leaked the send: %#v %+v", seen, result)
			}
			if seen["timestamp"] != "1599360473" || seen["sign"] != FeishuSign("1599360473", secret) {
				t.Fatalf("signature payload = %#v", seen)
			}
			if tc.kind == KindAccepted && !strings.HasPrefix(result.Correlation, "feishu-9-") {
				t.Fatalf("correlation = %s", result.Correlation)
			}
		})
	}
}

func TestFeishuDoesNotFollowRedirect(t *testing.T) {
	var followed bool
	mux := http.NewServeMux()
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	mux.HandleFunc("/hook", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, srv.URL+"/landed", http.StatusFound)
	})
	mux.HandleFunc("/landed", func(w http.ResponseWriter, r *http.Request) {
		followed = true
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0}`))
	})
	sender := NewFeishu(FeishuConfig{WebhookURL: "http://127.0.0.1:1/unused", SignSecret: "process-secret"})
	result, err := sender.Send(context.Background(), Request{Text: Title, Now: time.Unix(10, 0), WebhookURL: srv.URL + "/hook", SignSecret: "demo-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if followed || result.Kind == KindAccepted {
		t.Fatalf("redirect followed, result = %+v", result)
	}
	if result.Kind != KindFailed || result.FailureCode != CodeHTTPError {
		t.Fatalf("result = %+v", result)
	}
}

func TestFeishuExternalHTTPIsNotDialed(t *testing.T) {
	sender := NewFeishu(FeishuConfig{})
	result, err := sender.Send(context.Background(), Request{Text: Title, WebhookURL: "http://hooks.example.test/secret-path", SignSecret: "demo-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindFailed || result.FailureCode != CodeNotConfigured {
		t.Fatalf("result = %+v", result)
	}
	if strings.Contains(result.FailureCode, "hooks.example.test") || strings.Contains(result.FailureCode, "secret-path") {
		t.Fatalf("result echoed the webhook: %+v", result)
	}
}

func TestFeishuIgnoresProcessWebhook(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0}`))
	}))
	t.Cleanup(srv.Close)
	sender := NewFeishu(FeishuConfig{WebhookURL: srv.URL, SignSecret: "process-secret"})
	result, err := sender.Send(context.Background(), Request{Text: Title})
	if err != nil {
		t.Fatal(err)
	}
	if hits != 0 || result.Kind != KindFailed || result.FailureCode != CodeNotConfigured {
		t.Fatalf("hits=%d result=%+v", hits, result)
	}
}
