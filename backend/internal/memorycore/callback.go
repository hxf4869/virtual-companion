// Package memorycore owns the bounded model capability used by the isolated
// MemoryCore engine. It does not enqueue work or publish production memories.
package memorycore

import (
	"context"
	"crypto/rand"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/provider/modelhttp"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var ErrCapability = errors.New("memorycore capability unavailable")
var ErrReplay = errors.New("memorycore call already consumed")
var ErrParameters = errors.New("memorycore model parameters unsupported")
var ErrPurposeDisabled = errors.New("memorycore purpose disabled")
var ErrCredentialRevoked = errors.New("memorycore credential revoked")
var ErrBudget = errors.New("memorycore budget denied")

type Store interface {
	ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error)
	PrepareMemoryCoreCall(context.Context, postgres.MemoryCoreCall) (postgres.MemoryExtractPreparation, error)
	RecordMemoryExtractOutcome(context.Context, int64, int64, int64, postgres.MemoryExtractOutcome) (int64, error)
}
type Scope struct {
	Owner, Job, Source                  int64
	ClaimToken, ClaimFence, OperationID string
	ExpiresAt                           time.Time
}
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}
type Request struct {
	OperationToken string    `json:"operationToken"`
	Stage          string    `json:"stage"`
	CallSequence   int       `json:"callSequence"`
	Messages       []Message `json:"messages"`
}
type Usage struct {
	InputTokens  int64 `json:"inputTokens"`
	OutputTokens int64 `json:"outputTokens"`
	TotalTokens  int64 `json:"totalTokens"`
}
type Response struct {
	Text         string                 `json:"text"`
	Usage        Usage                  `json:"usage"`
	FinishReason companion.FinishReason `json:"finishReason"`
}
type operation struct {
	sync.Mutex
	scope   Scope
	purpose postgres.ResolvedPurpose
	last    int
	revoked bool
}
type Broker struct {
	sync.Mutex
	store      Store
	factory    func(modelprovider.Route) (companion.Provider, error)
	operations map[string]*operation
}

func New(store Store, factory func(modelprovider.Route) (companion.Provider, error)) *Broker {
	return &Broker{store: store, factory: factory, operations: map[string]*operation{}}
}

