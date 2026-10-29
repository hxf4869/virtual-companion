package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type localModelMemStore struct {
	*embeddingMemStore
	setting    postgres.OwnerMemoryRerank
	saved      int
	status     memoryengine.LocalModelStatus
	statusErr  error
	configErr  error
	model      string
	dimensions int
}

func (m *localModelMemStore) GetEmbeddingConfig(context.Context, int64) (postgres.EmbeddingConfig, error) {
	if m.configErr != nil {
		return postgres.EmbeddingConfig{}, m.configErr
	}
	model := m.model
	if model == "" {
		model = "qwen3-embedding:0.6b"
	}
	dimensions := m.dimensions
	if dimensions == 0 {
		dimensions = 1024
	}
	return postgres.EmbeddingConfig{
		Provider: "OLLAMA", Endpoint: postgres.EmbeddingEndpoint, Model: model,
		Dimensions: dimensions, State: postgres.ProviderEnabled, Revision: 4,
	}, nil
}

func (m *localModelMemStore) GetOwnerMemoryRerank(context.Context, int64) (postgres.OwnerMemoryRerank, error) {
	if m.setting.Revision == 0 && !m.setting.Enabled {
		return postgres.OwnerMemoryRerank{Enabled: true, Revision: 0}, nil
	}
	return m.setting, nil
}

func (m *localModelMemStore) SaveOwnerMemoryRerank(_ context.Context, _ int64, enabled bool, expected int64) (postgres.OwnerMemoryRerank, error) {
	m.saved++
	if expected != m.setting.Revision {
		return postgres.OwnerMemoryRerank{}, &postgres.RevisionConflictError{Current: m.setting.Revision}
	}
	m.setting = postgres.OwnerMemoryRerank{Enabled: enabled, Revision: expected + 1}
	return m.setting, nil
}

func (m *localModelMemStore) ReadLocalModels(context.Context) (memoryengine.LocalModelStatus, error) {
	if m.statusErr != nil {
		return memoryengine.LocalModelStatus{}, m.statusErr
	}
	return m.status, nil
}

func TestLocalModelsAdminBoundary(t *testing.T) {
	s, base := newProviderServer(t)
	store := &localModelMemStore{
		embeddingMemStore: &embeddingMemStore{providerMemStore: base},
		setting:           postgres.OwnerMemoryRerank{Enabled: true, Revision: 2},
		status: memoryengine.LocalModelStatus{
			Embedding: memoryengine.EmbeddingProbe{Model: memoryengine.LocalEmbeddingModel, Dimensions: memoryengine.LocalEmbeddingDimensions, Healthy: true},
			Rerank:    memoryengine.RerankProbe{Model: memoryengine.LocalRerankModel, DeploymentEnabled: true, Healthy: false},
		},
	}
	s.core.Providers = store
	const read = "/api/v1/admin/local-models"
	if rec := providerRequest(t, s, base, http.MethodGet, read, "", 1, false); rec.Code != 403 {
		t.Fatalf("non-admin read: %d", rec.Code)
	}
	rec := providerRequest(t, s, base, http.MethodGet, read, "", 9, false)
	if rec.Code != 200 {
		t.Fatalf("admin read: %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, hidden := range []string{"127.0.0.1", "11438", "11439", postgres.EmbeddingEndpoint, "artifactVersion", "spaceId"} {
		if strings.Contains(body, hidden) {
			t.Fatalf("status leaked %s in %s", hidden, body)
		}
	}
	if !strings.Contains(body, `"model":"qwen3-embedding:0.6b"`) || !strings.Contains(body, `"dimensions":1024`) ||
		!strings.Contains(body, `"healthy":true`) || !strings.Contains(body, `"state":"ENABLED"`) ||
		!strings.Contains(body, `"model":"bge-reranker-v2-m3"`) || !strings.Contains(body, `"deploymentEnabled":true`) ||
		!strings.Contains(body, `"healthy":false`) || !strings.Contains(body, `"enabled":true`) ||
		!strings.Contains(body, `"revision":2`) {
		t.Fatalf("merged status %s", body)
	}
	const write = "/api/v1/admin/local-models/rerank"
	bodyOff := `{"enabled":false,"expectedRevision":2}`
	if rec := providerRequest(t, s, base, http.MethodPut, write, bodyOff, 9, false); rec.Code != 403 {
		t.Fatalf("no reauth: %d %s", rec.Code, rec.Body.String())
	}
	if store.saved != 0 {
		t.Fatal("unauthorized write reached store")
	}
	if rec := providerRequest(t, s, base, http.MethodPut, write, `{"endpoint":"http://127.0.0.1:1"}`, 9, true); rec.Code != 400 {
		t.Fatalf("address write: %d", rec.Code)
	}
	if store.saved != 0 {
		t.Fatal("address write reached store")
	}
	rec = providerRequest(t, s, base, http.MethodPut, write, bodyOff, 9, true)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":false`) || !strings.Contains(rec.Body.String(), `"revision":3`) {
		t.Fatalf("save: %d %s", rec.Code, rec.Body.String())
	}
	if store.saved != 1 || store.setting.Enabled || store.setting.Revision != 3 {
		t.Fatalf("stored %+v saved %d", store.setting, store.saved)
	}
	stale := providerRequest(t, s, base, http.MethodPut, write, `{"enabled":true,"expectedRevision":2}`, 9, true)
	if stale.Code != 409 || !strings.Contains(stale.Body.String(), `"code":"REVISION_CONFLICT"`) {
		t.Fatalf("stale: %d %s", stale.Code, stale.Body.String())
	}
}

