package postgres

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// ErrNotFound is the owner-scoped miss: foreign and absent are the same.
var ErrNotFound = errors.New("not found")

// ErrInvalid is a catalog or request-shape failure. It never carries SQL.
var ErrInvalid = errors.New("invalid request")

// ErrConflict is a state clash that is safe to disclose (in-flight export).
var ErrConflict = errors.New("conflict")

// errStore is the opaque persistence failure. Callers must not wrap it
// with SQL, ids, or body text.
var errStore = errors.New("store operation failed")

func mapStoreErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) || errors.Is(err, ErrConflict) || errors.Is(err, ErrOwnerContextRejected) || errors.Is(err, errStore) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503": // foreign_key_violation
			return ErrNotFound
		case "23514", "23502", "22001", "22P02":
			return ErrInvalid
		case "P0001":
			return mapRaise(pgErr.Message)
		default:
			return errStore
		}
	}
	return errStore
}

func mapRaise(msg string) error {
	switch {
	case strings.Contains(msg, "owner deletion is in progress"):
		return ErrNotFound
	case strings.Contains(msg, "deletion is in progress"):
		return ErrNotFound
	case strings.Contains(msg, "already in flight"):
		return ErrConflict
	case strings.Contains(msg, "not found"):
		return ErrNotFound
	case strings.Contains(msg, "idempotency_key is invalid"):
		return ErrInvalid
	default:
		return errStore
	}
}
