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
			"recall_empty", out.Observe.RecallEmpty)
		if s.metrics != nil {
			s.metrics.ObserveMemoryRecall(observability.MemoryRecallStats{
				SummaryAllow: out.Observe.SummaryAllow, SummaryReject: out.Observe.SummaryReject,
				ProfileAllow: out.Observe.ProfileAllow, ProfileReject: out.Observe.ProfileReject,
				EmbeddingCacheHit: out.Observe.EmbeddingCacheHit, EmbeddingCacheMiss: out.Observe.EmbeddingCacheMiss,
				RecallEmpty: out.Observe.RecallEmpty,
			})
		}
	}
	s.writeJSON(w, http.StatusOK, out)
}
