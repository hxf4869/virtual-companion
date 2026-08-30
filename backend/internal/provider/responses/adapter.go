package responses

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/provider/modelhttp"
)

var _ companion.Provider = (*Adapter)(nil)

type Config struct {
	BaseURL           string
	BearerToken       string
	Model             string
	MaxTokens         int
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxResponseBytes  int64
	AllowLoopbackHTTP bool
}

type Adapter struct {
	cfg    Config
	client *modelhttp.Client
}

func New(cfg Config) (*Adapter, error) {
	if strings.TrimSpace(cfg.Model) == "" || !modelhttp.CredentialValid(cfg.BearerToken) {
		return nil, errors.New("provider model and credential are required")
	}
	if cfg.MaxTokens == 0 {
		cfg.MaxTokens = 8192
	}
	if cfg.MaxTokens < 1 || cfg.MaxTokens > 262144 {
		return nil, errors.New("provider max tokens is invalid")
	}
	endpoint, err := modelhttp.ResolveEndpoint(cfg.BaseURL, "OPENAI_RESPONSES", cfg.AllowLoopbackHTTP)
	if err != nil {
		return nil, err
	}
	client, err := modelhttp.New(modelhttp.Config{
		Endpoint: endpoint, ConnectTimeout: cfg.ConnectTimeout,
		FirstTokenTimeout: cfg.FirstTokenTimeout, TotalTimeout: cfg.TotalTimeout,
		MaxResponseBytes: cfg.MaxResponseBytes,
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{cfg: cfg, client: client}, nil
}

func (a *Adapter) Close() {
	if a != nil && a.client != nil {
		a.client.Close()
	}
}

func (a *Adapter) Stream(ctx context.Context, req companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if a == nil || a.client == nil || modelhttp.ValidateRequest(req) != nil {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	maxTokens := a.cfg.MaxTokens
	if req.MaxTokens > 0 && req.MaxTokens < maxTokens {
		maxTokens = req.MaxTokens
	}
	payload := responseRequest{
		Model: a.cfg.Model, Input: make([]inputMessage, 0, len(req.Messages)),
		Stream: req.Stream, Store: false, MaxOutputTokens: maxTokens,
	}
	for _, m := range req.Messages {
		payload.Input = append(payload.Input, inputMessage{Role: string(m.Role), Content: m.Content})
	}
	body, err := marshal(payload)
	if err != nil {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	headers := make(http.Header)
	headers.Set("Authorization", "Bearer "+a.cfg.BearerToken)
	if req.Stream {
		headers.Set("Accept", "text/event-stream")
		return a.client.Do(ctx, body, headers, "text/event-stream", req.Timeouts, emit, decodeStream)
	}
	headers.Set("Accept", "application/json")
	return a.client.Do(ctx, body, headers, "application/json", req.Timeouts, emit, decodeResponse)
}

type responseRequest struct {
	Model           string         `json:"model"`
	Input           []inputMessage `json:"input"`
	Stream          bool           `json:"stream"`
	Store           bool           `json:"store"`
	MaxOutputTokens int            `json:"max_output_tokens"`
}

type inputMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type responsePayload struct {
	Status            string             `json:"status"`
	Output            []responseOutput   `json:"output"`
	Usage             *responseUsage     `json:"usage"`
	IncompleteDetails *incompleteDetails `json:"incomplete_details"`
}

type responseOutput struct {
	Type    string            `json:"type"`
	Role    string            `json:"role"`
	Content []responseContent `json:"content"`
}

type responseContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type responseUsage struct {
	InputTokens  int64 `json:"input_tokens"`
	OutputTokens int64 `json:"output_tokens"`
	TotalTokens  int64 `json:"total_tokens"`
}

type incompleteDetails struct {
	Reason string `json:"reason"`
}

type streamEvent struct {
	Type     string           `json:"type"`
	Delta    string           `json:"delta"`
	Response *responsePayload `json:"response"`
}

func marshal(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func decodeResponse(_ context.Context, body io.Reader, max int64, emit func(companion.OutputDelta) error, markFirst func()) (companion.AttemptResult, error) {
	var payload responsePayload
	if err := decodeOne(modelhttp.NewBoundReader(body, max), &payload); err != nil {
		return companion.AttemptResult{}, err
	}
	text, finish, usage, err := completePayload(&payload)
	if err != nil || text == "" || int64(len(text)) > max {
		return companion.AttemptResult{}, modelhttp.ErrMalformed
	}
	markFirst()
	if err := emit(companion.OutputDelta{Text: text}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: finish, Usage: usage}, nil
}

func decodeStream(ctx context.Context, body io.Reader, max int64, emit func(companion.OutputDelta) error, markFirst func()) (companion.AttemptResult, error) {
	var outBytes int64
	var contentSeen bool
	var terminal bool
	var result companion.AttemptResult
	err := modelhttp.DecodeSSE(modelhttp.NewBoundReader(body, max), max, max, func(e modelhttp.SSEEvent) (bool, error) {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if e.Data == "[DONE]" {
			return false, modelhttp.ErrMalformed
		}
		var event streamEvent
		if err := decodeJSON([]byte(e.Data), &event); err != nil || event.Type == "" {
			return false, modelhttp.ErrMalformed
		}
		switch event.Type {
		case "response.output_text.delta", "response.refusal.delta":
			if event.Delta == "" {
				return true, nil
			}
			if int64(len(event.Delta)) > max-outBytes {
				return false, modelhttp.ErrOverLimit
			}
			outBytes += int64(len(event.Delta))
			contentSeen = true
			markFirst()
			if err := emit(companion.OutputDelta{Text: event.Delta}); err != nil {
				return false, err
			}
		case "response.completed", "response.incomplete":
			if terminal || !contentSeen || event.Response == nil {
				return false, modelhttp.ErrMalformed
			}
			_, finish, usage, err := completePayload(event.Response)
			if err != nil {
				return false, err
			}
			terminal = true
			result = companion.AttemptResult{Finish: finish, Usage: usage}
			return false, nil
		case "response.failed", "error":
			return false, companion.UpstreamUnavailable()
		default:
			// Responses adds event types over time. Unknown metadata events do
			// not change the text/terminal invariants above.
		}
		return true, nil
	})
	if err != nil {
		return companion.AttemptResult{}, err
	}
	if !terminal {
		return companion.AttemptResult{}, modelhttp.ErrMalformed
	}
	return result, nil
}

func completePayload(payload *responsePayload) (string, companion.FinishReason, companion.Usage, error) {
	if payload == nil || payload.Usage == nil {
		return "", "", companion.Usage{}, modelhttp.ErrMalformed
	}
	finish := companion.FinishStop
	switch payload.Status {
	case "completed":
	case "incomplete":
		if payload.IncompleteDetails == nil ||
			(payload.IncompleteDetails.Reason != "max_output_tokens" &&
				payload.IncompleteDetails.Reason != "content_filter") {
			return "", "", companion.Usage{}, modelhttp.ErrMalformed
		}
		if payload.IncompleteDetails.Reason == "content_filter" {
			finish = companion.FinishPolicy
		} else {
			finish = companion.FinishLength
		}
	default:
		return "", "", companion.Usage{}, modelhttp.ErrMalformed
	}
	var b strings.Builder
	for _, item := range payload.Output {
		if item.Type != "message" || item.Role != "assistant" {
			continue
		}
		for _, content := range item.Content {
			switch content.Type {
			case "output_text":
				b.WriteString(content.Text)
			case "refusal":
				finish = companion.FinishPolicy
				b.WriteString(content.Text)
			}
		}
	}
	u := payload.Usage
	if u.InputTokens < 0 || u.OutputTokens < 0 || u.TotalTokens < 0 ||
		u.InputTokens > (1<<63-1)-u.OutputTokens ||
		u.InputTokens+u.OutputTokens != u.TotalTokens {
		return "", "", companion.Usage{}, modelhttp.ErrMalformed
	}
	return b.String(), finish, companion.Usage{
		InputTokens: u.InputTokens, OutputTokens: u.OutputTokens, TotalTokens: u.TotalTokens,
	}, nil
}

func decodeOne(r io.Reader, dst any) error {
	dec := json.NewDecoder(r)
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, modelhttp.ErrOverLimit) {
			return modelhttp.ErrOverLimit
		}
		return modelhttp.ErrMalformed
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		return modelhttp.ErrMalformed
	}
	return nil
}

func decodeJSON(data []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		return modelhttp.ErrMalformed
	}
	return nil
}
