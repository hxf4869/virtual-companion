package turn

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/safety"
)

// Coordinator runs one Companion Turn. Hub is the concrete RealtimeHub;
// nil is allowed so G5 unit tests stay hub-free.
type Coordinator struct {
	Store    Store
	Provider companion.Provider
	Policy   *safety.Policy
	Log      *slog.Logger
	Hub      *realtime.Hub
}

// Command starts one turn that already has a seed in Store.
type Command struct {
	TurnID                  string
	RunID                   string
	Budget                  companion.TurnBudget
	OwnerID                 int64
	JobID                   int64
	ClaimToken              string
	ClaimFence              string
	ProviderID              string
	SupplierName            string
	ModelID                 string
	ConsentVersion          string
	ProviderContractVersion string
	ReservedCost            int64
	MonthlyCostLimit        int64
	AttemptNo               int
}

// Result is the process-local turn outcome. Blocked/failed/cancelled never
// carry persistable assistant text.
type Result struct {
	Phase        companion.Phase
	Public       companion.PublicEvent
	Published    []string
	Withdraw     bool
	Text         string
	SafetyCode   string
	Attempt      companion.AttemptOutcome
	Trace        BuildTrace
	RetryAllowed bool
	PersistRetry bool
}

func (c *Coordinator) logger() *slog.Logger {
	if c != nil && c.Log != nil {
		return c.Log
	}
	return slog.New(slog.DiscardHandler)
}

