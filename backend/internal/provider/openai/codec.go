package openai

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

type chatRequest struct {
	Model         string         `json:"model"`
	MaxTokens     int            `json:"max_tokens"`
	Temperature   float64        `json:"temperature"`
	Messages      []chatMessage  `json:"messages"`
	Stream        bool           `json:"stream"`
	StreamOptions *streamOptions `json:"stream_options,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type streamOptions struct {
	IncludeUsage bool `json:"include_usage"`
}

type completionPayload struct {
	Object  string             `json:"object"`
	Choices []completionChoice `json:"choices"`
	Usage   *usagePayload      `json:"usage"`
}

type completionChoice struct {
	Index        *int              `json:"index"`
	Message      completionMessage `json:"message"`
	FinishReason *string           `json:"finish_reason"`
}

type completionMessage struct {
	Content json.RawMessage `json:"content"`
}

type streamPayload struct {
	Object  string         `json:"object"`
	Choices []streamChoice `json:"choices"`
	Usage   *usagePayload  `json:"usage"`
}

type streamChoice struct {
	Index        *int        `json:"index"`
	Delta        streamDelta `json:"delta"`
	FinishReason *string     `json:"finish_reason"`
}

type streamDelta struct {
	Content json.RawMessage `json:"content"`
}

type usagePayload struct {
	PromptTokens     tokenCount `json:"prompt_tokens"`
	CompletionTokens tokenCount `json:"completion_tokens"`
	TotalTokens      tokenCount `json:"total_tokens"`
}

type tokenCount struct {
	n   int64
	set bool
}

func (t *tokenCount) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if len(b) == 0 || bytes.ContainsAny(b, ".eE+") {
		return errMalformed
	}
	n, err := strconv.ParseInt(string(b), 10, 64)
	if err != nil || n < 0 {
		return errMalformed
	}
	t.n = n
	t.set = true
	return nil
}

func encodeRequest(cfg Config, req companion.ModelRequest) ([]byte, error) {
	if err := validateRequest(req); err != nil {
		return nil, err
	}
	maxTokens := cfg.MaxTokens
	if req.MaxTokens > 0 && req.MaxTokens < maxTokens {
		maxTokens = req.MaxTokens
	}
	body := chatRequest{
		Model:       cfg.Model,
		MaxTokens:   maxTokens,
		Temperature: cfg.Temperature,
		Messages:    make([]chatMessage, 0, len(req.Messages)),
		Stream:      req.Stream,
	}
	for _, m := range req.Messages {
		body.Messages = append(body.Messages, chatMessage{
			Role:    string(m.Role),
			Content: m.Content,
		})
	}
	if req.Stream {
		body.StreamOptions = &streamOptions{IncludeUsage: true}
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(body); err != nil {
		return nil, errMalformed
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

func validateRequest(req companion.ModelRequest) error {
	if len(req.Messages) == 0 || len(req.Messages) > maxMessages {
		return companion.InvalidRequest()
	}
	if req.MaxTokens < 0 {
		return companion.InvalidRequest()
	}
	for _, m := range req.Messages {
		switch m.Role {
		case companion.RoleSystem, companion.RoleUser, companion.RoleAssistant:
		default:
			return companion.InvalidRequest()
		}
		if m.Content == "" || !utf8.ValidString(m.Content) {
			return companion.InvalidRequest()
		}
		if len(m.Content) > maxMessageBytes {
			return companion.InvalidRequest()
		}
	}
	return nil
}

func decodeCompletion(r io.Reader, maxBytes int64) (string, companion.Usage, companion.FinishReason, error) {
	dec := json.NewDecoder(newBoundReader(r, maxBytes))
	dec.UseNumber()
	var payload completionPayload
	if err := dec.Decode(&payload); err != nil {
		if err == errOverLimit {
			return "", companion.Usage{}, "", errOverLimit
		}
		return "", companion.Usage{}, "", errMalformed
	}
	if dec.More() {
		return "", companion.Usage{}, "", errMalformed
	}
	if payload.Object != "chat.completion" {
		return "", companion.Usage{}, "", errMalformed
	}
	if len(payload.Choices) != 1 || payload.Choices[0].Index == nil || *payload.Choices[0].Index != 0 {
		return "", companion.Usage{}, "", errMalformed
	}
	units, present, err := jsonStringUTF16(payload.Choices[0].Message.Content)
	if err != nil || !present {
		return "", companion.Usage{}, "", errMalformed
	}
	var join utf16Join
	text, err := join.append(units)
	if err != nil || join.pendingIncomplete() || text == "" {
		return "", companion.Usage{}, "", errMalformed
	}
	finish, err := mapFinishReason(payload.Choices[0].FinishReason)
	if err != nil || finish == "" {
		return "", companion.Usage{}, "", errMalformed
	}
	usage, err := mapUsage(payload.Usage)
	if err != nil {
		return "", companion.Usage{}, "", err
	}
	return text, usage, finish, nil
}

func decodeStreamChunk(data string) (content []uint16, contentPresent bool, finish companion.FinishReason, usage *companion.Usage, err error) {
	if strings.TrimSpace(data) == "" {
		return nil, false, "", nil, errMalformed
	}
	dec := json.NewDecoder(strings.NewReader(data))
	dec.UseNumber()
	var payload streamPayload
	if err := dec.Decode(&payload); err != nil {
		return nil, false, "", nil, errMalformed
	}
	if dec.More() {
		return nil, false, "", nil, errMalformed
	}
	if payload.Object != "chat.completion.chunk" {
		return nil, false, "", nil, errMalformed
	}
	hasUsage := payload.Usage != nil
	if len(payload.Choices) == 0 {
		if !hasUsage {
			return nil, false, "", nil, errMalformed
		}
		u, uerr := mapUsage(payload.Usage)
		if uerr != nil {
			return nil, false, "", nil, uerr
		}
		return nil, false, "", &u, nil
	}
	if len(payload.Choices) != 1 || hasUsage {
		return nil, false, "", nil, errMalformed
	}
	choice := payload.Choices[0]
	if choice.Index == nil || *choice.Index != 0 {
		return nil, false, "", nil, errMalformed
	}
	units, present, err := jsonStringUTF16(choice.Delta.Content)
	if err != nil {
		return nil, false, "", nil, err
	}
	if present && len(units) == 0 {
		present = false
	}
	var reason companion.FinishReason
	if choice.FinishReason != nil && *choice.FinishReason != "" {
		reason, err = mapFinishReason(choice.FinishReason)
		if err != nil {
			return nil, false, "", nil, err
		}
	}
	return units, present, reason, nil, nil
}

func mapFinishReason(raw *string) (companion.FinishReason, error) {
	if raw == nil {
		return "", errMalformed
	}
	switch *raw {
	case "stop":
		return companion.FinishStop, nil
	case "length":
		return companion.FinishLength, nil
	case "content_filter":
		return companion.FinishPolicy, nil
	default:
		return "", errMalformed
	}
}

func mapUsage(u *usagePayload) (companion.Usage, error) {
	if u == nil {
		return companion.Usage{}, errMalformed
	}
	if !u.PromptTokens.set || !u.CompletionTokens.set || !u.TotalTokens.set {
		return companion.Usage{}, errMalformed
	}
	in, out, total := u.PromptTokens.n, u.CompletionTokens.n, u.TotalTokens.n
	if in < 0 || out < 0 || total < 0 {
		return companion.Usage{}, errMalformed
	}
	if in > (1<<63-1)-out || in+out != total {
		return companion.Usage{}, errMalformed
	}
	return companion.Usage{InputTokens: in, OutputTokens: out, TotalTokens: total}, nil
}

func mediaType(v string) string {
	if i := strings.IndexByte(v, ';'); i >= 0 {
		v = v[:i]
	}
	return strings.ToLower(strings.TrimSpace(v))
}
