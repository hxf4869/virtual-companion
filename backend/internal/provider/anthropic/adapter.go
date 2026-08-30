package anthropic

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

const apiVersion = "2023-06-01"

type Config struct {
	BaseURL           string
	APIKey            string
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
	if strings.TrimSpace(cfg.Model) == "" || !modelhttp.CredentialValid(cfg.APIKey) {
		return nil, errors.New("provider model and credential are required")
	}
	if cfg.MaxTokens == 0 {
		cfg.MaxTokens = 8192
	}
	if cfg.MaxTokens < 1 || cfg.MaxTokens > 262144 {
		return nil, errors.New("provider max tokens is invalid")
	}
	endpoint, err := modelhttp.ResolveEndpoint(cfg.BaseURL, "ANTHROPIC_MESSAGES", cfg.AllowLoopbackHTTP)
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
	payload := messageRequest{
		Model: a.cfg.Model, MaxTokens: maxTokens, Stream: req.Stream,
		Messages: make([]message, 0, len(req.Messages)),
	}
	var systems []string
	for _, m := range req.Messages {
		if m.Role == companion.RoleSystem {
			systems = append(systems, m.Content)
			continue
		}
		payload.Messages = append(payload.Messages, message{Role: string(m.Role), Content: m.Content})
	}
	if len(payload.Messages) == 0 {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	payload.System = strings.Join(systems, "\n\n")
	body, err := marshal(payload)
	if err != nil {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	headers := make(http.Header)
	headers.Set("x-api-key", a.cfg.APIKey)
	headers.Set("anthropic-version", apiVersion)
	if req.Stream {
		headers.Set("Accept", "text/event-stream")
		return a.client.Do(ctx, body, headers, "text/event-stream", req.Timeouts, emit, decodeStream)
	}
	headers.Set("Accept", "application/json")
	return a.client.Do(ctx, body, headers, "application/json", req.Timeouts, emit, decodeMessage)
}

type messageRequest struct {
	Model     string    `json:"model"`
	MaxTokens int       `json:"max_tokens"`
	System    string    `json:"system,omitempty"`
	Messages  []message `json:"messages"`
	Stream    bool      `json:"stream"`
}

type message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type messagePayload struct {
	Type       string         `json:"type"`
	Role       string         `json:"role"`
	Content    []contentBlock `json:"content"`
	StopReason *string        `json:"stop_reason"`
	Usage      usage          `json:"usage"`
}

type contentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type usage struct {
	InputTokens              *int64 `json:"input_tokens"`
	OutputTokens             *int64 `json:"output_tokens"`
	CacheCreationInputTokens *int64 `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     *int64 `json:"cache_read_input_tokens"`
}

type streamEvent struct {
	Type         string          `json:"type"`
	Index        *int            `json:"index"`
	Message      *messagePayload `json:"message"`
	ContentBlock *contentBlock   `json:"content_block"`
	Delta        *delta          `json:"delta"`
	Usage        *usage          `json:"usage"`
}

type delta struct {
	Type       string  `json:"type"`
	Text       string  `json:"text"`
	StopReason *string `json:"stop_reason"`
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

func decodeMessage(_ context.Context, body io.Reader, max int64, emit func(companion.OutputDelta) error, markFirst func()) (companion.AttemptResult, error) {
	var payload messagePayload
	if err := decodeOne(modelhttp.NewBoundReader(body, max), &payload); err != nil {
		return companion.AttemptResult{}, err
	}
	if payload.Type != "message" || payload.Role != "assistant" {
		return companion.AttemptResult{}, modelhttp.ErrMalformed
	}
	var b strings.Builder
	finish, err := finishReason(payload.StopReason)
	if err != nil {
		return companion.AttemptResult{}, err
	}
	for _, block := range payload.Content {
		if block.Type != "text" {
			return companion.AttemptResult{}, modelhttp.ErrMalformed
		}
		b.WriteString(block.Text)
	}
	if b.Len() == 0 || int64(b.Len()) > max {
		return companion.AttemptResult{}, modelhttp.ErrMalformed
	}
	u, err := normalizeUsage(payload.Usage)
	if err != nil {
		return companion.AttemptResult{}, err
	}
	markFirst()
	if err := emit(companion.OutputDelta{Text: b.String()}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: finish, Usage: u}, nil
}

func decodeStream(ctx context.Context, body io.Reader, max int64, emit func(companion.OutputDelta) error, markFirst func()) (companion.AttemptResult, error) {
	var started, contentSeen, messageDelta, terminal bool
	var outBytes int64
	var startUsage usage
	var finalUsage usage
	var finish companion.FinishReason
	openBlocks := map[int]bool{}
	err := modelhttp.DecodeSSE(modelhttp.NewBoundReader(body, max), max, max, func(e modelhttp.SSEEvent) (bool, error) {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		var event streamEvent
		if err := decodeJSON([]byte(e.Data), &event); err != nil || event.Type == "" {
			return false, modelhttp.ErrMalformed
		}
		switch event.Type {
		case "message_start":
			if started || event.Message == nil || event.Message.Type != "message" || event.Message.Role != "assistant" {
				return false, modelhttp.ErrMalformed
			}
			started = true
			startUsage = event.Message.Usage
		case "content_block_start":
			if !started || event.Index == nil || event.ContentBlock == nil || event.ContentBlock.Type != "text" || openBlocks[*event.Index] {
				return false, modelhttp.ErrMalformed
			}
			openBlocks[*event.Index] = true
			if event.ContentBlock.Text != "" {
				if err := emitText(event.ContentBlock.Text, max, &outBytes, &contentSeen, emit, markFirst); err != nil {
					return false, err
				}
			}
		case "content_block_delta":
			if event.Index == nil || !openBlocks[*event.Index] || event.Delta == nil || event.Delta.Type != "text_delta" {
				return false, modelhttp.ErrMalformed
			}
			if event.Delta.Text != "" {
				if err := emitText(event.Delta.Text, max, &outBytes, &contentSeen, emit, markFirst); err != nil {
					return false, err
				}
			}
		case "content_block_stop":
			if event.Index == nil || !openBlocks[*event.Index] {
				return false, modelhttp.ErrMalformed
			}
			delete(openBlocks, *event.Index)
		case "message_delta":
			if !started || messageDelta || event.Delta == nil || event.Usage == nil {
				return false, modelhttp.ErrMalformed
			}
			var err error
			finish, err = finishReason(event.Delta.StopReason)
			if err != nil {
				return false, err
			}
			finalUsage = *event.Usage
			messageDelta = true
		case "message_stop":
			if !started || !messageDelta || !contentSeen || len(openBlocks) != 0 || terminal {
				return false, modelhttp.ErrMalformed
			}
			terminal = true
			return false, nil
		case "ping":
		case "error":
			return false, companion.UpstreamUnavailable()
		default:
			// Anthropic asks clients to tolerate future event types.
		}
		return true, nil
	})
	if err != nil {
		return companion.AttemptResult{}, err
	}
	if !terminal {
		return companion.AttemptResult{}, modelhttp.ErrMalformed
	}
	combined := startUsage
	combined.OutputTokens = finalUsage.OutputTokens
	u, err := normalizeUsage(combined)
	if err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: finish, Usage: u}, nil
}

func emitText(text string, max int64, outBytes *int64, seen *bool, emit func(companion.OutputDelta) error, markFirst func()) error {
	if int64(len(text)) > max-*outBytes {
		return modelhttp.ErrOverLimit
	}
	*outBytes += int64(len(text))
	*seen = true
	markFirst()
	return emit(companion.OutputDelta{Text: text})
}

func finishReason(raw *string) (companion.FinishReason, error) {
	if raw == nil {
		return "", modelhttp.ErrMalformed
	}
	switch *raw {
	case "end_turn", "stop_sequence":
		return companion.FinishStop, nil
	case "max_tokens", "model_context_window_exceeded":
		return companion.FinishLength, nil
	case "refusal":
		return companion.FinishPolicy, nil
	default:
		return "", modelhttp.ErrMalformed
	}
}

func normalizeUsage(u usage) (companion.Usage, error) {
	if u.InputTokens == nil || u.OutputTokens == nil {
		return companion.Usage{}, modelhttp.ErrMalformed
	}
	values := []*int64{u.InputTokens, u.OutputTokens, u.CacheCreationInputTokens, u.CacheReadInputTokens}
	for _, value := range values {
		if value != nil && *value < 0 {
			return companion.Usage{}, modelhttp.ErrMalformed
		}
	}
	in := *u.InputTokens
	for _, extra := range []*int64{u.CacheCreationInputTokens, u.CacheReadInputTokens} {
		if extra != nil {
			if in > (1<<63-1)-*extra {
				return companion.Usage{}, modelhttp.ErrMalformed
			}
			in += *extra
		}
	}
	out := *u.OutputTokens
	if in > (1<<63-1)-out {
		return companion.Usage{}, modelhttp.ErrMalformed
	}
	return companion.Usage{InputTokens: in, OutputTokens: out, TotalTokens: in + out}, nil
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
