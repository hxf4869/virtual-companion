package companion

import (
	"time"
	"unicode/utf8"
)

// Phase is the process-local Turn projection. It is not a second durable
// state machine; persistence stays on the generation catalog until G10.
type Phase string

const (
	PhaseAccepted   Phase = "ACCEPTED"
	PhasePreparing  Phase = "PREPARING"
	PhaseCalling    Phase = "CALLING"
	PhaseReviewing  Phase = "REVIEWING"
	PhaseCommitting Phase = "COMMITTING"
	PhaseCompleted  Phase = "COMPLETED"
	PhaseBlocked    Phase = "BLOCKED"
	PhaseFailed     Phase = "FAILED"
	PhaseCancelling Phase = "CANCELLING"
	PhaseCancelled  Phase = "CANCELLED"
)

// AttemptStatus is a durable Attempt terminal (or CREATED before stream).
type AttemptStatus string

const (
	AttemptCreated        AttemptStatus = "CREATED"
	AttemptSucceeded      AttemptStatus = "SUCCEEDED"
	AttemptFailed         AttemptStatus = "FAILED"
	AttemptTimedOut       AttemptStatus = "TIMED_OUT"
	AttemptCancelled      AttemptStatus = "CANCELLED"
	AttemptOutcomeUnknown AttemptStatus = "OUTCOME_UNKNOWN"
)

func (s AttemptStatus) Terminal() bool {
	switch s {
	case AttemptSucceeded, AttemptFailed, AttemptTimedOut, AttemptCancelled, AttemptOutcomeUnknown:
		return true
	default:
		return false
	}
}

// PublicEvent is a client-visible SSE name. G5 maps outcomes to these names;
// G6 owns the hub/SSE transport.
type PublicEvent string

const (
	EventAccepted  PublicEvent = "chat.accepted"
	EventDelta     PublicEvent = "chat.delta"
	EventSnapshot  PublicEvent = "chat.snapshot"
	EventCompleted PublicEvent = "chat.completed"
	EventBlocked   PublicEvent = "chat.blocked"
	EventFailed    PublicEvent = "chat.failed"
	EventCancelled PublicEvent = "chat.cancelled"
)

// BillingDisposition is the three reachable Attempt billing states.
type BillingDisposition string

const (
	BillingNotSent       BillingDisposition = "NOT_SENT"
	BillingUsageReported BillingDisposition = "USAGE_REPORTED"
	BillingUnknown       BillingDisposition = "UNKNOWN"
)

// TurnBudget is frozen at intake/prepare and audited with the Attempt.
// Runtime admission limits are not part of this value.
type TurnBudget struct {
	MaxInputTokens    int
	MaxOutputTokens   int
	MaxResponseBytes  int64
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxAttempts       int
	MaxReservedCost   int64
}

const (
	tokenEstimateBytesPerToken = 4
	// MaxMessageBytes is the per-block UTF-8 byte clamp.
	MaxMessageBytes = 64 << 10
)

// EstimateTokens is the deterministic UTF-8 bytes/4 estimate. The same
// input always yields the same number; it is not a vendor tokenizer.
func EstimateTokens(s string) int {
	n := len(s)
	if n == 0 {
		return 0
	}
	return (n + tokenEstimateBytesPerToken - 1) / tokenEstimateBytesPerToken
}

// ClampUTF8 shortens s to at most max bytes on a code-point boundary.
func ClampUTF8(s string, max int) string {
	if max <= 0 {
		return ""
	}
	if len(s) <= max {
		return s
	}
	limit := max
	for limit > 0 && !utf8.RuneStart(s[limit]) {
		limit--
	}
	return s[:limit]
}

// LastRunes returns the trailing n runes of s.
func LastRunes(s string, n int) string {
	if n <= 0 || s == "" {
		return ""
	}
	i := len(s)
	for count := 0; i > 0 && count < n; count++ {
		_, size := utf8.DecodeLastRuneInString(s[:i])
		if size <= 0 {
			break
		}
		i -= size
	}
	return s[i:]
}

// Review is a body-free safety decision consumed by the engine.
type Review struct {
	Allow bool
	Risk  string
	Rules []string
}

func (r Review) Code() string {
	if r.Allow {
		return "ALLOW"
	}
	if len(r.Rules) > 0 {
		return r.Rules[0]
	}
	return "BLOCK"
}

// OutputGuard is the concrete rolling/final reviewer. It is a function plus
// a window size, not an interface.
type OutputGuard struct {
	Review      func(window string) Review
	WindowRunes int
}

// AttemptOutcome is the terminal Attempt record. It never carries body text.
type AttemptOutcome struct {
	TurnID     string
	AttemptID  string
	Status     AttemptStatus
	Failure    string
	Delivery   Delivery
	Billing    BillingDisposition
	Finish     FinishReason
	Usage      Usage
	Budget     TurnBudget
	Categories []string
}

// ClassifyBilling maps delivery/usage onto the three reachable dispositions.
func ClassifyBilling(delivery Delivery, usage Usage, err error) BillingDisposition {
	if err == nil {
		if usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 {
			return BillingUsageReported
		}
		if delivery == DeliveryNotSent {
			return BillingNotSent
		}
		return BillingUnknown
	}
	pe := AsError(err)
	if pe != nil && pe.Delivery == DeliveryNotSent {
		return BillingNotSent
	}
	if pe != nil && pe.Delivery == DeliveryReceived &&
		(usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0) {
		return BillingUsageReported
	}
	if delivery == DeliveryNotSent && pe == nil {
		return BillingNotSent
	}
	return BillingUnknown
}

// ClassifyAttempt maps a provider error onto a terminal Attempt status.
func ClassifyAttempt(err error) (AttemptStatus, string) {
	if err == nil {
		return AttemptSucceeded, ""
	}
	pe := AsError(err)
	if pe == nil {
		return AttemptFailed, string(CodeDisconnected)
	}
	switch pe.Code {
	case CodeTimeout:
		return AttemptTimedOut, string(pe.Code)
	case CodeCanceled:
		return AttemptCancelled, string(pe.Code)
	case CodeDisconnected, CodeMalformed, CodeUpstreamUnavailable:
		if pe.Delivery == DeliveryUnknown {
			return AttemptOutcomeUnknown, string(pe.Code)
		}
		return AttemptFailed, string(pe.Code)
	default:
		if pe.Delivery == DeliveryUnknown {
			return AttemptOutcomeUnknown, string(pe.Code)
		}
		return AttemptFailed, string(pe.Code)
	}
}