// Open is a Go-only method. Neither browser nor model can create a capability,
// select the owner or route, or choose an arbitrary callback destination.
func (b *Broker) Open(ctx context.Context, scope Scope) (string, error) {
	if scope.Owner <= 0 || scope.Job <= 0 || scope.Source <= 0 || scope.ClaimToken == "" || scope.ClaimFence == "" || scope.OperationID == "" || len(scope.OperationID) > 128 || !scope.ExpiresAt.After(time.Now()) || scope.ExpiresAt.After(time.Now().Add(10*time.Minute)) {
		return "", ErrCapability
	}
	purpose, err := b.store.ResolvePurpose(ctx, postgres.ResolvePurpose{OwnerAccountID: scope.Owner, Purpose: postgres.PurposeMemoryExtraction})
	if err != nil {
		return "", err
	}
	if _, err := route(purpose); err != nil {
		return "", err
	}
	token := rand.Text()
	b.Lock()
	defer b.Unlock()
	for key, op := range b.operations {
		if !op.scope.ExpiresAt.After(time.Now()) {
			delete(b.operations, key)
		}
	}
	b.operations[token] = &operation{scope: scope, purpose: purpose}
	return token, nil
}
func (b *Broker) Revoke(token string) {
	b.Lock()
	op := b.operations[token]
	delete(b.operations, token)
	b.Unlock()
	if op != nil {
		op.Lock()
		op.revoked = true
		op.Unlock()
	}
}
func (b *Broker) Call(ctx context.Context, req Request) (Response, error) {
	switch req.Stage {
	case "l1-extraction", "l1-conflict-detection", "l2-scene", "l3-persona":
	default:
		return Response{}, ErrCapability
	}
	b.Lock()
	op := b.operations[req.OperationToken]
	b.Unlock()
	if op == nil {
		return Response{}, ErrCapability
	}
	op.Lock()
	defer op.Unlock()
	if op.revoked || !op.scope.ExpiresAt.After(time.Now()) {
		return Response{}, ErrCapability
	}
	// A new token may resend the timed-out sequence. The same token still
	// refuses any sequence it has already handed to the provider.
	if req.CallSequence < 1 || req.CallSequence > 32 || (op.last > 0 && req.CallSequence != op.last+1) {
		return Response{}, ErrReplay
	}
	plan := companion.ModelRequest{Stream: false, MaxTokens: min(4096, op.purpose.Model.MaxOutputTokens)}
	if remaining := time.Until(op.scope.ExpiresAt); remaining > 0 {
		// The factory clamps this down to its own ceiling. Zero would keep
		// the chat defaults, which are shorter than a reasoning-max call.
		plan.Timeouts = companion.TimeoutBudget{FirstToken: remaining, Total: remaining}
	}
	raw := make([]companion.Message, 0, len(req.Messages))
	for _, m := range req.Messages {
		raw = append(raw, companion.Message{Role: companion.Role(m.Role), Content: m.Content})
	}
	// OpenAI Chat Completions relays almost always accept a system role, but an
	// UNKNOWN declaration must not block extraction. UNSUPPORTED stays refused.
	// temperature and topP are unchanged: a set value still needs DECLARED or VERIFIED.
	folded, foldErr := applySystemMessage(raw, op.purpose.Model.Capabilities["systemMessage"])
	if foldErr != nil {
		return Response{}, foldErr
	}
	tokens := 0
	for _, m := range folded {
		plan.Messages = append(plan.Messages, m)
		tokens += companion.EstimateTokens(m.Content)
	}
	if modelhttp.ValidateRequest(plan) != nil || tokens > 32768 {
		return Response{}, companion.InvalidRequest()
	}
	if op.purpose.Model.ContextWindowTokens != nil && tokens+plan.MaxTokens > *op.purpose.Model.ContextWindowTokens {
		return Response{}, companion.InvalidRequest()
	}
	// MODEL01: the in-flight call keeps the snapshot frozen at Open. Sending
	// still re-reads the purpose with no revision assertion, so a disable or
	// a revoked credential stops the request. A revision change alone does not.
	if _, err := b.store.ResolvePurpose(ctx, postgres.ResolvePurpose{OwnerAccountID: op.scope.Owner, Purpose: postgres.PurposeMemoryExtraction}); err != nil {
		var unavailable *postgres.PurposeUnavailableError
		if errors.As(err, &unavailable) {
			if unavailable.Reason == postgres.PurposeReasonCredential {
				return Response{}, ErrCredentialRevoked
			}
			return Response{}, ErrPurposeDisabled
		}
		return Response{}, err
	}
	r, err := route(op.purpose)
	if err != nil {
		return Response{}, err
	}
	provider, err := b.factory(r)
	if err != nil {
		return Response{}, ErrParameters
	}
	if closer, ok := provider.(interface{ Close() }); ok {
		defer closer.Close()
	}
	prep, err := b.store.PrepareMemoryCoreCall(ctx, postgres.MemoryCoreCall{Owner: op.scope.Owner, Job: op.scope.Job, Source: op.scope.Source, ClaimToken: op.scope.ClaimToken, ClaimFence: op.scope.ClaimFence, OperationID: op.scope.OperationID, Stage: req.Stage, CallSequence: req.CallSequence, ProviderID: op.purpose.ProviderID, SupplierName: op.purpose.ProviderName, ModelID: op.purpose.Model.ModelID, InputTokens: tokens, OutputTokens: plan.MaxTokens})
	if err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return Response{}, ErrReplay
		}
		if errors.Is(err, postgres.ErrRateLimited) {
			return Response{}, ErrBudget
		}
		var usage *postgres.ModelUsageError
		if errors.As(err, &usage) && (usage.Reason == postgres.ModelUsageNoBudget || usage.Reason == postgres.ModelUsageOverLimit) {
			return Response{}, ErrBudget
		}
		return Response{}, err
	}
	if (prep.Decision != "EXTRACTABLE" && prep.Decision != "RETRY_TIMEOUT") || prep.AttemptID <= 0 {
		return Response{}, admissionError(prep)
	}
	op.last = req.CallSequence // Never replay a potentially sent call, even after timeout.
	callCtx, cancel := context.WithDeadline(ctx, op.scope.ExpiresAt)
	defer cancel()
	var out strings.Builder
	result, callErr := provider.Stream(callCtx, plan, func(d companion.OutputDelta) error {
		if out.Len()+len(d.Text) > 256<<10 {
			return companion.Malformed(companion.DeliveryReceived)
		}
		out.WriteString(d.Text)
		return nil
	})
	outcome := postgres.MemoryExtractOutcome{Status: "SUCCEEDED"}
	if callErr == nil {
		outcome.InputTokens = &result.Usage.InputTokens
		outcome.OutputTokens = &result.Usage.OutputTokens
		outcome.CachedInputTokens = result.Usage.CachedInputTokens
	} else {
		outcome.Status = "FAILED"
		if pe := companion.AsError(callErr); pe != nil {
			outcome.FailureCode = "OTHER"
			switch pe.Code {
			case companion.CodeRateLimited:
				outcome.FailureCode = "HTTP_429"
			case companion.CodeUpstreamUnavailable:
				outcome.FailureCode = "HTTP_5XX"
			case companion.CodeDisconnected:
				outcome.FailureCode = "DISCONNECTED"
			case companion.CodeTimeout:
				outcome.FailureCode = "TIMEOUT_" + string(pe.Phase)
			}
		}
	}
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer saveCancel()
	rows, saveErr := b.store.RecordMemoryExtractOutcome(saveCtx, op.scope.Owner, op.scope.Job, prep.AttemptID, outcome)
	if saveErr != nil {
		return Response{}, saveErr
	}
	if rows != 1 {
		return Response{}, ErrCapability
	}
	if callErr != nil {
		return Response{}, callErr
	}
	return Response{Text: out.String(), Usage: Usage{result.Usage.InputTokens, result.Usage.OutputTokens, result.Usage.TotalTokens}, FinishReason: result.Finish}, nil
}

