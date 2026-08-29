package observability

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
)

func TestLoggerJSONAndRedaction(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	log := NewLogger("info", &buf)
	log.Info("http",
		slog.String("request_id", "abc"),
		slog.String("operation", "health"),
		slog.String("outcome", "ok"),
		slog.String("password", "should-not-appear"),
		slog.String("token", "should-not-appear"),
		slog.String("authorization", "Bearer secret"),
		slog.String("message", "conversation-body"),
	)
	line := buf.String()
	if !strings.Contains(line, `"msg":"http"`) {
		t.Fatalf("expected json log, got %s", line)
	}
	if !strings.Contains(line, `"request_id":"abc"`) {
		t.Fatalf("missing request_id: %s", line)
	}
	if strings.Contains(line, "should-not-appear") || strings.Contains(line, "Bearer secret") || strings.Contains(line, "conversation-body") {
		t.Fatalf("sensitive value leaked: %s", line)
	}
	var payload map[string]any
	if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["password"] != "[redacted]" || payload["token"] != "[redacted]" {
		t.Fatalf("redaction %+v", payload)
	}
}
