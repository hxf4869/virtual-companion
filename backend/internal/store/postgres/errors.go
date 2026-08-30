package postgres

import (
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is the owner-scoped miss: foreign and absent are the same.
var ErrNotFound = errors.New("not found")

// ErrInvalid is a catalog or request-shape failure. It never carries SQL.
var ErrInvalid = errors.New("invalid request")

// errStore is the opaque persistence failure. Callers must not wrap it
// with SQL, ids, or body text.
var errStore = errors.New("store operation failed")

func mapStoreErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) || errors.Is(err, errStore) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503": // foreign_key_violation
			return ErrNotFound
		case "23514", "23502", "22001", "22P02":
			return ErrInvalid
		default:
			return errStore
		}
	}
	return errStore
}
