package jobs

import (
	"context"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"log/slog"
	"time"
)

type engineExtractStore interface {
	PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error)
	EngineCall(context.Context, string, any, any) error
	ValidateEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) ([]string, error)
	PublishEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) error
}

func (l *Loop) UseMemoryCore(b *memorycore.Broker) { l.memoryCore = b }
func (l *Loop) handleEngineExtract(ctx context.Context, c postgres.JobClaim) error {
	callCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	l.cancels.Register(KindSTMemoryExtract, c.OwnerID, c.JobID, cancel)
	defer func() { cancel(); l.cancels.Unregister(KindSTMemoryExtract, c.JobID) }()
	ctx = callCtx
	s, ok := l.store.(engineExtractStore)
	if !ok || l.memoryCore == nil {
		return l.failExtract(ctx, c, "MEMORYCORE_UNAVAILABLE")
	}
	op, err := s.PrepareEngineOperation(ctx, c)
	if err != nil {
		return l.failExtract(ctx, c, "MEMORYCORE_SOURCE")
	}
	if op.State == "PUBLISHED" {
		return l.buildEngineProfile(ctx, c, op)
	}
	request := map[string]any{"scope": op.Scope, "operationId": op.ID, "revision": op.Revision}
	var status struct {
		Status   string          `json:"status"`
		Proposal json.RawMessage `json:"proposal"`
	}
	// Every attempt checks durable engine state before any model call. A timeout
	// never changes the operation ID or replays the retired extraction payload.
	if err = s.EngineCall(ctx, "operation-status", request, &status); err != nil {
		return l.failExtract(ctx, c, "MEMORYCORE_STATUS")
	}
	proposal := status.Proposal
	switch status.Status {
	case "unknown":
		token, e := l.memoryCore.Open(ctx, memorycore.Scope{Owner: c.OwnerID, Job: c.JobID, Source: c.RefID, ClaimToken: c.Token, ClaimFence: c.Fence, OperationID: op.ID, ExpiresAt: time.Now().Add(5 * time.Minute)})
		if e != nil {
			return l.failExtract(ctx, c, "MEMORYCORE_CAPABILITY")
		}
		defer l.memoryCore.Revoke(token)
		input := map[string]any{"scope": op.Scope, "operationId": op.ID, "revision": op.Revision, "operationToken": token, "embedding": op.Embedding, "allowedRecordIds": op.Allowed,
			"messages": []map[string]any{{"id": op.SourceKey, "content": op.Input.UserContent, "role": "user", "timestamp": op.Timestamp.Format(time.RFC3339Nano)}}}
		if err = s.EngineCall(ctx, "propose", input, &proposal); err != nil {
			if e = s.EngineCall(ctx, "operation-status", request, &status); e != nil {
				return l.failExtract(ctx, c, "MEMORYCORE_STATUS")
			}
			proposal = status.Proposal
		}
	case "proposed", "publishing", "published":
	case "preparing":
		return l.failExtract(ctx, c, "MEMORYCORE_PENDING")
	default:
		if failed, ok := l.store.(interface {
			AbandonEngineOperation(context.Context, postgres.JobClaim) error
		}); ok {
			if e := failed.AbandonEngineOperation(ctx, c); e != nil {
				return l.failExtract(ctx, c, "MEMORYCORE_RECOVERY")
			}
		}
		return l.failExtract(ctx, c, "MEMORYCORE_REVOKED")
	}
	if len(proposal) == 0 {
		return l.failExtract(ctx, c, "MEMORYCORE_PENDING")
	}
	if _, err = s.ValidateEngineProposal(ctx, c, op, proposal); err != nil {
		if failed, ok := l.store.(interface {
			AbandonEngineOperation(context.Context, postgres.JobClaim) error
		}); ok {
			if e := failed.AbandonEngineOperation(ctx, c); e != nil {
				return l.failExtract(ctx, c, "MEMORYCORE_RECOVERY")
			}
		}
		return l.failExtract(ctx, c, "MEMORYCORE_VALIDATION")
	}
	if err = s.EngineCall(ctx, "commit", request, nil); err != nil {
		if e := s.EngineCall(ctx, "operation-status", request, &status); e != nil || status.Status != "published" {
			return l.failExtract(ctx, c, "MEMORYCORE_COMMIT")
		}
	}
	if err = s.PublishEngineProposal(ctx, c, op, proposal); err != nil {
		return l.failExtract(ctx, c, "MEMORYCORE_PUBLICATION")
	}
	op.Proposal = proposal
	return l.buildEngineProfile(ctx, c, op)
}

func (l *Loop) buildEngineProfile(ctx context.Context, c postgres.JobClaim, op postgres.EngineOperation) error {
	var proposal postgres.EngineProposal
	if len(op.Proposal) > 0 && json.Unmarshal(op.Proposal, &proposal) == nil && len(proposal.Records) == 0 && len(proposal.Targets) == 0 {
		return l.closeExtract(ctx, c, "DONE", "")
	}

	s, ok := l.store.(interface {
		BuildEngineProfile(context.Context, postgres.JobClaim, postgres.EngineOperation, string) error
	})
	if !ok {
		return l.closeExtract(ctx, c, "DONE", "")
	}
	token, e := l.memoryCore.Open(ctx, memorycore.Scope{Owner: c.OwnerID, Job: c.JobID, Source: c.RefID, ClaimToken: c.Token, ClaimFence: c.Fence, OperationID: op.ProfileOperationID, ExpiresAt: time.Now().Add(5 * time.Minute)})
	if e != nil {
		return l.failExtract(ctx, c, "MEMORYCORE_PROFILE_CAPABILITY")
	}
	defer l.memoryCore.Revoke(token)
	if e = s.BuildEngineProfile(ctx, c, op, token); e != nil {
		return l.failExtract(ctx, c, "MEMORYCORE_PROFILE")
	}
	return l.closeExtract(ctx, c, "DONE", "")
}

func (l *Loop) enqueueMemoryExtract(ctx context.Context, owner, generationID int64) {
	// Retired: ST persisted sources are the only production extraction input.
}

func (l *Loop) failExtract(ctx context.Context, c postgres.JobClaim, code string) error {
	action, err := l.store.RetryMemoryExtract(ctx, c.OwnerID, c.JobID, c.Token, c.Fence)
	if err == nil {
		l.log.Info("memory extract retry",
			slog.String("operation", "memory_extract"),
			slog.String("outcome", "requeued"),
			slog.String("event_type", action),
			slog.String("decision_code", code),
		)
		return nil
	}
	if err := l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, "FAILED", code); err != nil {
		// The bounded retry and the explicit close both failed: the swallowed
		// commit error must stay observable (audit L3), the claim then ages
		// out through lease-expiry recovery.
		l.log.Info("memory extract retry",
			slog.String("operation", "memory_extract_retry"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXTRACT_CLOSE_FAILED"),
		)
	}
	return nil
}

func (l *Loop) closeExtract(ctx context.Context, c postgres.JobClaim, status, reason string) error {
	if err := l.store.CompleteJob(ctx, c.OwnerID, c.JobID, c.Token, c.Fence, status, reason); err != nil {
		l.log.Info("memory extract close",
			slog.String("operation", "memory_extract"),
			slog.String("outcome", "error"),
			slog.String("error_code", "EXTRACT_CLOSE_FAILED"),
		)
	}
	return nil
}
