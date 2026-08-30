package openai

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestEncodeRequestOmitsCredentialAndSetsStreamOptions(t *testing.T) {
	t.Parallel()
	cfg := Config{Model: "offline-model-sentinel", MaxTokens: 32, Temperature: 0.5}
	body, err := encodeRequest(cfg, companion.ModelRequest{
		Messages: []companion.Message{{Role: companion.RoleUser, Content: "请回复"}},
		Stream:   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), "offline-token") || strings.Contains(string(body), "Bearer") {
		t.Fatalf("credential in body: %s", body)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["model"] != "offline-model-sentinel" {
		t.Fatalf("model %v", payload["model"])
	}
	if payload["stream"] != true {
		t.Fatal("stream")
	}
	opts, _ := payload["stream_options"].(map[string]any)
	if opts["include_usage"] != true {
		t.Fatalf("stream_options %+v", opts)
	}
}

func TestMapFinishReasonAndUsage(t *testing.T) {
	t.Parallel()
	stop := "stop"
	got, err := mapFinishReason(&stop)
	if err != nil || got != companion.FinishStop {
		t.Fatalf("stop %v %v", got, err)
	}
	length := "length"
	got, err = mapFinishReason(&length)
	if err != nil || got != companion.FinishLength {
		t.Fatalf("length %v %v", got, err)
	}
	policy := "content_filter"
	got, err = mapFinishReason(&policy)
	if err != nil || got != companion.FinishPolicy {
		t.Fatalf("policy %v %v", got, err)
	}
	unknown := "tool_calls"
	if _, err := mapFinishReason(&unknown); err == nil {
		t.Fatal("tool_calls must be malformed in Go v1")
	}
	u, err := mapUsage(&usagePayload{
		PromptTokens:     tokenCount{n: 3, set: true},
		CompletionTokens: tokenCount{n: 5, set: true},
		TotalTokens:      tokenCount{n: 8, set: true},
	})
	if err != nil || u.TotalTokens != 8 {
		t.Fatalf("usage %+v %v", u, err)
	}
	if _, err := mapUsage(&usagePayload{
		PromptTokens:     tokenCount{n: 3, set: true},
		CompletionTokens: tokenCount{n: 5, set: true},
		TotalTokens:      tokenCount{n: 9, set: true},
	}); err == nil {
		t.Fatal("inconsistent usage must fail")
	}
}

func TestUTF16JoinSplitEmoji(t *testing.T) {
	t.Parallel()
	high, err := decodeJSONStringUTF16([]byte(`"\uD83D"`))
	if err != nil {
		t.Fatal(err)
	}
	low, err := decodeJSONStringUTF16([]byte(`"\uDE42"`))
	if err != nil {
		t.Fatal(err)
	}
	var j utf16Join
	first, err := j.append(high)
	if err != nil {
		t.Fatal(err)
	}
	if first != "" || !j.pendingIncomplete() {
		t.Fatalf("expected pending high surrogate, got %q", first)
	}
	second, err := j.append(low)
	if err != nil {
		t.Fatal(err)
	}
	if second != "🙂" {
		t.Fatalf("got %q", second)
	}
}
