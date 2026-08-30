package anthropic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestStreamContract(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "test-key" ||
			r.Header.Get("anthropic-version") != apiVersion {
			t.Errorf("request %s headers=%v", r.URL.Path, r.Header)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["model"] != "claude-test" || body["system"] != "简洁回答。" || body["stream"] != true {
			t.Errorf("body %#v", body)
		}
		messages, _ := body["messages"].([]any)
		if len(messages) != 1 || messages[0].(map[string]any)["role"] != "user" {
			t.Errorf("messages %#v", messages)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(
			"event: message_start\n" +
				"data: {\"type\":\"message_start\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"usage\":{\"input_tokens\":5,\"output_tokens\":0}}}\n\n" +
				"event: content_block_start\n" +
				"data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n" +
				"event: future_metadata\n" +
				"data: {\"type\":\"future_metadata\",\"value\":1}\n\n" +
				"event: content_block_delta\n" +
				"data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"你\"}}\n\n" +
				"event: content_block_delta\n" +
				"data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"好\"}}\n\n" +
				"event: content_block_stop\n" +
				"data: {\"type\":\"content_block_stop\",\"index\":0}\n\n" +
				"event: message_delta\n" +
				"data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":2}}\n\n" +
				"event: message_stop\n" +
				"data: {\"type\":\"message_stop\"}\n\n",
		))
	}))
	defer srv.Close()
	a, err := New(Config{
		BaseURL: srv.URL + "/v1", APIKey: "test-key", Model: "claude-test",
		MaxTokens: 32, ConnectTimeout: time.Second, FirstTokenTimeout: time.Second,
		TotalTimeout: 2 * time.Second, MaxResponseBytes: 16 << 10,
		AllowLoopbackHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	var text strings.Builder
	result, err := a.Stream(context.Background(), companion.ModelRequest{
		Messages: []companion.Message{
			{Role: companion.RoleSystem, Content: "简洁回答。"},
			{Role: companion.RoleUser, Content: "你好"},
		},
		Stream: true,
	}, func(delta companion.OutputDelta) error {
		text.WriteString(delta.Text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if text.String() != "你好" || result.Finish != companion.FinishStop || result.Usage.TotalTokens != 7 {
		t.Fatalf("text=%q result=%+v", text.String(), result)
	}
}

func TestNonStreamContract(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["stream"] != false || body["model"] != "claude-test" {
			t.Errorf("body %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"type":"message","role":"assistant","content":[{"type":"text","text":"完整回答"}],"stop_reason":"end_turn","usage":{"input_tokens":5,"output_tokens":4}}`))
	}))
	defer srv.Close()
	a, err := New(Config{
		BaseURL: srv.URL + "/v1", APIKey: "test-key", Model: "claude-test",
		MaxTokens: 32, ConnectTimeout: time.Second, FirstTokenTimeout: time.Second,
		TotalTimeout: 2 * time.Second, MaxResponseBytes: 16 << 10,
		AllowLoopbackHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	var text strings.Builder
	result, err := a.Stream(context.Background(), companion.ModelRequest{
		Messages: []companion.Message{{Role: companion.RoleUser, Content: "你好"}},
	}, func(delta companion.OutputDelta) error {
		text.WriteString(delta.Text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if text.String() != "完整回答" || result.Finish != companion.FinishStop || result.Usage.TotalTokens != 9 {
		t.Fatalf("text=%q result=%+v", text.String(), result)
	}
}
