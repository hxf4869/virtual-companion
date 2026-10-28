package postgres

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// EmbeddingEndpoint is local deployment configuration, never a model/browser
// supplied callback address. This path is deliberately separate from chat.
const EmbeddingEndpoint = "http://127.0.0.1:11438"

type SaveEmbeddingConfig struct {
	Model                        string `json:"model"`
	ArtifactVersion              string `json:"artifactVersion"`
	Dimensions                   int    `json:"dimensions"`
	QueryPreprocessingVersion    string `json:"queryPreprocessingVersion"`
	DocumentPreprocessingVersion string `json:"documentPreprocessingVersion"`
	Normalization                string `json:"normalization"`
	State                        string `json:"state"`
	ExpectedRevision             int64  `json:"expectedRevision"`
}

// SpaceID is allocated by PostgreSQL on any vector-space-defining change.
// Consumers must rebuild before using the new space; revision alone must not
// be used to combine vectors across configurations.
type EmbeddingConfig struct {
	Provider                     string `json:"provider"`
	Endpoint                     string `json:"endpoint"`
	Model                        string `json:"model"`
	ArtifactVersion              string `json:"artifactVersion"`
	Dimensions                   int    `json:"dimensions"`
	QueryPreprocessingVersion    string `json:"queryPreprocessingVersion"`
	DocumentPreprocessingVersion string `json:"documentPreprocessingVersion"`
	Normalization                string `json:"normalization"`
	State                        string `json:"state"`
	Revision                     int64  `json:"revision"`
	SpaceID                      string `json:"spaceId"`
}

func validEmbeddingConfig(in SaveEmbeddingConfig) bool {
	validText := func(s string) bool {
		return s != "" && s == strings.TrimSpace(s) && utf8.RuneCountInString(s) <= 256 && !strings.ContainsAny(s, "\r\n\x00")
	}
	return validText(in.Model) && validText(in.ArtifactVersion) && in.Dimensions > 0 && in.Dimensions <= 4096 &&
		(in.QueryPreprocessingVersion == "qwen3-retrieval-v1" || in.QueryPreprocessingVersion == "identity-v1") &&
		in.DocumentPreprocessingVersion == "identity-v1" && (in.Normalization == "l2" || in.Normalization == "none") &&
		(in.State == ProviderEnabled || in.State == ProviderDisabled) && in.ExpectedRevision >= 0
}

const embeddingColumns = `model, artifact_version, dimensions, query_preprocessing,
 document_preprocessing, normalization, state, revision, space_id::text`

func scanEmbeddingConfig(row pgx.Row) (EmbeddingConfig, error) {
	out := EmbeddingConfig{Provider: "OLLAMA", Endpoint: EmbeddingEndpoint}
	err := row.Scan(&out.Model, &out.ArtifactVersion, &out.Dimensions, &out.QueryPreprocessingVersion,
		&out.DocumentPreprocessingVersion, &out.Normalization, &out.State, &out.Revision, &out.SpaceID)
	if err == pgx.ErrNoRows {
		return EmbeddingConfig{}, ErrNotFound
	}
	return out, err
}

func (s *Store) GetEmbeddingConfig(ctx context.Context, actor int64) (EmbeddingConfig, error) {
	var out EmbeddingConfig
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanEmbeddingConfig(tx.QueryRow(ctx, `SELECT `+embeddingColumns+` FROM vc.go_admin_get_embedding_config($1)`, actor))
		return err
	})
	return out, mapStoreErr(err)
}

func (s *Store) SaveEmbeddingConfig(ctx context.Context, actor int64, in SaveEmbeddingConfig) (EmbeddingConfig, error) {
	if !validEmbeddingConfig(in) {
		return EmbeddingConfig{}, ErrInvalid
	}
	var out EmbeddingConfig
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanEmbeddingConfig(tx.QueryRow(ctx, `SELECT `+embeddingColumns+` FROM vc.go_admin_save_embedding_config($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			actor, in.Model, in.ArtifactVersion, in.Dimensions, in.QueryPreprocessingVersion, in.DocumentPreprocessingVersion, in.Normalization, in.State, in.ExpectedRevision))
		return err
	})
	return out, mapStoreErr(err)
}

func (s *Store) ResolveEmbeddingConfig(ctx context.Context, owner int64) (EmbeddingConfig, error) {
	var out EmbeddingConfig
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanEmbeddingConfig(tx.QueryRow(ctx, `SELECT `+embeddingColumns+` FROM vc.go_service_resolve_embedding_config($1)`, owner))
		return err
	})
	return out, mapStoreErr(err)
}
