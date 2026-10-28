package postgres

import (
	"context"
	"errors"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func (s *Store) UseSTDataClient(client stsource.DataClient) { s.stData = client }
func (s *Store) ClearSTAccountData(ctx context.Context, owner int64) (bool, error) {
	var state, stState string
	var handle *string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT out_status,out_st_status,out_st_handle FROM vc.get_st_account_deletion_current()`).Scan(&state, &stState, &handle)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	if state == "COMPLETED" || stState == "NOT_APPLICABLE" || stState == "COMPLETED" {
		return true, nil
	}
	if s.stData == nil {
		return false, nil
	}
	expected := ""
	if handle != nil {
		expected = *handle
	}
	result, err := s.stData.Delete(ctx, owner, expected)
	if errors.Is(err, stsource.ErrUnavailable) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.complete_st_account_deletion_current($1)`, result.Handle)
		return err
	})
	return err == nil, mapStoreErr(err)
}
func (s *Store) ListPendingAccountDeletions(ctx context.Context) ([]int64, error) {
	owners := []int64{}
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT out_owner FROM vc.pending_account_deletions(32)`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var owner int64
			if err := rows.Scan(&owner); err != nil {
				return err
			}
			owners = append(owners, owner)
		}
		return rows.Err()
	})
	return owners, mapStoreErr(err)
}
func (s *Store) DeferExportForST(ctx context.Context, owner, job int64, token, fence string) error {
	return mapStoreErr(s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.defer_export_for_st($1,$2,$3,$4)`, owner, job, token, fence)
		return err
	}))
}

func (s *Store) RegisterSTProfile(ctx context.Context, owner int64, handle string) error {
	return mapStoreErr(s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.register_st_profile($1,$2)`, owner, handle)
		return err
	}))
}
