package contracttest

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

func TestHTTP429And5xxClassification(t *testing.T) {
	t.Parallel()
	cases := []struct {
		status int
		code   companion.Code
	}{
		{429, companion.CodeRateLimited},
		{500, companion.CodeUpstreamUnavailable},
		{502, companion.CodeUpstreamUnavailable},
		{503, companion.CodeUpstreamUnavailable},
		{599, companion.CodeUpstreamUnavailable},
		{400, companion.CodeMalformed},
		{401, companion.CodeMalformed},
		{404, companion.CodeMalformed},
	}
	for _, tc := range cases {
		t.Run(http.StatusText(tc.status), func(t *testing.T) {
			t.Parallel()
			body := "sensitive-provider-body"
			m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, body)
			})
			_, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "status"))
			if result != (companion.AttemptResult{}) {
				t.Fatalf("result must be zero: %+v", result)
			}
			pe := requireCode(t, err, tc.code)
			if pe.Delivery != companion.DeliveryReceived {
				t.Fatalf("delivery %s", pe.Delivery)
			}
			mustNoSecret(t, err.Error())
			if strings.Contains(err.Error(), body) {
				t.Fatalf("body leaked: %v", err)
			}
			if m.calls.Load() != 1 {
				t.Fatalf("calls %d", m.calls.Load())
			}
		})
	}
}

func TestMalformedStreamEvents(t *testing.T) {
	t.Parallel()
	valid := choiceChunk(ptr("prefix"), nil)
	finish := choiceChunk(nil, ptr("stop"))
	usage := usageChunk(2, 1)
	multiple := `{"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null},{"index":1,"delta":{"content":"b"},"finish_reason":null}]}`
	wrongIndex := strings.Replace(valid, `"index":0`, `"index":1`, 1)
	unknownFinish := choiceChunk(nil, ptr("provider_new_reason"))
	badUsage := `{"object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":99}}`
	streams := []string{
		"event: message\n" + sse(valid) + sse(finish) + sse(usage) + done(),
		sse("{not-json") + done(),
		sse(multiple) + done(),
		sse(wrongIndex) + done(),
		sse(valid) + sse(unknownFinish) + sse(usage) + done(),
		sse(valid) + sse(finish) + sse(finish) + sse(usage) + done(),
		sse(valid) + sse(finish) + sse(badUsage) + done(),
		sse(valid) + sse(finish) + sse(usage),
		sse(valid) + sse(finish) + done(),
	}
	for i, stream := range streams {
		t.Run(it(i), func(t *testing.T) {
			t.Parallel()
			m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
				writeSSE(w, stream)
			})
			deltas, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(true, "malformed"))
			if result != (companion.AttemptResult{}) {
				t.Fatalf("result %+v", result)
			}
			requireCode(t, err, companion.CodeMalformed)
			mustNoSecret(t, err.Error())
			for _, d := range deltas {
				mustNoSecret(t, d)
			}
			if m.calls.Load() != 1 {
				t.Fatalf("calls %d", m.calls.Load())
			}
		})
	}
}

func TestMalformedJSONAndContentType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		ctype string
		body  string
	}{
		{"text/plain", completionJSON("content", "stop", 1, 1)},
		{"application/json", "{not-json"},
		{"application/json", `{"object":"chat.completion","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`},
		{"application/json", completionJSON("content", "not-legal", 1, 1)},
		{"application/json", strings.Replace(completionJSON("content", "stop", 1, 1), `"total_tokens":2`, `"total_tokens":3`, 1)},
		{"application/json", completionJSON("content", "stop", 1, 1) + `{"extra":true}`},
	}
	for i, tc := range cases {
		t.Run(it(i), func(t *testing.T) {
			t.Parallel()
			m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.ctype)
				w.WriteHeader(http.StatusOK)
				_, _ = io.WriteString(w, tc.body)
			})
			_, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(false, "invalid"))
			if result != (companion.AttemptResult{}) {
				t.Fatalf("result %+v", result)
			}
			requireCode(t, err, companion.CodeMalformed)
			mustNoSecret(t, err.Error())
		})
	}
}

func TestEarlyEOFWithoutDoneIsMalformed(t *testing.T) {
	t.Parallel()
	m := startMock(t, func(w http.ResponseWriter, r *http.Request) {
		writeSSE(w, sse(choiceChunk(ptr("partial"), nil)))
	})
	_, result, err := collect(t, testAdapter(t, m.endpoint(), nil), textReq(true, "eof"))
	if result != (companion.AttemptResult{}) {
		t.Fatalf("result %+v", result)
	}
	requireCode(t, err, companion.CodeMalformed)
}

func it(i int) string {
	return strings.Repeat("x", 0) + string(rune('a'+i))
}