func TestLocalModelsStayReadableWhenProbeFails(t *testing.T) {
	s, base := newProviderServer(t)
	store := &localModelMemStore{
		embeddingMemStore: &embeddingMemStore{providerMemStore: base},
		setting:           postgres.OwnerMemoryRerank{Enabled: true, Revision: 0},
		statusErr:         errors.New("dial tcp 127.0.0.1:8754: connect refused"),
		configErr:         postgres.ErrNotFound,
	}
	s.core.Providers = store
	rec := providerRequest(t, s, base, http.MethodGet, "/api/v1/admin/local-models", "", 9, false)
	if rec.Code != 200 {
		t.Fatalf("status: %d %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if strings.Contains(body, "127.0.0.1") || strings.Contains(body, "refused") || strings.Contains(body, `"state"`) {
		t.Fatalf("unconfigured status %s", body)
	}
	if !strings.Contains(body, `"model":"qwen3-embedding:0.6b"`) || !strings.Contains(body, `"healthy":false`) ||
		!strings.Contains(body, `"deploymentEnabled":false`) || !strings.Contains(body, `"enabled":true`) ||
		!strings.Contains(body, `"revision":0`) {
		t.Fatalf("fallback status %s", body)
	}
}

func TestLocalModelsUnhealthyWhenConfigDisagreesWithProbe(t *testing.T) {
	s, base := newProviderServer(t)
	store := &localModelMemStore{
		embeddingMemStore: &embeddingMemStore{providerMemStore: base},
		setting:           postgres.OwnerMemoryRerank{Enabled: true, Revision: 2},
		model:             "other-model",
		dimensions:        768,
		status: memoryengine.LocalModelStatus{
			Embedding: memoryengine.EmbeddingProbe{Model: memoryengine.LocalEmbeddingModel, Dimensions: memoryengine.LocalEmbeddingDimensions, Healthy: true},
			Rerank:    memoryengine.RerankProbe{Model: memoryengine.LocalRerankModel, DeploymentEnabled: true, Healthy: true},
		},
	}
	s.core.Providers = store
	rec := providerRequest(t, s, base, http.MethodGet, "/api/v1/admin/local-models", "", 9, false)
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, `"model":"other-model"`) || !strings.Contains(body, `"dimensions":768`) ||
		!strings.Contains(body, `"healthy":false`) || strings.Contains(body, "127.0.0.1") {
		t.Fatalf("mismatch status %d %s", rec.Code, body)
	}
}
