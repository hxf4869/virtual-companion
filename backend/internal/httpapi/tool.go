package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

// toolStore is the W11 execution surface. Handlers bind it by type assertion
// so CompanionStore stays unchanged.
type toolStore interface {
	ExecuteTool(context.Context, int64, postgres.ToolRequest) (postgres.ToolExecution, error)
}

// The service-token channel accepts a caller-supplied owner, so tools use the
// cookie session instead. The relationship is the chat already bound to that
// session. Fresh reauth is not required: this is an in-chat plugin call, the
// same class as memory recall, and a reauth window would stop the tool loop.
const toolExecutePath = "/api/v1/st/tools/execute"

var toolKeyPattern = regexp.MustCompile(`^[A-Za-z0-9._:~-]{8,200}$`)

var toolForbiddenKeys = []string{"relationshipId", "ownerUserId", "ownerId", "ownerAccountId"}

type toolExecuteJSON struct {
	ExecutionID   string          `json:"executionId"`
	Tool          string          `json:"tool"`
	Status        string          `json:"status"`
	FailureCode   *string         `json:"failureCode"`
	Result        json.RawMessage `json:"result"`
	Purpose       *string         `json:"purpose"`
	ModelRevision *string         `json:"modelRevision"`
	Step          *int            `json:"step"`
	TimeoutMs     *int            `json:"timeoutMs"`
	TokenLimit    *int            `json:"tokenLimit"`
}

func (s *Server) handleExecuteTool(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	raw, ok := s.toolBody(w, r)
	if !ok {
		return
	}
	in, ok := s.toolRequest(w, raw)
	if !ok {
		return
	}
	store, ok := s.tools(w)
	if !ok {
		return
	}
	out, err := store.ExecuteTool(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, toolJSON(out))
}

func (s *Server) tools(w http.ResponseWriter) (toolStore, bool) {
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil, false
	}
	store, ok := s.core.Store.(toolStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return nil, false
	}
	return store, true
}

func (s *Server) toolBody(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	var raw map[string]json.RawMessage
	if !s.decodeJSON(w, r, &raw) {
		return nil, false
	}
	if raw == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return nil, false
	}
	return raw, true
}

func (s *Server) toolRequest(w http.ResponseWriter, raw map[string]json.RawMessage) (postgres.ToolRequest, bool) {
	chat, _, ok := jsonString(raw, "chatIdentity")
	if !ok || !stsource.ValidIdentity(chat) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	key, _, ok := jsonString(raw, "idempotencyKey")
	if !ok || !toolKeyPattern.MatchString(key) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	tool, toolSet, ok := jsonString(raw, "tool")
	if !ok || (toolSet && strings.TrimSpace(tool) == "") {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	purpose, err := optionalBounded(raw, "purpose", 64)
	if err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	revision, err := optionalBounded(raw, "modelRevision", 128)
	if err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	step, ok := optionalToolInt(raw, "step")
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	timeoutMs, ok := optionalToolInt(raw, "timeoutMs")
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	tokenLimit, ok := optionalToolInt(raw, "tokenLimit")
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return postgres.ToolRequest{}, false
	}
	args := json.RawMessage(`{}`)
	if value, exists := raw["arguments"]; exists && string(bytes.TrimSpace(value)) != "null" {
		args = value
	}
	role, _, _ := jsonString(raw, "role")
	_, hasContent := raw["content"]
	_, hasUtterance := raw["utterance"]
	assistant := role == "assistant" || hasContent || hasUtterance
	forbidden := false
	for _, key := range toolForbiddenKeys {
		if _, exists := raw[key]; exists {
			forbidden = true
			break
		}
	}
	return postgres.ToolRequest{
		ChatIdentity:   chat,
		IdempotencyKey: key,
		Tool:           tool,
		Arguments:      args,
		Assistant:      assistant,
		Forbidden:      forbidden,
		Purpose:        purpose,
		ModelRevision:  revision,
		Step:           step,
		TimeoutMs:      timeoutMs,
		TokenLimit:     tokenLimit,
	}, true
}

func jsonString(raw map[string]json.RawMessage, key string) (string, bool, bool) {
	value, exists := raw[key]
	if !exists || string(bytes.TrimSpace(value)) == "null" {
		return "", false, true
	}
	var text string
	if err := json.Unmarshal(value, &text); err != nil {
		return "", false, false
	}
	return text, true, true
}

func optionalBounded(raw map[string]json.RawMessage, key string, maxRunes int) (*string, error) {
	text, set, ok := jsonString(raw, key)
	if !ok {
		return nil, io.ErrUnexpectedEOF
	}
	if !set {
		return nil, nil
	}
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > maxRunes {
		return nil, io.ErrUnexpectedEOF
	}
	return &trimmed, nil
}

func optionalToolInt(raw map[string]json.RawMessage, key string) (*int, bool) {
	value, exists := raw[key]
	if !exists || string(bytes.TrimSpace(value)) == "null" {
		return nil, true
	}
	dec := json.NewDecoder(bytes.NewReader(value))
	dec.UseNumber()
	var number json.Number
	if err := dec.Decode(&number); err != nil {
		return nil, false
	}
	var extra json.RawMessage
	if err := dec.Decode(&extra); err != io.EOF {
		return nil, false
	}
	parsed, err := number.Int64()
	if err != nil || parsed > math.MaxInt32 || parsed < math.MinInt32 {
		return nil, false
	}
	out := int(parsed)
	return &out, true
}

func toolJSON(out postgres.ToolExecution) toolExecuteJSON {
	result := out.Result
	if len(bytes.TrimSpace(result)) == 0 {
		result = json.RawMessage(`{}`)
	}
	return toolExecuteJSON{
		ExecutionID:   idString(out.ID),
		Tool:          out.Tool,
		Status:        out.Status,
		FailureCode:   out.FailureCode,
		Result:        result,
		Purpose:       out.Purpose,
		ModelRevision: out.ModelRevision,
		Step:          out.Step,
		TimeoutMs:     out.TimeoutMs,
		TokenLimit:    out.TokenLimit,
	}
}
