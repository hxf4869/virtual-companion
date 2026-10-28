package postgres

import (
	"context"
	"strconv"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

// The account scope is used only for owner-wide rights operations. Engine record
// selection is owner-wide and does not trust a browser-provided instance.
func memoryCoreAccountScope(owner int64) map[string]string {
	return map[string]string{"ownerId": strconv.FormatInt(owner, 10), "instanceId": "1", "mode": "COMPANION", "domainId": "account-rights", "profileScopeId": "account-rights"}
}
func (s *Store) ClearMemoryCoreAccountData(ctx context.Context, owner int64) (bool, error) {
	var status string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.get_memorycore_account_deletion_current()`).Scan(&status)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	if status == "COMPLETED" || status == "NOT_APPLICABLE" {
		return true, nil
	}
	if s.memoryEngine == nil {
		return false, nil
	}
	var result struct {
		Status          string `json:"status"`
		PhysicalErasure bool   `json:"physicalErasure"`
	}
	// The same deletion task retries once. A cleared receipt can still leave
	// vectors.db behind; the engine removes those files on the next call.
	for attempt := 0; attempt < 2; attempt++ {
		result.Status = ""
		result.PhysicalErasure = false
		if err := s.memoryEngine.Call(ctx, "clear-owner", map[string]any{"scope": memoryCoreAccountScope(owner), "accountDeletion": true}, &result); err != nil {
			return false, nil
		}
		if result.Status != "cleared" {
			return false, nil
		}
		if result.PhysicalErasure {
			break
		}
		if attempt == 1 {
			return false, nil
		}
	}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.complete_memorycore_account_deletion_current()`)
		return err
	})
	return err == nil, mapStoreErr(err)
}
func (s *Store) exportMemoryCoreOwner(ctx context.Context, owner int64) (map[string]any, error) {
	if s.memoryEngine == nil {
		return nil, stsource.ErrUnavailable
	}
	var data map[string]any
	if err := s.memoryEngine.Call(ctx, "export-owner", map[string]any{"scope": memoryCoreAccountScope(owner)}, &data); err != nil {
		return nil, stsource.ErrUnavailable
	}
	return data, nil
}
