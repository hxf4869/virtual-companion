package postgres

import (
	"errors"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestProfileFailureCarriesClosedCode(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code string
	}{
		{name: "conflict", err: profileFailure(ErrConflict), code: "MEMORYCORE_PROFILE_CONFLICT"},
		{name: "missing source", err: profileFailure(pgx.ErrNoRows), code: "MEMORYCORE_PROFILE_SOURCE"},
		{name: "invalid", err: profileFailure(ErrInvalid), code: "MEMORYCORE_PROFILE_INVALID"},
		{name: "unavailable", err: profileFailure(memoryengine.ErrUnavailable), code: "MEMORYCORE_PROFILE_UNAVAILABLE"},
		{name: "kept", err: profileFailure(memoryengine.ClosedError("MEMORYCORE_PROFILE_VERIFICATION")), code: "MEMORYCORE_PROFILE_VERIFICATION"},
		{name: "store", err: profileFailure(errors.New("database down")), code: "MEMORYCORE_PROFILE_STORE"},
	}
	for _, tc := range cases {
		if memoryengine.ClosedCode(tc.err) != tc.code || strings.Contains(tc.err.Error(), "database down") || strings.Contains(tc.err.Error(), "secret") {
			t.Fatalf("%s code %q err %v", tc.name, memoryengine.ClosedCode(tc.err), tc.err)
		}
	}
	raised := mapStoreErr(&pgconn.PgError{Code: "P0001", Message: "profile fingerprint changed"})
	if memoryengine.ClosedCode(raised) != "MEMORYCORE_PROFILE_FINGERPRINT" || strings.Contains(raised.Error(), "changed") {
		t.Fatalf("raise code %q err %v", memoryengine.ClosedCode(raised), raised)
	}
	if got := memoryengine.ClosedCode(mapStoreErr(&pgconn.PgError{Code: "P0001", Message: "memorycore target binding changed"})); got != "" {
		t.Fatalf("shared memorycore raise became profile code %q", got)
	}
}
