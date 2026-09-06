//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"
)

// TestGoClaimJobsPerKindCapacity pins the V129 claim contract: each kind is
// capped by the per-kind limit the worker passes (its free slots for that
// kind), the kind limits are independent, a zero limit claims none, and the
// overall batch limit still caps the total. This is the SQL side of the
// worker's "claim takes the slot" capacity model.
func TestGoClaimJobsPerKindCapacity(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store

	seedPending := func(kind string, ref int64) {
		t.Helper()
		if err := IsolationSuperExec(ctx,
			`INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
			 VALUES (1, nextval('vc.work_item_id_seq'), $1, $2, 'PENDING')`, kind, ref); err != nil {
			t.Fatal(err)
		}
	}
	for i := int64(1); i <= 3; i++ {
		seedPending("GENERATION", 910000+i)
		seedPending("MEMORY_EXTRACT", 920000+i)
	}

	claim := func(limit, genLimit, extractLimit int) map[string]int {
		t.Helper()
		claims, err := store.ClaimJobs(ctx, 30*time.Second, 60*time.Second, 30*time.Second, limit, genLimit, extractLimit)
		if err != nil {
			t.Fatal(err)
		}
		kinds := map[string]int{}
		for _, c := range claims {
			if c.OwnerID != 1 || c.Token == "" || c.Fence == "" {
				t.Fatalf("bad claim %+v", c)
			}
			kinds[c.Kind]++
		}
		return kinds
	}

	// Per-kind caps apply independently: one free slot of each kind claims
	// one of each, regardless of the other kind's backlog.
	if got := claim(32, 1, 1); got["GENERATION"] != 1 || got["MEMORY_EXTRACT"] != 1 {
		t.Fatalf("first round %+v, want 1 GENERATION + 1 MEMORY_EXTRACT", got)
	}
	// A zero limit claims none of that kind; the other kind still flows.
	if got := claim(32, 0, 2); got["GENERATION"] != 0 || got["MEMORY_EXTRACT"] != 2 {
		t.Fatalf("second round %+v, want 0 GENERATION + 2 MEMORY_EXTRACT", got)
	}
	// Remaining backlog: 2 GENERATION, 0 MEMORY_EXTRACT.
	if got := claim(32, 1, 1); got["GENERATION"] != 1 || got["MEMORY_EXTRACT"] != 0 {
		t.Fatalf("third round %+v, want 1 GENERATION only", got)
	}
	// The overall batch limit caps the total across kinds.
	if got := claim(1, 8, 8); got["GENERATION"] != 1 {
		t.Fatalf("final round %+v, want the batch-limited 1 GENERATION", got)
	}
}
