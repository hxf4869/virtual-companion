package httpapi

import (
	"context"
	"net/http"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type embeddingMemStore struct {
	*providerMemStore
	saved int
}

func (m *embeddingMemStore) GetEmbeddingConfig(context.Context, int64) (postgres.EmbeddingConfig, error) {
	return postgres.EmbeddingConfig{Provider: "OLLAMA", Endpoint: postgres.EmbeddingEndpoint, SpaceID: "synthetic-space", Revision: 1}, nil
}
func (m *embeddingMemStore) SaveEmbeddingConfig(_ context.Context, _ int64, in postgres.SaveEmbeddingConfig) (postgres.EmbeddingConfig, error) {
	m.saved++
	return postgres.EmbeddingConfig{Provider: "OLLAMA", Model: in.Model, Revision: 2}, nil
}

func TestEmbeddingConfigurationAdminBoundary(t *testing.T) {
	s, base := newProviderServer(t)
	store := &embeddingMemStore{providerMemStore: base}
	s.core.Providers = store
	const endpoint = "/api/v1/admin/embedding-config"
	const body = `{"model":"qwen3-embedding:0.6b","artifactVersion":"fixture-v1","dimensions":1024,"queryPreprocessingVersion":"qwen3-retrieval-v1","documentPreprocessingVersion":"identity-v1","normalization":"l2","state":"ENABLED","expectedRevision":1}`
	if rec := providerRequest(t, s, base, http.MethodGet, endpoint, "", 9, false); rec.Code != 200 {
		t.Fatalf("admin read: %d %s", rec.Code, rec.Body.String())
	}
	if rec := providerRequest(t, s, base, http.MethodGet, endpoint, "", 1, false); rec.Code != 403 {
		t.Fatalf("non-admin read: %d", rec.Code)
	}
	if rec := providerRequest(t, s, base, http.MethodPut, endpoint, body, 9, false); rec.Code != 403 {
		t.Fatalf("no reauth: %d", rec.Code)
	}
	if store.saved != 0 {
		t.Fatal("unauthorized write reached store")
	}
	if rec := providerRequest(t, s, base, http.MethodPut, endpoint, body, 9, true); rec.Code != 200 {
		t.Fatalf("admin save: %d %s", rec.Code, rec.Body.String())
	}
	if store.saved != 1 {
		t.Fatal("authorized snapshot not saved")
	}
	if rec := providerRequest(t, s, base, http.MethodPut, endpoint, `{"endpoint":"https://attacker.example"}`, 9, true); rec.Code != 400 {
		t.Fatalf("endpoint override: %d", rec.Code)
	}
	if store.saved != 1 {
		t.Fatal("endpoint override reached store")
	}
}
