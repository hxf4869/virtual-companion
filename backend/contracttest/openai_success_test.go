package contracttest

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestNonStreamSuccess(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, completionJSON("你好，今晚辛苦了🙂", "stop", 12, 7))
	})
	a := testAdapter(t, m.endpoint(), nil)
	deltas, result, err := collect(t, a, textReq(false, "请回复"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(deltas, "") != "你好，今晚辛苦了🙂" {
		t.Fatalf("deltas %v", deltas)
	}
	if result.Finish != companion.FinishStop || result.Usage != (companion.Usage{InputTokens: 12, OutputTokens: 7, TotalTokens: 19}) {
		t.Fatalf("result %+v", result)
	}
	cap := m.captured()
	if cap.method != http.MethodPost || cap.path != "/v1/chat/completions" {
		t.Fatalf("request %s %s", cap.method, cap.path)
	}
	if cap.auth != "Bearer "+offlineToken {
		t.Fatal("credential not applied to approved endpoint")
	}
	if cap.accept != "application/json" || cap.ctype != "application/json" {
		t.Fatalf("headers accept=%s type=%s", cap.accept, cap.ctype)
	}
	if strings.Contains(cap.body, offlineToken) {
		t.Fatal("credential in request body")
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cap.body), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["stream"] != false {
		t.Fatalf("stream %v", payload["stream"])
	}
	if payload["stream_options"] != nil {
		t.Fatal("non-stream must omit stream_options")
	}
	if m.calls.Load() != 1 {
		t.Fatalf("calls %d", m.calls.Load())
	}
}

func TestSSEStreamSuccess(t *testing.T) {
	t.Parallel()
	stream := ": synthetic-comment\r\n\r\n" +
		sseCrLf(choiceChunk(nil, nil)) +
		sse(choiceChunk(ptr("第一段"), nil)) +
		sseCrLf(choiceChunk(ptr(" / 第二段🙂"), nil)) +
		sse(choiceChunk(nil, ptr("stop"))) +
		sseCrLf(usageChunk(9, 5)) +
		done()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w, stream)
	})
	a := testAdapter(t, m.endpoint(), nil)
	deltas, result, err := collect(t, a, textReq(true, "流式回复"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(deltas, "") != "第一段 / 第二段🙂" {
		t.Fatalf("deltas %v", deltas)
	}
	if result.Finish != companion.FinishStop || result.Usage.TotalTokens != 14 {
		t.Fatalf("result %+v", result)
	}
	cap := m.captured()
	if cap.accept != "text/event-stream" {
		t.Fatalf("accept %s", cap.accept)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(cap.body), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["stream"] != true {
		t.Fatal("stream flag")
	}
	opts, _ := payload["stream_options"].(map[string]any)
	if opts["include_usage"] != true {
		t.Fatalf("stream_options %+v", opts)
	}
	if m.calls.Load() != 1 {
		t.Fatalf("calls %d", m.calls.Load())
	}
}

func TestUnicodeAndLongText(t *testing.T) {
	t.Parallel()
	unit := "陪伴🙂e\u0301汉字/晚安"
	longText := strings.Repeat(unit, 256)
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, completionJSON(longText, "stop", 1, 2))
	})
	s := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		half := len(longText) / 2
		writeSSE(w, sse(choiceChunk(ptr(longText[:half]), nil))+
			sse(choiceChunk(ptr(longText[half:]), nil))+
			sse(choiceChunk(nil, ptr("stop")))+
			sse(usageChunk(1, 2))+
			done())
	})
	non, _, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "长文本"))
	if err != nil {
		t.Fatal(err)
	}
	stream, _, err := collect(t, testAdapter(t, s.endpoint(), nil), textReq(true, "长文本"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(non, "") != longText || strings.Join(stream, "") != longText {
		t.Fatal("unicode/long text mismatch")
	}
}

func TestFinishReasonLengthAndPolicy(t *testing.T) {
	t.Parallel()
	cases := []struct {
		raw  string
		want companion.FinishReason
	}{
		{"length", companion.FinishLength},
		{"content_filter", companion.FinishPolicy},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			t.Parallel()
			m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
				writeJSON(w, completionJSON("x", tc.raw, 1, 1))
			})
			_, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "hi"))
			if err != nil {
				t.Fatal(err)
			}
			if result.Finish != tc.want {
				t.Fatalf("got %s", result.Finish)
			}
		})
	}
}

func TestSplitSurrogatePairAcrossChunks(t *testing.T) {
	t.Parallel()
	high := `{"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"\uD83D"},"finish_reason":null}]}`
	low := `{"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"\uDE42"},"finish_reason":null}]}`
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w, sse(high)+sse(low)+sse(choiceChunk(nil, ptr("stop")))+sse(usageChunk(1, 1))+done())
	})
	deltas, _, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(true, "emoji"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(deltas, "") != "🙂" {
		t.Fatalf("deltas %q", deltas)
	}
}
