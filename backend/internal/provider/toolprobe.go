package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/provider/anthropic"
	"github.com/hxf4869/virtual-companion/internal/provider/modelhttp"
)

const (
	// ToolProbeName is the single synthetic function the verification request
	// requires the model to call.
	ToolProbeName = "get_current_weather"
	// ToolProbeMaxTokens is the small output cap of that one request.
	ToolProbeMaxTokens = 64

	ToolProbeCodeMismatch    = "TOOL_CALL_MISMATCH"
	ToolProbeCodeMalformed   = "UPSTREAM_MALFORMED"
	ToolProbeCodeUnavailable = "UPSTREAM_UNAVAILABLE"
)

// ToolProbeResult is a successful synthetic tool call. Token fields are set
// only when the provider reported usage.
type ToolProbeResult struct {
	InputTokens       int64
	OutputTokens      int64
	CachedInputTokens *int64
	HasUsage          bool
	Sent              bool
}

// ToolProbeError is a failed probe. Code is a stable reason; the upstream
// body is never retained.
type ToolProbeError struct {
	Code string
	Sent bool
}

func (e *ToolProbeError) Error() string {
	if e == nil || e.Code == "" {
		return ToolProbeCodeUnavailable
	}
	return e.Code
}

// ProbeToolCalls sends one non-streaming request that forces get_current_weather.
// Generation adapters still do not accept tool calls; this probe parses only
// the three non-stream success shapes and discards every other byte.
func (f Factory) ProbeToolCalls(ctx context.Context, route Route) (ToolProbeResult, error) {
	if strings.TrimSpace(route.ModelID) == "" || !modelhttp.CredentialValid(route.Credential) {
		return ToolProbeResult{}, &ToolProbeError{Code: ToolProbeCodeUnavailable}
	}
	endpoint, err := modelhttp.ResolveEndpoint(route.BaseURL, route.Protocol, f.AllowLoopbackHTTP)
	if err != nil {
		return ToolProbeResult{}, &ToolProbeError{Code: ToolProbeCodeUnavailable}
	}
	client, err := modelhttp.New(modelhttp.Config{
		Endpoint: endpoint, ConnectTimeout: f.ConnectTimeout,
		FirstTokenTimeout: f.FirstTokenTimeout, TotalTimeout: f.TotalTimeout,
		MaxResponseBytes: f.MaxResponseBytes,
	})
	if err != nil {
		return ToolProbeResult{}, &ToolProbeError{Code: ToolProbeCodeUnavailable}
	}
	defer client.Close()
	payload, headers, err := toolProbeRequest(route)
	if err != nil {
		return ToolProbeResult{}, &ToolProbeError{Code: ToolProbeCodeUnavailable}
	}
	body, sent, err := client.PostJSON(ctx, payload, headers)
	if err != nil {
		return ToolProbeResult{Sent: sent}, &ToolProbeError{Code: ToolProbeCodeUnavailable, Sent: sent}
	}
	parsed, err := parseToolProbe(route.Protocol, body)
	parsed.Sent = true
	if err != nil {
		code := ToolProbeCodeMalformed
		var probe *ToolProbeError
		if errors.As(err, &probe) && probe.Code != "" {
			code = probe.Code
		}
		return parsed, &ToolProbeError{Code: code, Sent: true}
	}
	return parsed, nil
}

func toolProbeRequest(route Route) ([]byte, http.Header, error) {
	headers := make(http.Header)
	var payload any
	switch route.Protocol {
	case "OPENAI_CHAT_COMPLETIONS":
		headers.Set("Authorization", "Bearer "+route.Credential)
		payload = map[string]any{
			"model": route.ModelID, "max_tokens": ToolProbeMaxTokens, "stream": false,
			"messages":    []map[string]string{{"role": "user", "content": "Report the current weather."}},
			"tools":       []any{chatTool()},
			"tool_choice": map[string]any{"type": "function", "function": map[string]string{"name": ToolProbeName}},
		}
	case "OPENAI_RESPONSES":
		headers.Set("Authorization", "Bearer "+route.Credential)
		payload = map[string]any{
			"model": route.ModelID, "max_output_tokens": ToolProbeMaxTokens, "stream": false, "store": false,
			"input":       []map[string]string{{"role": "user", "content": "Report the current weather."}},
			"tools":       []any{responsesTool()},
			"tool_choice": map[string]string{"type": "function", "name": ToolProbeName},
		}
	case "ANTHROPIC_MESSAGES":
		headers.Set("x-api-key", route.Credential)
		headers.Set("anthropic-version", "2023-06-01")
		payload = map[string]any{
			"model": route.ModelID, "max_tokens": ToolProbeMaxTokens, "stream": false,
			"messages":    []map[string]string{{"role": "user", "content": "Report the current weather."}},
			"tools":       []any{anthropicTool()},
			"tool_choice": map[string]string{"type": "tool", "name": ToolProbeName},
		}
	default:
		return nil, nil, errProbeProtocol
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	return body, headers, nil
}

var errProbeProtocol = &ToolProbeError{Code: ToolProbeCodeUnavailable}

func weatherParameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"city": map[string]string{"type": "string"},
		},
		"required": []string{"city"},
	}
}

