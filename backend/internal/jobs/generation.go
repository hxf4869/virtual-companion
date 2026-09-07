package jobs

import (
	"context"
	"log/slog"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/turn"
)

func (l *Loop) handleGeneration(ctx context.Context, c postgres.JobClaim, runID string) error {
	if l.store == nil {
		return postgres.ErrInvalid
	}
	status, err := l.store.PromoteClaimedGeneration(ctx, c.OwnerID, c.RefID, c.JobID, c.Token, c.Fence)
	if err != nil {
		return err
	}
	if status == "COMPLETED" || status == "CANCELLED" || status == "FAILED_FINAL" ||
		status == "INPUT_BLOCKED" || status == "OUTPUT_BLOCKED" || status == "COMPLETED_FALLBACK" {
		return nil
	}

	callCtx, cancel := context.WithCancel(ctx)
	l.cancels.Register(KindGeneration, c.OwnerID, c.RefID, cancel)
	defer func() {
		cancel()
		l.cancels.Unregister(KindGeneration, c.RefID)
	}()

	gate, err := l.store.OutboundCheck(ctx, c.OwnerID)
	if err != nil {
		return l.terminal(ctx, c, companion.PhaseFailed, "OUTBOUND_CHECK")
	}
	if !gate.Allow {
		return l.terminal(ctx, c, companion.PhaseBlocked, gate.Code)
	}

	budget := l.budget
	if budget.MaxAttempts < 1 {
		budget.MaxAttempts = 1
	}
	routes, err := l.resolveGenerationRoutes(ctx)
	if err != nil {
		l.log.Error("provider route read failed",
			slog.String("operation", "provider_route_read"),
			slog.String("outcome", "error"),
			slog.String("error_code", "PROVIDER_CONFIG_UNAVAILABLE"),
		)
		return l.terminal(ctx, c, companion.PhaseFailed, "PROVIDER_CONFIG_UNAVAILABLE")
	}
	cmd := turn.Command{
		TurnID:                  fmtInt(c.RefID),
		RunID:                   runID,
		Budget:                  budget,
		OwnerID:                 c.OwnerID,
		JobID:                   c.JobID,
		ClaimToken:              c.Token,
		ClaimFence:              c.Fence,
		ProviderID:              l.policy.ProviderID,
		SupplierName:            l.policy.SupplierName,
		ModelID:                 l.policy.ModelID,
		ConsentVersion:          gate.Code,
		ProviderContractVersion: "go-v1",
	}

	var last turn.Result
	attemptLimit := budget.MaxAttempts
	if len(routes) > 0 && len(routes) < attemptLimit {
		attemptLimit = len(routes)
	}
	for attempt := 1; attempt <= attemptLimit; attempt++ {
		cmd.AttemptNo = attempt
		current := l.provider
		dynamic := false
		if len(routes) > 0 {
			route := routes[attempt-1]
			if l.providerFactory == nil {
				return l.terminal(ctx, c, companion.PhaseFailed, "PROVIDER_CONFIG_UNAVAILABLE")
			}
			current, err = l.providerFactory(modelprovider.Route{
				ProviderID: route.ProviderID, SupplierName: route.SupplierName,
				Protocol: route.Protocol, BaseURL: route.BaseURL,
				Credential: route.Credential, ModelID: route.ModelID,
				MaxOutputTokens: route.MaxOutputTokens, Priority: route.Priority,
			})
			if err != nil {
				l.log.Error("provider route invalid",
					slog.String("operation", "provider_route_build"),
					slog.String("outcome", "error"),
					slog.String("error_code", "PROVIDER_CONFIG_INVALID"),
				)
				return l.terminal(ctx, c, companion.PhaseFailed, "PROVIDER_CONFIG_INVALID")
			}
			dynamic = true
			cmd.ProviderID = route.ProviderID
			cmd.SupplierName = route.SupplierName
			cmd.ModelID = route.ModelID
			cmd.ProviderContractVersion = "go-v1-" + route.Protocol
		}
		if current == nil {
			return l.terminal(ctx, c, companion.PhaseFailed, "PROVIDER_DISABLED")
		}
		coord := &turn.Coordinator{
			Store: l.store, Provider: current, Policy: safety.New(),
			Log: l.log, Hub: l.hub,
		}
		last = coord.Run(callCtx, cmd)
		if dynamic {
			if closer, ok := current.(interface{ Close() }); ok {
				closer.Close()
			}
		}
		if last.PersistRetry {
			return l.retryFinalize(ctx, c, last)
		}
		if !last.RetryAllowed {
			break
		}
		l.log.Info("generation retry",
			slog.String("operation", "generation_retry"),
			slog.String("outcome", "ok"),
			slog.String("run_id", runID),
		)
	}
	if last.PersistRetry {
		return l.retryFinalize(ctx, c, last)
	}
	if last.RetryAllowed {
		return l.terminalAttempt(ctx, c, last)
	}
	if last.Phase == companion.PhaseCompleted {
		// Fire-and-forget trigger: extraction enqueue failures must never
		// affect the completed chat reply.
		l.enqueueMemoryExtract(ctx, c.OwnerID, c.RefID)
	}
	return nil
}

type routeStore interface {
	ResolveProviderRoutes(ctx context.Context) ([]postgres.ProviderRoute, error)
}

func (l *Loop) resolveGenerationRoutes(ctx context.Context) ([]postgres.ProviderRoute, error) {
	store, ok := l.store.(routeStore)
	if !ok {
		return nil, nil
	}
	return store.ResolveProviderRoutes(ctx)
}