// Run executes intake-prepare-stream-finalize without a hub or DB session
// held across the provider call.
func (c *Coordinator) Run(ctx context.Context, cmd Command) Result {
	if ctx == nil {
		ctx = context.Background()
	}
	log := c.logger()
	policy := c.Policy
	if policy == nil {
		policy = safety.New()
	}

	seed, err := c.Store.LoadSeed(ctx, TurnKey{OwnerID: cmd.OwnerID, TurnID: cmd.TurnID})
	if err != nil {
		return c.fail(ctx, cmd, "", companion.PhaseFailed, "SEED_MISSING", nil, BuildTrace{})
	}
	c.hubAccepted(cmd.TurnID)

	in := policy.ReviewInput(seed.CurrentUserMessage)
	if !in.Allow {
		_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
			OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, JobID: cmd.JobID,
			ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
			Phase: companion.PhaseBlocked, Reason: in.Code(),
		})
		c.hubTerminal(cmd.TurnID, companion.EventBlocked)
		log.Info("turn blocked",
			slog.String("operation", "input_review"),
			slog.String("outcome", "blocked"),
			slog.String("event_type", "safety"),
			slog.String("decision_code", in.Code()),
			slog.String("run_id", cmd.RunID),
		)
		return Result{
			Phase:      companion.PhaseBlocked,
			Public:     companion.EventBlocked,
			SafetyCode: in.Code(),
			Withdraw:   true,
		}
	}

	plan := Build(seed, cmd.Budget)
	logContext(log, cmd.RunID, plan.Trace)
	if plan.Blocked {
		phase := companion.PhaseFailed
		pub := companion.EventFailed
		if plan.Reason == DropCategoryDenied {
			phase = companion.PhaseBlocked
			pub = companion.EventBlocked
		}
		_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
			OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, JobID: cmd.JobID,
			ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
			Phase: phase, Reason: string(plan.Reason),
		})
		c.hubTerminal(cmd.TurnID, pub)
		return Result{Phase: phase, Public: pub, Trace: plan.Trace, SafetyCode: string(plan.Reason), Withdraw: true}
	}

	prep, err := c.Store.PrepareAttempt(ctx, PrepareAttempt{
		OwnerID:                 cmd.OwnerID,
		TurnID:                  cmd.TurnID,
		JobID:                   cmd.JobID,
		ClaimToken:              cmd.ClaimToken,
		ClaimFence:              cmd.ClaimFence,
		Budget:                  cmd.Budget,
		Categories:              plan.Trace.EffectiveCategories,
		PromptVersion:           plan.Trace.PromptVersion,
		PersonaVersion:          plan.Trace.PersonaVersion,
		ConfigVersion:           plan.Trace.ConfigVersion,
		ConsentVersion:          cmd.ConsentVersion,
		ProviderContractVersion: cmd.ProviderContractVersion,
		ProviderID:              cmd.ProviderID,
		SupplierName:            cmd.SupplierName,
		ModelID:                 cmd.ModelID,
		EstimatedTokens:         plan.Trace.EstimatedTokens,
		ReservedCost:            cmd.ReservedCost,
		MonthlyCostLimit:        cmd.MonthlyCostLimit,
	})
	if err != nil {
		if errors.Is(err, ErrOutboundDenied) {
			_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
				OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, JobID: cmd.JobID,
				ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
				Phase: companion.PhaseBlocked, Reason: "OUTBOUND_DENIED",
			})
			c.hubTerminal(cmd.TurnID, companion.EventBlocked)
			return Result{
				Phase: companion.PhaseBlocked, Public: companion.EventBlocked,
				SafetyCode: "OUTBOUND_DENIED", Withdraw: true, Trace: plan.Trace,
			}
		}
		return c.fail(ctx, cmd, "", companion.PhaseFailed, "PREPARE_FAILED", nil, plan.Trace)
	}

	if ctx.Err() != nil {
		_ = c.Store.RecordAttemptOutcome(ctx, companion.AttemptOutcome{
			OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, AttemptID: prep.AttemptID,
			JobID: cmd.JobID, ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
			Status: companion.AttemptCancelled, Failure: string(companion.CodeCanceled),
			Delivery: companion.DeliveryNotSent, Billing: companion.BillingNotSent, Budget: prep.Budget,
		})
		_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
			OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, AttemptID: prep.AttemptID,
			JobID: cmd.JobID, ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
			Phase: companion.PhaseCancelled, Reason: string(companion.CodeCanceled),
		})
		c.hubTerminal(cmd.TurnID, companion.EventCancelled)
		return Result{
			Phase: companion.PhaseCancelled, Public: companion.EventCancelled,
			Withdraw: true, Trace: plan.Trace,
		}
	}

	guard := companion.OutputGuard{
		WindowRunes: policy.WindowRunes(),
		Review: func(window string) companion.Review {
			d := policy.ReviewOutput(window)
			return companion.Review{Allow: d.Allow, Risk: string(d.Risk), Rules: d.Rules}
		},
	}
	var published []string
	stream := companion.StreamAttempt(ctx, companion.StreamInput{
		Provider: c.Provider,
		Request: companion.ModelRequest{
			Messages: plan.Messages,
			Stream:   true,
		},
		Budget: prep.Budget,
		Guard:  guard,
		Emit: func(d companion.OutputDelta) error {
			published = append(published, d.Text)
			c.hubAppend(cmd.TurnID, d.Text)
			return nil
		},
	})

	outcome := companion.AttemptOutcome{
		OwnerID:    cmd.OwnerID,
		TurnID:     cmd.TurnID,
		AttemptID:  prep.AttemptID,
		JobID:      cmd.JobID,
		ClaimToken: cmd.ClaimToken,
		ClaimFence: cmd.ClaimFence,
		Status:     stream.Status,
		Failure:    stream.Failure,
		Delivery:   stream.Delivery,
		Billing:    stream.Billing,
		Finish:     stream.Finish,
		Usage:      stream.Usage,
		Budget:     prep.Budget,
		Categories: categoryStrings(plan.Trace.EffectiveCategories),
	}
	if recErr := c.Store.RecordAttemptOutcome(ctx, outcome); recErr != nil {
		return c.fail(ctx, cmd, prep.AttemptID, companion.PhaseFailed, "OUTCOME_WRITE", &outcome, plan.Trace)
	}

	attemptNo := cmd.AttemptNo
	if attemptNo < 1 {
		attemptNo = 1
	}
	retry := len(stream.Published) == 0 &&
		companion.AllowNewAttempt(prep.Budget, attemptNo, stream.Status, stream.ProviderErr)

	if stream.Withdraw || !stream.Persistable || !stream.Safety.Allow {
		phase := companion.PhaseBlocked
		pub := companion.EventBlocked
		reason := stream.Safety.Code()
		if stream.Status == companion.AttemptCancelled && ctx.Err() != nil {
			phase = companion.PhaseCancelled
			pub = companion.EventCancelled
			reason = string(companion.CodeCanceled)
		} else if !stream.Safety.Allow && len(stream.Safety.Rules) > 0 {
			phase = companion.PhaseBlocked
			pub = companion.EventBlocked
			reason = stream.Safety.Code()
		} else if stream.ProviderErr != nil || stream.Status == companion.AttemptFailed ||
			stream.Status == companion.AttemptTimedOut || stream.Status == companion.AttemptOutcomeUnknown {
			phase = companion.PhaseFailed
			pub = companion.EventFailed
			reason = stream.Failure
			if stream.Status == companion.AttemptCancelled {
				phase = companion.PhaseCancelled
				pub = companion.EventCancelled
			}
		}
		if reason == "" {
			reason = stream.Failure
		}
		if retry {
			return Result{
				Phase:        phase,
				Public:       pub,
				Published:    published,
				Withdraw:     true,
				SafetyCode:   reason,
				Attempt:      outcome,
				Trace:        plan.Trace,
				RetryAllowed: true,
			}
		}
		_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
			OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, AttemptID: prep.AttemptID,
			JobID: cmd.JobID, ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
			Phase: phase, Reason: reason,
		})
		c.hubTerminal(cmd.TurnID, pub)
		log.Info("turn terminal",
			slog.String("operation", "finalize"),
			slog.String("outcome", string(phase)),
			slog.String("event_type", string(pub)),
			slog.String("decision_code", reason),
			slog.String("run_id", cmd.RunID),
		)
		return Result{
			Phase:        phase,
			Public:       pub,
			Published:    published,
			Withdraw:     true,
			SafetyCode:   reason,
			Attempt:      outcome,
			Trace:        plan.Trace,
			RetryAllowed: retry,
		}
	}

	if err := c.Store.FinalizeGeneration(ctx, FinalizeCommand{
		OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, AttemptID: prep.AttemptID,
		JobID: cmd.JobID, ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
		Text: stream.Text,
	}); err != nil {
		return Result{
			Phase:        companion.PhaseFailed,
			Public:       companion.EventFailed,
			Published:    published,
			Text:         stream.Text,
			SafetyCode:   "FINALIZE_FAILED",
			Attempt:      outcome,
			Trace:        plan.Trace,
			PersistRetry: true,
		}
	}
	c.hubTerminal(cmd.TurnID, companion.EventCompleted)
	log.Info("turn completed",
		slog.String("operation", "finalize"),
		slog.String("outcome", "completed"),
		slog.String("event_type", string(companion.EventCompleted)),
		slog.Int("delta_count", len(published)),
		slog.Int("estimated_tokens", plan.Trace.EstimatedTokens),
		slog.String("run_id", cmd.RunID),
	)
	return Result{
		Phase:     companion.PhaseCompleted,
		Public:    companion.EventCompleted,
		Published: published,
		Text:      stream.Text,
		Attempt:   outcome,
		Trace:     plan.Trace,
	}
}