func chatTool() map[string]any {
	return map[string]any{
		"type": "function",
		"function": map[string]any{
			"name": ToolProbeName, "description": "Get the current weather for a city",
			"parameters": weatherParameters(),
		},
	}
}

func responsesTool() map[string]any {
	return map[string]any{
		"type": "function", "name": ToolProbeName,
		"description": "Get the current weather for a city", "parameters": weatherParameters(),
	}
}

func anthropicTool() map[string]any {
	return map[string]any{
		"name": ToolProbeName, "description": "Get the current weather for a city",
		"input_schema": weatherParameters(),
	}
}

func parseToolProbe(protocol string, body []byte) (ToolProbeResult, error) {
	switch protocol {
	case "OPENAI_CHAT_COMPLETIONS":
		return parseChatToolProbe(body)
	case "OPENAI_RESPONSES":
		return parseResponsesToolProbe(body)
	case "ANTHROPIC_MESSAGES":
		return parseAnthropicToolProbe(body)
	default:
		return ToolProbeResult{}, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
}

func parseChatToolProbe(body []byte) (ToolProbeResult, error) {
	var payload struct {
		Choices []struct {
			Message struct {
				ToolCalls []struct {
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"message"`
		} `json:"choices"`
		Usage *struct {
			PromptTokens        int64 `json:"prompt_tokens"`
			CompletionTokens    int64 `json:"completion_tokens"`
			PromptTokensDetails *struct {
				CachedTokens *int64 `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
		} `json:"usage"`
	}
	out := ToolProbeResult{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	if payload.Usage != nil {
		out.HasUsage = true
		out.InputTokens = payload.Usage.PromptTokens
		out.OutputTokens = payload.Usage.CompletionTokens
		if payload.Usage.PromptTokensDetails != nil {
			out.CachedInputTokens = payload.Usage.PromptTokensDetails.CachedTokens
		}
	}
	if len(payload.Choices) == 0 || len(payload.Choices[0].Message.ToolCalls) == 0 {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	call := payload.Choices[0].Message.ToolCalls[0].Function
	if err := acceptToolArguments(call.Name, call.Arguments); err != nil {
		return out, err
	}
	return out, nil
}

func parseResponsesToolProbe(body []byte) (ToolProbeResult, error) {
	var payload struct {
		Output []struct {
			Type      string `json:"type"`
			Name      string `json:"name"`
			Arguments string `json:"arguments"`
		} `json:"output"`
		Usage *struct {
			InputTokens        int64 `json:"input_tokens"`
			OutputTokens       int64 `json:"output_tokens"`
			InputTokensDetails *struct {
				CachedTokens *int64 `json:"cached_tokens"`
			} `json:"input_tokens_details"`
		} `json:"usage"`
	}
	out := ToolProbeResult{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	if payload.Usage != nil {
		out.HasUsage = true
		out.InputTokens = payload.Usage.InputTokens
		out.OutputTokens = payload.Usage.OutputTokens
		if payload.Usage.InputTokensDetails != nil {
			out.CachedInputTokens = payload.Usage.InputTokensDetails.CachedTokens
		}
	}
	var name, args string
	found := false
	for _, item := range payload.Output {
		if item.Type == "function_call" {
			name, args, found = item.Name, item.Arguments, true
			break
		}
	}
	if !found {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	if err := acceptToolArguments(name, args); err != nil {
		return out, err
	}
	return out, nil
}

func parseAnthropicToolProbe(body []byte) (ToolProbeResult, error) {
	var payload struct {
		Content []struct {
			Type  string          `json:"type"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		} `json:"content"`
		Usage json.RawMessage `json:"usage"`
	}
	out := ToolProbeResult{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	if len(payload.Usage) > 0 && string(payload.Usage) != "null" {
		normalized, err := anthropic.NormalizeReportedUsage(payload.Usage)
		if err != nil {
			return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
		}
		out.HasUsage = true
		out.InputTokens = normalized.InputTokens
		out.OutputTokens = normalized.OutputTokens
		out.CachedInputTokens = normalized.CachedInputTokens
	}
	var name string
	var input json.RawMessage
	found := false
	for _, block := range payload.Content {
		if block.Type == "tool_use" {
			name, input, found = block.Name, block.Input, true
			break
		}
	}
	if !found {
		return out, &ToolProbeError{Code: ToolProbeCodeMalformed}
	}
	if err := acceptToolArguments(name, string(input)); err != nil {
		return out, err
	}
	return out, nil
}

func acceptToolArguments(name, raw string) error {
	if name != ToolProbeName {
		return &ToolProbeError{Code: ToolProbeCodeMismatch}
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return &ToolProbeError{Code: ToolProbeCodeMismatch}
	}
	city, ok := args["city"].(string)
	if !ok || strings.TrimSpace(city) == "" {
		return &ToolProbeError{Code: ToolProbeCodeMismatch}
	}
	return nil
}
