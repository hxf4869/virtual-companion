package postgres

import "testing"

func TestEmbeddingConfigValidation(t *testing.T) {
	valid := SaveEmbeddingConfig{Model: "qwen3-embedding:0.6b", ArtifactVersion: "synthetic-v1", Dimensions: 1024,
		QueryPreprocessingVersion: "qwen3-retrieval-v1", DocumentPreprocessingVersion: "identity-v1", Normalization: "l2", State: ProviderEnabled}
	if !validEmbeddingConfig(valid) {
		t.Fatal("valid dedicated embedding snapshot rejected")
	}
	for _, mutate := range []func(*SaveEmbeddingConfig){
		func(v *SaveEmbeddingConfig) { v.ArtifactVersion = "" },
		func(v *SaveEmbeddingConfig) { v.Dimensions = 0 },
		func(v *SaveEmbeddingConfig) { v.QueryPreprocessingVersion = "unsupported" },
		func(v *SaveEmbeddingConfig) { v.DocumentPreprocessingVersion = "unsupported" },
		func(v *SaveEmbeddingConfig) { v.Normalization = "unsupported" },
		func(v *SaveEmbeddingConfig) { v.ExpectedRevision = -1 },
	} {
		v := valid
		mutate(&v)
		if validEmbeddingConfig(v) {
			t.Fatalf("invalid embedding configuration accepted: %+v", v)
		}
	}
}
