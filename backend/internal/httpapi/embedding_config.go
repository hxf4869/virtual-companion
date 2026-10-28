package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type embeddingConfigStore interface {
	GetEmbeddingConfig(context.Context, int64) (postgres.EmbeddingConfig, error)
	SaveEmbeddingConfig(context.Context, int64, postgres.SaveEmbeddingConfig) (postgres.EmbeddingConfig, error)
}

func (s *Server) handleGetEmbeddingConfig(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, false)
	if p == nil {
		return
	}
	store, ok := s.core.Providers.(embeddingConfigStore)
	if !ok {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "embedding configuration unavailable")
		return
	}
	out, err := store.GetEmbeddingConfig(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleSaveEmbeddingConfig(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	store, ok := s.core.Providers.(embeddingConfigStore)
	if !ok {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "embedding configuration unavailable")
		return
	}
	var body struct {
		postgres.SaveEmbeddingConfig
		Revision *int64 `json:"expectedRevision"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCoreBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.Revision == nil {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid embedding configuration")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid embedding configuration")
		return
	}
	in := body.SaveEmbeddingConfig
	in.ExpectedRevision = *body.Revision
	out, err := store.SaveEmbeddingConfig(r.Context(), p.AccountID, in)
	if err != nil {
		s.writeCatalogErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}
