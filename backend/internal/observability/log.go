package observability

import (
	"context"
	"io"
	"log/slog"
	"strings"
)

func NewLogger(level string, w io.Writer) *slog.Logger {
	if w == nil {
		w = io.Discard
	}
	var lvl slog.Level
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	h := slog.NewJSONHandler(w, &slog.HandlerOptions{Level: lvl})
	return slog.New(redactHandler{Handler: h})
}

type redactHandler struct {
	slog.Handler
}

func (h redactHandler) Handle(ctx context.Context, r slog.Record) error {
	nr := slog.NewRecord(r.Time, r.Level, r.Message, r.PC)
	r.Attrs(func(a slog.Attr) bool {
		nr.AddAttrs(redactAttr(a))
		return true
	})
	return h.Handler.Handle(ctx, nr)
}

func (h redactHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	out := make([]slog.Attr, 0, len(attrs))
	for _, a := range attrs {
		out = append(out, redactAttr(a))
	}
	return redactHandler{Handler: h.Handler.WithAttrs(out)}
}

func (h redactHandler) WithGroup(name string) slog.Handler {
	return redactHandler{Handler: h.Handler.WithGroup(name)}
}

func redactAttr(a slog.Attr) slog.Attr {
	if a.Value.Kind() == slog.KindGroup {
		g := a.Value.Group()
		out := make([]slog.Attr, 0, len(g))
		for _, child := range g {
			out = append(out, redactAttr(child))
		}
		return slog.Attr{Key: a.Key, Value: slog.GroupValue(out...)}
	}
	if sensitiveKey(a.Key) {
		return slog.String(a.Key, "[redacted]")
	}
	return a
}

func sensitiveKey(key string) bool {
	k := strings.ToLower(strings.TrimSpace(key))
	k = strings.ReplaceAll(k, "-", "")
	k = strings.ReplaceAll(k, "_", "")
	switch k {
	case "password", "token", "secret", "authorization", "cookie", "setcookie",
		"apikey", "jwt", "session", "prompt", "response", "message", "memory",
		"summary", "content", "credential", "webhook", "dsn", "proof", "nonce",
		"binding":
		return true
	default:
		return false
	}
}
