package postgres

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
)

func TestReadLocalModelsWithoutEngine(t *testing.T) {
	var store Store
	got, err := store.ReadLocalModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := memoryengine.UnavailableLocalModels()
	if got != want {
		t.Fatalf("missing engine %+v", got)
	}
}

func TestReadLocalModelsKeepsProbeAndDropsFailure(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/internal/local-models" || r.Header.Get("Authorization") == "" {
			t.Errorf("probe request %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"embedding":{"model":"qwen3-embedding:0.6b","dimensions":1024,"healthy":true},"rerank":{"model":"bge-reranker-v2-m3","deploymentEnabled":true,"healthy":true}}`))
	}))
	defer up.Close()
	client, err := memoryengine.New(up.URL, "synthetic-memory-token")
	if err != nil {
		t.Fatal(err)
	}
	var store Store
	store.UseMemoryEngine(client)
	got, err := store.ReadLocalModels(context.Background())
	if err != nil || !got.Embedding.Healthy || !got.Rerank.DeploymentEnabled || !got.Rerank.Healthy {
		t.Fatalf("probe %+v %v", got, err)
	}
	down := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "secret memory text", http.StatusBadGateway)
	}))
	defer down.Close()
	failed, err := memoryengine.New(down.URL, "synthetic-memory-token")
	if err != nil {
		t.Fatal(err)
	}
	store.UseMemoryEngine(failed)
	got, err = store.ReadLocalModels(context.Background())
	if err != nil || got != memoryengine.UnavailableLocalModels() {
		t.Fatalf("failure %+v %v", got, err)
	}
}