// AdmissionError is a closed pre-model refusal from go_prepare_memorycore_call.
// It is not a missing operation token. Collapsing it into ErrCapability made
// every consent, source, or admission refusal look like a 4ms capability miss
// and burned the extract retry budget.
type AdmissionError struct{ Decision string }

func (e *AdmissionError) Error() string { return "memorycore admission refused" }

func admissionError(prep postgres.MemoryExtractPreparation) error {
	decision := prep.Decision
	if prep.AttemptID <= 0 && (decision == "EXTRACTABLE" || decision == "RETRY_TIMEOUT" || decision == "") {
		decision = "LEGACY_REPLAY"
	}
	return &AdmissionError{Decision: decision}
}

func admissionCode(err error) string {
	var admission *AdmissionError
	if !errors.As(err, &admission) || admission == nil {
		return ""
	}
	switch admission.Decision {
	case "CLAIM_LOST", "AUTO_SAVE_OFF", "DELETION_IN_PROGRESS", "CONSENT_WITHDRAWN",
		"MESSAGE_TEXT_NOT_AUTHORIZED", "SOURCE_SUPPRESSED", "PROVIDER_NOT_ADMITTED", "LEGACY_REPLAY":
		return "MEMORYCORE_" + admission.Decision
	default:
		return "MEMORYCORE_CAPABILITY"
	}
}

// applySystemMessage keeps a real system role only when the profile declares
// it. UNKNOWN (including a missing key) is folded into the first user message
// so the instruction still reaches the model. UNSUPPORTED is refused.
func applySystemMessage(messages []companion.Message, capability string) ([]companion.Message, error) {
	system := false
	for _, m := range messages {
		if m.Role == companion.RoleSystem {
			system = true
			break
		}
	}
	if !system {
		return messages, nil
	}
	switch capability {
	case postgres.CapabilityDeclared, postgres.CapabilityVerified:
		return messages, nil
	case postgres.CapabilityUnsupported:
		return nil, ErrParameters
	default:
		return foldSystemIntoUser(messages), nil
	}
}

