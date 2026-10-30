package jobs

import (
	"context"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"log/slog"
	"strings"
	"time"
)

type engineExtractStore interface {
	PrepareEngineOperation(context.Context, postgres.JobClaim) (postgres.EngineOperation, error)
	EngineCall(context.Context, string, any, any) error
	ValidateEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) ([]string, error)
	PublishEngineProposal(context.Context, postgres.JobClaim, postgres.EngineOperation, json.RawMessage) error
}

func (l *Loop) UseMemoryCore(b *memorycore.Broker) { l.memoryCore = b }

// revisionRebinds is the number of times one claim may adopt a newer scope
// revision and submit a new engine operation. A still-running preparation is
// not one of those attempts.
const revisionRebinds = 2

func (l *Loop) handleEngineExtract(ctx context.Context, c postgres.JobClaim) error {
	callCtx, cancel := context.WithTimeout(ctx, memorycore.ExtractJob)
	l.cancels.Register(KindSTMemoryExtract, c.OwnerID, c.JobID, cancel)
	defer func() { cancel(); l.cancels.Unregister(KindSTMemoryExtract, c.JobID) }()
	ctx = callCtx
	s, ok := l.store.(engineExtractStore)
	if !ok || l.memoryCore == nil {
		return l.failExtract(ctx, c, "MEMORYCORE_UNAVAILABLE")
	}
	op, err := s.PrepareEngineOperation(ctx, c)
	if err != nil {
		// A forget rebuild is marked on a published job whose source may have
		// been suppressed. That source gate must not dead-letter the profile.
		next, matched, ferr := l.prepareForgetProfile(ctx, c)
		if !matched {
			return l.failExtract(ctx, c, "MEMORYCORE_SOURCE")
		}
		if ferr != nil {
			return l.failExtract(ctx, c, profileDecision(ferr))
		}
		op = next
	}
	if op.State == "PUBLISHED" {
		releaseExtractSlot(ctx)
		return l.buildEngineProfile(ctx, c, op)
	}
	var token string
	defer func() {
		if token != "" {
			l.memoryCore.Revoke(token)
		}
	}()
	for attempt := 0; attempt <= revisionRebinds; attempt++ {
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
		rebound := false
		switch status.Status {
		case "unknown", "failed":
			if token != "" {
				l.memoryCore.Revoke(token)
				token = ""
			}
			var e error
			token, e = l.memoryCore.Open(ctx, memorycore.Scope{Owner: c.OwnerID, Job: c.JobID, Source: c.RefID, ClaimToken: c.Token, ClaimFence: c.Fence, OperationID: op.ID, ExpiresAt: time.Now().Add(memorycore.ExtractOpen)})
			if e != nil {
				return l.failExtract(ctx, c, "MEMORYCORE_CAPABILITY")
			}
			input := map[string]any{"scope": op.Scope, "operationId": op.ID, "revision": op.Revision, "operationToken": token, "embedding": op.Embedding, "allowedRecordIds": op.Allowed,
				"messages": []map[string]any{{"id": op.SourceKey, "content": op.Input.UserContent, "role": "user", "timestamp": op.Timestamp.Format(time.RFC3339Nano)}}}
			if err = s.EngineCall(ctx, "propose", input, &proposal); err != nil {
				if code := memoryengine.ClosedCode(err); code != "" {
					if status, ok := admissionOutcome(code); ok {
						return l.closeAdmission(ctx, c, status, code)
					}
				}
				if memoryengine.ClosedCode(err) == "MEMORYCORE_REVISION_CONFLICT" {
					if attempt == revisionRebinds {
						return l.failExtract(ctx, c, "MEMORYCORE_REVISION_CONFLICT")
					}
					next, re := l.rebindEngineOperation(ctx, c, op)
					if re != nil {
						return l.failExtract(ctx, c, "MEMORYCORE_REVISION_CONFLICT")
					}
					op = next
					rebound = true
					break
				}
				// A finished propose already returned an engine code. Reading the
				// empty failed operation and labeling it PENDING hides that code.
				if code := memoryengine.ClosedCode(err); code != "" {
					return l.finishExtract(ctx, c, code)
				}
				if e = s.EngineCall(ctx, "operation-status", request, &status); e != nil {
					return l.failExtract(ctx, c, "MEMORYCORE_STATUS")
				}
				if status.Status == "preparing" {
					return l.failExtract(ctx, c, "MEMORYCORE_PENDING")
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
		if rebound {
			continue
		}
		if len(proposal) == 0 {
			code := "MEMORYCORE_OPERATION_FAILED"
			if status.Status == "preparing" {
				code = "MEMORYCORE_PENDING"
			}
			return l.failExtract(ctx, c, code)
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
		op.State = "PUBLISHED"
		releaseExtractSlot(ctx)
		return l.buildEngineProfile(ctx, c, op)
	}
	return l.failExtract(ctx, c, "MEMORYCORE_REVISION_CONFLICT")
}

func (l *Loop) buildEngineProfile(ctx context.Context, c postgres.JobClaim, op postgres.EngineOperation) error {
	var proposal postgres.EngineProposal
	// An empty extract proposal means there is nothing to publish. A forget
	// rebuild still has to read the current allowlist; its proposal belongs to
	// the job that was reused as a marker.
	if !postgres.IsForgetProfile(op.ProfileOperationID) && len(op.Proposal) > 0 && json.Unmarshal(op.Proposal, &proposal) == nil && len(proposal.Records) == 0 && len(proposal.Targets) == 0 {
		code := emptyExtractDecision(proposal.EmptyDisposition)
		logger := l.log
		if logger == nil {
			logger = slog.Default()
		}
		logger.Info("memory extract published empty", "decision_code", code)
		if rec, ok := l.store.(interface {
			RecordEmptyExtractDecision(context.Context, int64, int64, string) error
		}); ok {
			if e := rec.RecordEmptyExtractDecision(ctx, c.OwnerID, c.JobID, code); e != nil {
				return l.failExtract(ctx, c, "MEMORYCORE_EMPTY_DECISION")
			}
		}
		return l.closeExtract(ctx, c, "DONE", "")
	}

	s, ok := l.store.(interface {
		BuildEngineProfile(context.Context, postgres.JobClaim, postgres.EngineOperation, string) error
	})
	if !ok {
		return l.closeExtract(ctx, c, "DONE", "")
	}
	var token string
	defer func() {
		if token != "" {
			l.memoryCore.Revoke(token)
		}
	}()
	for attempt := 0; attempt < 2; attempt++ {
		if token != "" {
			l.memoryCore.Revoke(token)
			token = ""
		}
		if op.ProfileOperationID == "" {
			op.ProfileOperationID = op.ID + "-profile"
		}
		var e error
		token, e = l.memoryCore.Open(ctx, memorycore.Scope{Owner: c.OwnerID, Job: c.JobID, Source: c.RefID, ClaimToken: c.Token, ClaimFence: c.Fence, OperationID: op.ProfileOperationID, ExpiresAt: time.Now().Add(memorycore.ExtractOpen)})
		if e != nil {
			return l.failExtract(ctx, c, "MEMORYCORE_PROFILE_CAPABILITY")
		}
		if e = s.BuildEngineProfile(ctx, c, op, token); e != nil {
			if memoryengine.ClosedCode(e) == "MEMORYCORE_REVISION_CONFLICT" && attempt == 0 {
				next, re := l.rebindEngineOperation(ctx, c, op)
				if re == nil {
					op = next
					continue
				}
			}
			return l.failExtract(ctx, c, profileDecision(e))
		}
		return l.closeExtract(ctx, c, "DONE", "")
	}
	return l.failExtract(ctx, c, "MEMORYCORE_REVISION_CONFLICT")
}

func admissionOutcome(code string) (string, bool) {
	switch code {
	case "MEMORYCORE_CLAIM_LOST", "MEMORYCORE_LEGACY_REPLAY":
		return "FAILED", true
	case "MEMORYCORE_AUTO_SAVE_OFF", "MEMORYCORE_DELETION_IN_PROGRESS", "MEMORYCORE_CONSENT_WITHDRAWN",
		"MEMORYCORE_MESSAGE_TEXT_NOT_AUTHORIZED", "MEMORYCORE_SOURCE_SUPPRESSED", "MEMORYCORE_PROVIDER_NOT_ADMITTED":
		return "DONE", true
	default:
		return "", false
	}
}

func (l *Loop) closeAdmission(ctx context.Context, c postgres.JobClaim, status, code string) error {
	logger := l.log
	if logger == nil {
		logger = slog.Default()
	}
	logger.Info("memory extract closed",
		slog.String("operation", "memory_extract"),
		slog.String("outcome", "closed"),
		slog.String("event_type", status),
		slog.String("decision_code", code),
	)
	return l.closeExtract(ctx, c, status, code)
}

func emptyExtractDecision(disposition string) string {
	switch disposition {
	case "NO_NEW_FACT":
		return "MEMORYCORE_EMPTY_NO_NEW_FACT"
	case "DEDUP_MERGED":
		return "MEMORYCORE_EMPTY_DEDUP_MERGED"
	case "DROPPED_GATE":
		return "MEMORYCORE_EMPTY_DROPPED_GATE"
	default:
		return "MEMORYCORE_EMPTY_DROPPED_GATE"
	}
}

func profileDecision(err error) string {
	code := memoryengine.ClosedCode(err)
	if code == "" {
		return "MEMORYCORE_PROFILE"
	}
	return code
}

func (l *Loop) prepareForgetProfile(ctx context.Context, c postgres.JobClaim) (postgres.EngineOperation, bool, error) {
	s, ok := l.store.(interface {
		PrepareForgetProfile(context.Context, postgres.JobClaim) (postgres.EngineOperation, bool, error)
	})
	if !ok {
		return postgres.EngineOperation{}, false, nil
	}
	return s.PrepareForgetProfile(ctx, c)
}

func (l *Loop) rebindEngineOperation(ctx context.Context, c postgres.JobClaim, op postgres.EngineOperation) (postgres.EngineOperation, error) {
	s, ok := l.store.(interface {
		RebindEngineOperation(context.Context, postgres.JobClaim, postgres.EngineOperation) (postgres.EngineOperation, error)
	})
	if !ok {
		return postgres.EngineOperation{}, postgres.ErrConflict
	}
	return s.RebindEngineOperation(ctx, c, op)
}

func (l *Loop) enqueueMemoryExtract(ctx context.Context, owner, generationID int64) {
	// Retired: ST persisted sources are the only production extraction input.
}

func deterministicExtractCode(code string) bool {
	if strings.HasPrefix(code, "MEMORYCORE_ENGINE_") {
		return true
	}
	switch code {
	case "MEMORYCORE_OPERATION_CONFLICT", "MEMORYCORE_TARGET_NOT_ALLOWED", "MEMORYCORE_RECORD_ID":
		return true
	default:
		return false
	}
}

// finishExtract records a closed propose code. A deterministic engine or
// request error is terminal: retrying would replay the same journaled model
// output and dead-letter. Timeouts and unknown transport failures still retry.
func (l *Loop) finishExtract(ctx context.Context, c postgres.JobClaim, code string) error {
	if !deterministicExtractCode(code) {
		return l.failExtract(ctx, c, code)
	}
	l.log.Info("memory extract closed",
		slog.String("operation", "memory_extract"),
		slog.String("outcome", "failed"),
		slog.String("event_type", "FAILED"),
		slog.String("decision_code", code),
	)
	return l.closeExtract(ctx, c, "FAILED", code)
}

func (l *Loop) failExtract(ctx context.Context, c postgres.JobClaim, code string) error {
	action, err := l.store.RetryMemoryExtract(ctx, c.OwnerID, c.JobID, c.Token, c.Fence)
	if err == nil {
		outcome := "requeued"
		if action == "DEAD_LETTERED" {
			outcome = "dead_lettered"
		}
		l.log.Info("memory extract retry",
			slog.String("operation", "memory_extract"),
			slog.String("outcome", outcome),
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
