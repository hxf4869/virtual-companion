package responses

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
		if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer test-key" {
			t.Errorf("request %s auth=%q", r.URL.Path, r.Header.Get("Authorization"))
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body["model"] != "gpt-test" || body["store"] != false || body["stream"] != true {
			t.Errorf("body %#v", body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte(
			"event: response.output_text.delta\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"你\"}\n\n" +
				"event: response.output_text.delta\n" +
				"data: {\"type\":\"response.output_text.delta\",\"delta\":\"好\"}\n\n" +
				"event: response.completed\n" +
				"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"你好\"}]}],\"usage\":{\"input_tokens\":5,\"output_tokens\":2,\"total_tokens\":7}}}\n\n",
		))
	}))
	defer srv.Close()
	a, err := New(Config{
		BaseURL: srv.URL + "/v1", BearerToken: "test-key", Model: "gpt-test",
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
		if body["stream"] != false || body["store"] != false {
			t.Errorf("body %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"完整回答"}]}],"usage":{"input_tokens":5,"output_tokens":4,"total_tokens":9}}`))
	}))
	defer srv.Close()
	a, err := New(Config{
		BaseURL: srv.URL + "/v1", BearerToken: "test-key", Model: "gpt-test",
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
