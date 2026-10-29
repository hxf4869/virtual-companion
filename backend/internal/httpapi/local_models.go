package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type localModelStore interface {
	GetEmbeddingConfig(context.Context, int64) (postgres.EmbeddingConfig, error)
	GetOwnerMemoryRerank(context.Context, int64) (postgres.OwnerMemoryRerank, error)
	SaveOwnerMemoryRerank(context.Context, int64, bool, int64) (postgres.OwnerMemoryRerank, error)
	ReadLocalModels(context.Context) (memoryengine.LocalModelStatus, error)
}

type localEmbeddingView struct {
	Model      string `json:"model"`
	Dimensions int    `json:"dimensions"`
	Healthy    bool   `json:"healthy"`
	State      string `json:"state,omitempty"`
}

type localRerankView struct {
	Model             string `json:"model"`
	DeploymentEnabled bool   `json:"deploymentEnabled"`
	Healthy           bool   `json:"healthy"`
	Enabled           bool   `json:"enabled"`
	Revision          int64  `json:"revision"`
}

type localModelsView struct {
	Embedding localEmbeddingView `json:"embedding"`
	Rerank    localRerankView    `json:"rerank"`
}

func (s *Server) handleGetLocalModels(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, false)
	if p == nil {
		return
	}
	store, ok := s.core.Providers.(localModelStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "local model status unavailable")
		return
	}
	setting, err := store.GetOwnerMemoryRerank(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	cfg, err := store.GetEmbeddingConfig(r.Context(), p.AccountID)
	if err != nil && !errors.Is(err, postgres.ErrNotFound) {
		s.writeStoreErr(w, err)
		return
	}
	configured := err == nil
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	live, err := store.ReadLocalModels(ctx)
	if err != nil {
		live = memoryengine.UnavailableLocalModels()
	}
	view := localModelsView{
		Embedding: localEmbeddingView{
			Model: live.Embedding.Model, Dimensions: live.Embedding.Dimensions, Healthy: live.Embedding.Healthy,
		},
		Rerank: localRerankView{
			Model: live.Rerank.Model, DeploymentEnabled: live.Rerank.DeploymentEnabled, Healthy: live.Rerank.Healthy,
			Enabled: setting.Enabled, Revision: setting.Revision,
		},
	}
	if view.Embedding.Model == "" {
		view.Embedding.Model = memoryengine.LocalEmbeddingModel
	}
	if view.Embedding.Dimensions == 0 {
		view.Embedding.Dimensions = memoryengine.LocalEmbeddingDimensions
	}
	if view.Rerank.Model == "" {
		view.Rerank.Model = memoryengine.LocalRerankModel
	}
	if configured {
		view.Embedding.Model = cfg.Model
		view.Embedding.Dimensions = cfg.Dimensions
		view.Embedding.State = cfg.State
	}
	s.writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleSaveLocalModelRerank(w http.ResponseWriter, r *http.Request) {
	p := s.providerAdminPrincipal(w, r, true)
	if p == nil {
		return
	}
	store, ok := s.core.Providers.(localModelStore)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "local model status unavailable")
		return
	}
	var body struct {
		Enabled  *bool  `json:"enabled"`
		Revision *int64 `json:"expectedRevision"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxCoreBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil || body.Enabled == nil || body.Revision == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid rerank setting")
		return
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid rerank setting")
		return
	}
	out, err := store.SaveOwnerMemoryRerank(r.Context(), p.AccountID, *body.Enabled, *body.Revision)
	if err != nil {
		s.writeCatalogErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}
