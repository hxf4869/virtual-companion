package companion

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// Provider is the only model I/O boundary. companion defines the port;
// provider/openai is the single production implementation. Credential is
// injected at adapter construction, never on ModelRequest.
//
// Stream must return a zero AttemptResult when err != nil, and a complete
// finish+usage result when err == nil. It must not retry, persist, log
// bodies, or expose vendor SDK types.
type Provider interface {
	Stream(
		ctx context.Context,
		request ModelRequest,
		emit func(OutputDelta) error,
	) (AttemptResult, error)
}

// Role is a Chat Completions message role.
type Role string

const (
	RoleSystem    Role = "system"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
)

// Message is one provider-bound chat message. It is already transformed
// context, not a database entity.
type Message struct {
	Role    Role
	Content string
}

// TimeoutBudget is the per-attempt connect/first-token/total budget.
// Zero durations mean "use adapter defaults". The adapter must not enlarge
// any budget past its configured maxima.
type TimeoutBudget struct {
	Connect    time.Duration
	FirstToken time.Duration
	Total      time.Duration
}

// ModelRequest is the immutable outbound plan for one Attempt.
type ModelRequest struct {
	Messages  []Message
	Stream    bool
	Timeouts  TimeoutBudget
	MaxTokens int
}

// OutputDelta is an unterminated text increment. Terminal usage and finish
// reason are not sent through emit.
type OutputDelta struct {
	Text string
}

// FinishReason is the normalized Chat Completions finish_reason.
type FinishReason string

const (
	FinishStop   FinishReason = "stop"
	FinishLength FinishReason = "length"
	FinishPolicy FinishReason = "policy"
)

// Usage is provider-reported token usage. TotalTokens must equal
// InputTokens + OutputTokens. Missing usage is not treated as zero cost.
type Usage struct {
	InputTokens  int64
	OutputTokens int64
	TotalTokens  int64
}

// AttemptResult is returned only on a successful provider stream.
type AttemptResult struct {
	Finish FinishReason
	Usage  Usage
}

// Code is a body-free, low-cardinality provider failure class.
type Code string

const (
	CodeInvalidRequest      Code = "INVALID_REQUEST"
	CodeRateLimited         Code = "RATE_LIMITED"
	CodeUpstreamUnavailable Code = "UPSTREAM_UNAVAILABLE"
	CodeTimeout             Code = "TIMEOUT"
	CodeMalformed           Code = "MALFORMED"
	CodeDisconnected        Code = "DISCONNECTED"
	CodeCanceled            Code = "CANCELED"
)

// TimeoutPhase names which budget expired. Empty unless CodeTimeout.
type TimeoutPhase string

const (
	TimeoutConnect    TimeoutPhase = "CONNECT"
	TimeoutFirstToken TimeoutPhase = "FIRST_TOKEN"
	TimeoutTotal      TimeoutPhase = "TOTAL"
)

// Delivery is whether request bytes left the process. Retry policy (G5/G10)
// consumes this; the adapter itself does not retry.
type Delivery string

const (
	DeliveryNotSent  Delivery = "NOT_SENT"
	DeliveryUnknown  Delivery = "UNKNOWN"
	DeliveryReceived Delivery = "RECEIVED"
)

// Error is the typed provider failure. Error() never includes prompt,
// response, token, URL userinfo, or provider body.
type Error struct {
	Code     Code
	Phase    TimeoutPhase
	Delivery Delivery
}

func (e *Error) Error() string {
	if e == nil {
		return "provider: error"
	}
	if e.Code == CodeTimeout && e.Phase != "" {
		return fmt.Sprintf("provider: %s phase=%s", e.Code, e.Phase)
	}
	return fmt.Sprintf("provider: %s", e.Code)
}

func InvalidRequest() error {
	return &Error{Code: CodeInvalidRequest, Delivery: DeliveryNotSent}
}

func RateLimited() error {
	return &Error{Code: CodeRateLimited, Delivery: DeliveryReceived}
}

func UpstreamUnavailable() error {
	return &Error{Code: CodeUpstreamUnavailable, Delivery: DeliveryReceived}
}

func Timeout(phase TimeoutPhase, delivery Delivery) error {
	return &Error{Code: CodeTimeout, Phase: phase, Delivery: delivery}
}

func Malformed(delivery Delivery) error {
	return &Error{Code: CodeMalformed, Delivery: delivery}
}

func Disconnected(delivery Delivery) error {
	return &Error{Code: CodeDisconnected, Delivery: delivery}
}

func Canceled(delivery Delivery) error {
	return &Error{Code: CodeCanceled, Delivery: delivery}
}

// AsError returns the typed provider error, if any.
func AsError(err error) *Error {
	var pe *Error
	if errors.As(err, &pe) {
		return pe
	}
	return nil
}

// Is reports whether err is a provider error with the given code.
func Is(err error, code Code) bool {
	pe := AsError(err)
	return pe != nil && pe.Code == code
}
