package postgres

import (
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestSTBindingErrorsStayOpaqueAndTyped(t *testing.T) {
	for _, tc := range []struct {
		name, code, message string
		want                error
	}{
		{"binding conflict", "P0001", "resolve_st_binding: conflict", ErrConflict},
		{"foreign relationship", "P0001", "resolve_st_binding: relationship not found", ErrNotFound},
		{"invalid binding", "23514", "resolve_st_binding: invalid input", ErrInvalid},
		{"unrelated database error", "XX000", "synthetic private SQL detail", errStore},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := mapSTBindingErr(&pgconn.PgError{Code: tc.code, Message: tc.message})
			if !errors.Is(got, tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
		})
	}
}