func foldSystemIntoUser(messages []companion.Message) []companion.Message {
	var systems []string
	rest := make([]companion.Message, 0, len(messages))
	for _, m := range messages {
		if m.Role == companion.RoleSystem {
			if m.Content != "" {
				systems = append(systems, m.Content)
			}
			continue
		}
		rest = append(rest, m)
	}
	if len(systems) == 0 {
		return rest
	}
	prefix := strings.Join(systems, "\n")
	for i, m := range rest {
		if m.Role != companion.RoleUser {
			continue
		}
		if m.Content == "" {
			rest[i].Content = prefix
		} else {
			rest[i].Content = prefix + "\n\n" + m.Content
		}
		return rest
	}
	return append([]companion.Message{{Role: companion.RoleUser, Content: prefix}}, rest...)
}

func route(p postgres.ResolvedPurpose) (modelprovider.Route, error) {
	r := modelprovider.Route{ProviderID: p.ProviderID, SupplierName: p.ProviderName, Protocol: p.Protocol, BaseURL: p.BaseURL, Credential: p.Credential, ModelID: p.Model.ModelID, MaxOutputTokens: min(4096, p.Model.MaxOutputTokens), UseProfileParams: true}
	if p.Model.GenerationParams != nil {
		r.Temperature = p.Model.GenerationParams.Temperature
		r.TopP = p.Model.GenerationParams.TopP
		r.ReasoningEffort = p.Model.GenerationParams.ReasoningEffort
	}
	for key, value := range map[string]*float64{"temperature": r.Temperature, "topP": r.TopP} {
		if value == nil {
			continue
		}
		capability := p.Model.Capabilities[key]
		if capability != postgres.CapabilityDeclared && capability != postgres.CapabilityVerified {
			return modelprovider.Route{}, ErrParameters
		}
	}
	if r.ReasoningEffort != nil {
		found := false
		for _, level := range p.Model.ReasoningLevels {
			if level == *r.ReasoningEffort {
				found = true
			}
		}
		if !found || p.Protocol == postgres.ProtocolAnthropic {
			return modelprovider.Route{}, ErrParameters
		}
	}
	if p.Protocol == postgres.ProtocolAnthropic && ((r.Temperature != nil && *r.Temperature > 1) || (r.Temperature != nil && r.TopP != nil)) {
		return modelprovider.Route{}, ErrParameters
	}
	return r, nil
}

// DecisionCode is the closed MEMORYCORE_* class for a callback failure.
// It never includes request text, provider bodies, or credentials.
func DecisionCode(err error) string {
	if err == nil {
		return ""
	}
	if code := admissionCode(err); code != "" {
		return code
	}
	switch {
	case errors.Is(err, ErrReplay), errors.Is(err, postgres.ErrConflict):
		return "MEMORYCORE_REPLAY"
	case errors.Is(err, ErrCredentialRevoked):
		return "MEMORYCORE_CREDENTIAL_REVOKED"
	case errors.Is(err, ErrPurposeDisabled):
		return "MEMORYCORE_PURPOSE_DISABLED"
	case errors.Is(err, ErrBudget), errors.Is(err, postgres.ErrRateLimited):
		return "MEMORYCORE_BUDGET_DENIED"
	case errors.Is(err, ErrParameters), companion.Is(err, companion.CodeInvalidRequest):
		return "MEMORYCORE_PARAMETERS"
	case errors.Is(err, context.DeadlineExceeded), companion.Is(err, companion.CodeTimeout):
		return "MEMORYCORE_UPSTREAM_TIMEOUT"
	case companion.Is(err, companion.CodeMalformed):
		return "MEMORYCORE_UPSTREAM_MALFORMED"
	case errors.Is(err, ErrCapability):
		return "MEMORYCORE_CAPABILITY"
	}
	var unavailable *postgres.PurposeUnavailableError
	if errors.As(err, &unavailable) {
		if unavailable.Reason == postgres.PurposeReasonCredential {
			return "MEMORYCORE_CREDENTIAL_REVOKED"
		}
		return "MEMORYCORE_PURPOSE_DISABLED"
	}
	return "MEMORYCORE_CALLBACK_FAILED"
}
