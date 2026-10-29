package httpapi

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"log/slog"
	"net/http"
)

type stMemoryStore interface {
	RecallSTMemory(context.Context, int64, postgres.STMemoryRequest) (postgres.STMemoryResult, error)
}

func (s *Server) handleSTMemoryRecall(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var in postgres.STMemoryRequest
	if !s.decodeJSON(w, r, &in) {
		return
	}
	store, ok := s.core.Store.(stMemoryStore)
	if !ok {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "ST memory is unavailable")
		return
	}
	out, err := store.RecallSTMemory(r.Context(), p.AccountID, in)
	if errors.Is(err, postgres.ErrConflict) {
		s.writeAPIError(w, http.StatusConflict, "REVISION_CONFLICT", "memory source revision changed")
		return
	}
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if out.Observe.Searched {
		logger := s.log
		if logger == nil {
			logger = slog.Default()
		}
		logger.Info("memory recall",
			"summary_gate_allow", out.Observe.SummaryAllow,
			"summary_gate_reject", out.Observe.SummaryReject,
			"profile_gate_allow", out.Observe.ProfileAllow,
			"profile_gate_reject", out.Observe.ProfileReject,
			"embedding_cache_hit", out.Observe.EmbeddingCacheHit,
			"embedding_cache_miss", out.Observe.EmbeddingCacheMiss,
			"recall_empty", out.Observe.RecallEmpty,
			"rerank_decision", out.Observe.RerankDecision,
			"rerank_candidates", out.Observe.RerankCandidates,
			"rerank_kept", out.Observe.RerankKept,
			"rerank_only", out.Observe.RerankOnly,
			"rerank_fallback", out.Observe.RerankFallback)
		if s.metrics != nil {
			s.metrics.ObserveMemoryRecall(recallMetrics(out.Observe))
		}
	}
	s.writeJSON(w, http.StatusOK, out)
}

func recallMetrics(observed postgres.RecallObserve) observability.MemoryRecallStats {
	stats := observability.MemoryRecallStats{
		SummaryAllow: observed.SummaryAllow, SummaryReject: observed.SummaryReject,
		ProfileAllow: observed.ProfileAllow, ProfileReject: observed.ProfileReject,
		EmbeddingCacheHit: observed.EmbeddingCacheHit, EmbeddingCacheMiss: observed.EmbeddingCacheMiss,
		RecallEmpty: observed.RecallEmpty, RerankFallback: observed.RerankFallback,
		RerankCandidates: observed.RerankCandidates, RerankKept: observed.RerankKept,
		RerankOnly: observed.RerankOnly,
	}
	switch observed.RerankDecision {
	case "applied":
		stats.RerankApplied = 1
	case "unavailable":
		stats.RerankUnavailable = 1
	case "timeout":
		stats.RerankTimeout = 1
	case "invalid":
		stats.RerankInvalid = 1
	case "disabled":
		stats.RerankDisabled = 1
	default:
		if observed.RerankDecision != "" {
			stats.RerankInvalid = 1
		}
	}
	return stats
}
