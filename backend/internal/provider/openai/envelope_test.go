package openai

import (
	"context"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"strings"
	"testing"
)

func TestOwnerCompletionEnvelope(t *testing.T) {
	completion := `{"object":"chat.completion","choices":[{"index":0,"message":{"content":"合成记忆"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`
	for _, tc := range []struct {
		name, body string
		ok         bool
	}{
		{"native", completion, true},
		{"success", `{"data":` + completion + `,"success":true}`, true},
		{"failure", `{"data":` + completion + `,"success":false}`, false},
		{"missing_success", `{"data":` + completion + `}`, false},
		{"null", `{"data":null,"success":true}`, false},
		{"nested", `{"data":{"data":` + completion + `,"success":true},"success":true}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			text, usage, finish, err := decodeCompletion(strings.NewReader(tc.body), 8192)
			if (err == nil) != tc.ok {
				t.Fatalf("ok=%v err=%v", tc.ok, err)
			}
			if tc.ok && (text != "合成记忆" || usage.TotalTokens != 7 || finish != companion.FinishStop) {
				t.Fatal("invalid completion")
			}
		})
	}
}

func TestOwnerStreamRemainsNativeSSE(t *testing.T) {
	input := "data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"合成记忆\"},\"finish_reason\":null}]}\n\n" +
		"data: {\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n" +
		"data: {\"object\":\"chat.completion.chunk\",\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":4,\"total_tokens\":7}}\n\n" +
		"data: [DONE]\n\n"
	a := &Adapter{cfg: Config{MaxResponseBytes: 8192}}
	var text string
	got, err := a.consumeStream(context.Background(), strings.NewReader(input), func(d companion.OutputDelta) error { text += d.Text; return nil }, func() {})
	if err != nil || text != "合成记忆" || got.Usage.TotalTokens != 7 {
		t.Fatalf("native SSE failed: %v", err)
	}
	if _, err = a.consumeStream(context.Background(), strings.NewReader(strings.Replace(input, "data: [DONE]\n\n", "", 1)), func(companion.OutputDelta) error { return nil }, func() {}); err == nil {
		t.Fatal("missing DONE accepted")
	}
}
