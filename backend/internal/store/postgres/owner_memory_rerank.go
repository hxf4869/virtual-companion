package postgres

import (
	"context"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

// OwnerMemoryRerank is the owner-level rerank switch. Revision 0 and Enabled
// true is the synthetic default before the first save. The SillyTavern
// extension's memory enabled flag and budget stay in extension settings;
// this row is the Go record those controls do not have.
type OwnerMemoryRerank struct {
	Enabled  bool  `json:"enabled"`
	Revision int64 `json:"revision"`
}

func (s *Store) GetOwnerMemoryRerank(ctx context.Context, actor int64) (OwnerMemoryRerank, error) {
	var out OwnerMemoryRerank
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_enabled, out_revision FROM vc.go_admin_get_owner_memory_rerank($1)`, actor).Scan(&out.Enabled, &out.Revision)
	})
	return out, mapStoreErr(err)
}

func (s *Store) SaveOwnerMemoryRerank(ctx context.Context, actor int64, enabled bool, expected int64) (OwnerMemoryRerank, error) {
	if expected < 0 {
		return OwnerMemoryRerank{}, ErrInvalid
	}
	var out OwnerMemoryRerank
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_enabled, out_revision FROM vc.go_admin_save_owner_memory_rerank($1,$2,$3)`, actor, enabled, expected).Scan(&out.Enabled, &out.Revision)
	})
	return out, mapStoreErr(err)
}

func (s *Store) ResolveOwnerMemoryRerank(ctx context.Context, owner int64) (bool, error) {
	var enabled bool
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.go_service_resolve_owner_memory_rerank($1)`, owner).Scan(&enabled)
	})
	return enabled, mapStoreErr(err)
}

// ReadLocalModels asks MemoryCore for the fixed local model probes. A missing
// or failing engine still returns the known names with healthy false, so the
// admin page can show the switch without an address or an upstream error.
func (s *Store) ReadLocalModels(ctx context.Context) (memoryengine.LocalModelStatus, error) {
	if s == nil || s.memoryEngine == nil {
		return memoryengine.UnavailableLocalModels(), nil
	}
	status, err := s.memoryEngine.LocalModels(ctx)
	if err != nil {
		return memoryengine.UnavailableLocalModels(), nil
	}
	if status.Embedding.Model == "" {
		status.Embedding.Model = memoryengine.LocalEmbeddingModel
	}
	if status.Embedding.Dimensions == 0 {
		status.Embedding.Dimensions = memoryengine.LocalEmbeddingDimensions
	}
	if status.Rerank.Model == "" {
		status.Rerank.Model = memoryengine.LocalRerankModel
	}
	return status, nil
}