func (l *Loop) retryFinalize(ctx context.Context, c postgres.JobClaim, last turn.Result) error {
	if last.Text == "" || last.Attempt.AttemptID == "" {
		return l.terminal(ctx, c, companion.PhaseFailed, "FINALIZE_FAILED")
	}
	var err error
	for i := 0; i < 3; i++ {
		err = l.store.FinalizeGeneration(ctx, turn.FinalizeCommand{
			OwnerID:    c.OwnerID,
			TurnID:     fmtInt(c.RefID),
			AttemptID:  last.Attempt.AttemptID,
			JobID:      c.JobID,
			ClaimToken: c.Token,
			ClaimFence: c.Fence,
			Text:       last.Text,
		})
		if err == nil {
			l.publishTerminal(fmtInt(c.RefID), companion.EventCompleted)
			l.enqueueMemoryExtract(ctx, c.OwnerID, c.RefID)
			return nil
		}
	}
	status, termErr := l.store.TerminalizeGeneration(ctx, turn.TerminalCommand{
		OwnerID: c.OwnerID, TurnID: fmtInt(c.RefID), AttemptID: last.Attempt.AttemptID,
		JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		Phase: companion.PhaseFailed, Reason: "FINALIZE_FAILED",
	})
	if termErr != nil {
		// The failed terminal state is unconfirmed; broadcast only when the
		// snapshot already shows it, otherwise recovery owns the outcome.
		l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, companion.PhaseFailed))
		return err
	}
	if ev := persistedTerminalEvent(status); ev != "" {
		l.publishTerminal(fmtInt(c.RefID), ev)
	} else {
		l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, companion.PhaseFailed))
	}
	return err
}

// persistedTerminalEvent maps the durable terminal status actually stored (the
// value returned by TerminalizeGeneration) to its public hub event. When a
// concurrent path won the race this is the winner's status, so the broadcast
// always matches the persisted state. An empty result means no terminal status
// was confirmed by the persist call and callers reconcile via the snapshot.
func persistedTerminalEvent(status string) companion.PublicEvent {
	switch status {
	case "CANCELLED":
		return companion.EventCancelled
	case "INPUT_BLOCKED", "OUTPUT_BLOCKED":
		return companion.EventBlocked
	case "FAILED_FINAL":
		return companion.EventFailed
	}
	return ""
}


// publishTerminal fans a confirmed terminal event out to the hub. An empty
// event means the terminal state is unconfirmed and nothing is published.
func (l *Loop) publishTerminal(turnID string, ev companion.PublicEvent) {
	if l.hub == nil || ev == "" {
		return
	}
	switch ev {
	case companion.EventCancelled:
		l.hub.Cancelled(turnID)
	case companion.EventBlocked:
		l.hub.Blocked(turnID)
	case companion.EventCompleted:
		l.hub.Completed(turnID)
	default:
		l.hub.Failed(turnID)
	}
}

// snapshotTerminalEvent reports the public event for a durable snapshot status,
// but only when the snapshot already shows the terminal phase the caller tried
// to persist. Any other durable state (non-terminal, or a different terminal
// won by a concurrent path) yields "" so no event is published here.
func snapshotTerminalEvent(status string, phase companion.Phase) companion.PublicEvent {
	switch {
	case phase == companion.PhaseFailed && status == "FAILED_FINAL":
		return companion.EventFailed
	case phase == companion.PhaseBlocked && (status == "INPUT_BLOCKED" || status == "OUTPUT_BLOCKED"):
		return companion.EventBlocked
	case phase == companion.PhaseCancelled && status == "CANCELLED":
		return companion.EventCancelled
	}
	return ""
}

// confirmedTerminal reads the authoritative snapshot after a failed persist and
// returns the event to publish, or "" when the terminal state is unconfirmed
// and the existing recovery path stays responsible for the outcome.
func (l *Loop) confirmedTerminal(ctx context.Context, c postgres.JobClaim, phase companion.Phase) companion.PublicEvent {
	snap, err := l.store.GenerationSnapshot(ctx, c.OwnerID, c.RefID)
	if err != nil {
		return ""
	}
	return snapshotTerminalEvent(snap.Status, phase)
}

func (l *Loop) terminal(ctx context.Context, c postgres.JobClaim, phase companion.Phase, reason string) error {
	status, err := l.store.TerminalizeGeneration(ctx, turn.TerminalCommand{
		OwnerID: c.OwnerID, TurnID: fmtInt(c.RefID),
		JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		Phase: phase, Reason: reason,
	})
	if err != nil {
		l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, phase))
		return err
	}
	if ev := persistedTerminalEvent(status); ev != "" {
		l.publishTerminal(fmtInt(c.RefID), ev)
		return nil
	}
	// Persist succeeded but confirmed no terminal status; reconcile against
	// the snapshot so a state won by a concurrent path still reaches the hub.
	l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, phase))
	return nil
}

func (l *Loop) terminalAttempt(ctx context.Context, c postgres.JobClaim, last turn.Result) error {
	status, err := l.store.TerminalizeGeneration(ctx, turn.TerminalCommand{
		OwnerID: c.OwnerID, TurnID: fmtInt(c.RefID), AttemptID: last.Attempt.AttemptID,
		JobID: c.JobID, ClaimToken: c.Token, ClaimFence: c.Fence,
		Phase: last.Phase, Reason: last.SafetyCode,
	})
	if err != nil {
		l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, last.Phase))
		return err
	}
	if ev := persistedTerminalEvent(status); ev != "" {
		l.publishTerminal(fmtInt(c.RefID), ev)
		return nil
	}
	l.publishTerminal(fmtInt(c.RefID), l.confirmedTerminal(ctx, c, last.Phase))
	return nil
}
