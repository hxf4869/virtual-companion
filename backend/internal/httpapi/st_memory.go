package httpapi

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
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
	s.writeJSON(w, http.StatusOK, out)
}