func (c *Coordinator) fail(ctx context.Context, cmd Command, attemptID string, phase companion.Phase, reason string, outcome *companion.AttemptOutcome, trace BuildTrace) Result {
	_ = c.Store.TerminalizeGeneration(ctx, TerminalCommand{
		OwnerID: cmd.OwnerID, TurnID: cmd.TurnID, AttemptID: attemptID,
		JobID: cmd.JobID, ClaimToken: cmd.ClaimToken, ClaimFence: cmd.ClaimFence,
		Phase: phase, Reason: reason,
	})
	c.hubTerminal(cmd.TurnID, companion.EventFailed)
	res := Result{Phase: phase, Public: companion.EventFailed, Withdraw: true, SafetyCode: reason, Trace: trace}
	if outcome != nil {
		res.Attempt = *outcome
	}
	return res
}

func (c *Coordinator) hubAccepted(id string) {
	if c != nil && c.Hub != nil {
		c.Hub.Accepted(id)
	}
}

func (c *Coordinator) hubAppend(id, text string) {
	if c != nil && c.Hub != nil {
		c.Hub.Append(id, text)
	}
}

func (c *Coordinator) hubTerminal(id string, ev companion.PublicEvent) {
	if c == nil || c.Hub == nil {
		return
	}
	switch ev {
	case companion.EventCompleted:
		c.Hub.Completed(id)
	case companion.EventBlocked:
		c.Hub.Blocked(id)
	case companion.EventCancelled:
		c.Hub.Cancelled(id)
	default:
		c.Hub.Failed(id)
	}
}

func logContext(log *slog.Logger, runID string, tr BuildTrace) {
	cats := make([]string, len(tr.EffectiveCategories))
	for i, c := range tr.EffectiveCategories {
		cats[i] = string(c)
	}
	reasons := make([]string, 0, len(tr.Drops))
	for _, d := range tr.Drops {
		reasons = append(reasons, string(d.Reason))
	}
	log.Info("context planned",
		slog.String("operation", "context_build"),
		slog.String("outcome", "ok"),
		slog.String("event_type", "context"),
		slog.String("prompt_version", tr.PromptVersion),
		slog.String("persona_version", tr.PersonaVersion),
		slog.String("config_version", tr.ConfigVersion),
		slog.Int("history_blocks", tr.HistoryBlocks),
		slog.Int("memory_blocks", tr.MemoryBlocks),
		slog.Int("estimated_tokens", tr.EstimatedTokens),
		slog.String("effective_categories", strings.Join(cats, ",")),
		slog.String("drop_reason_codes", strings.Join(reasons, ",")),
		slog.String("run_id", runID),
	)
}

// MapPublicTerminal is the OutputDelta/outcome → Public SSE name mapping.
// G6 attaches the hub; this function must not emit completed after a safety fail.
func MapPublicTerminal(phase companion.Phase, persistable bool) companion.PublicEvent {
	if persistable && phase == companion.PhaseCompleted {
		return companion.EventCompleted
	}
	switch phase {
	case companion.PhaseBlocked:
		return companion.EventBlocked
	case companion.PhaseCancelled:
		return companion.EventCancelled
	default:
		return companion.EventFailed
	}
}
