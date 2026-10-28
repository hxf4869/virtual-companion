//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
)

func TestEmbeddingConfigSpacesAndAuthorization(t *testing.T) {
	s := resetCatalogFixtures(t)
	ctx := context.Background()
	if err := IsolationSuperExec(ctx, "TRUNCATE vc.embedding_config"); err != nil {
		t.Fatal(err)
	}
	in := SaveEmbeddingConfig{Model: "qwen3-embedding:0.6b", ArtifactVersion: "synthetic-v1", Dimensions: 1024,
		QueryPreprocessingVersion: "qwen3-retrieval-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: ProviderEnabled}
	if _, err := s.SaveEmbeddingConfig(ctx, 1, in); err == nil {
		t.Fatal("non-admin changed embedding config")
	}
	first, err := s.SaveEmbeddingConfig(ctx, 7, in)
	if err != nil || first.SpaceID == "" || first.Revision != 1 {
		t.Fatalf("save: %+v %v", first, err)
	}
	resolved, err := s.ResolveEmbeddingConfig(ctx, 1)
	if err != nil || resolved.SpaceID != first.SpaceID {
		t.Fatalf("resolve: %+v %v", resolved, err)
	}
	if _, err := s.ResolveEmbeddingConfig(ctx, 2); !errors.Is(err, ErrServiceOwnerRejected) {
		t.Fatalf("disabled owner: %v", err)
	}
	if _, err := s.SaveEmbeddingConfig(ctx, 7, in); err == nil {
		t.Fatal("stale revision accepted")
	}
	in.ExpectedRevision = first.Revision
	same, err := s.SaveEmbeddingConfig(ctx, 7, in)
	if err != nil || same.SpaceID != first.SpaceID {
		t.Fatalf("same space: %+v %v", same, err)
	}
	for _, mutate := range []func(*SaveEmbeddingConfig){
		func(v *SaveEmbeddingConfig) { v.Model = "another-embedding" },
		func(v *SaveEmbeddingConfig) { v.ArtifactVersion = "synthetic-v2" },
		func(v *SaveEmbeddingConfig) { v.Dimensions = 768 },
		func(v *SaveEmbeddingConfig) { v.QueryPreprocessingVersion = "identity-v1" },
		func(v *SaveEmbeddingConfig) { v.Normalization = "none" },
	} {
		in.ExpectedRevision = same.Revision
		mutate(&in)
		next, err := s.SaveEmbeddingConfig(ctx, 7, in)
		if err != nil || next.SpaceID == same.SpaceID {
			t.Fatalf("space transition: %+v %v", next, err)
		}
		same = next
	}
	in.ExpectedRevision = same.Revision
	in.State = ProviderDisabled
	if _, err := s.SaveEmbeddingConfig(ctx, 7, in); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ResolveEmbeddingConfig(ctx, 1); !errors.Is(err, ErrNotFound) {
		t.Fatalf("disabled configuration: %v", err)
	}
}
