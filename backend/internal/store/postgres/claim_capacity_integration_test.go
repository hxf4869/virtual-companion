//go:build integration

package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"
)

// TestGoClaimJobsPerKindCapacity pins the V129/V149 claim contract: each live
// kind is capped by the per-kind limit the worker passes, the limits are
// independent, a zero limit claims none, and the overall batch limit still
// caps the total. Extraction slots now apply to ST_MEMORY_EXTRACT.
// MEMORY_EXTRACT is retired and must not be claimed.
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
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	for i := int64(1); i <= 3; i++ {
		if err := IsolationSuperExec(ctx, fmt.Sprintf(`
WITH src AS (
    INSERT INTO vc.st_message_source(
        owner_user_id, conversation_id, message_id, candidate_id,
        source_revision, source_generation, source_ref, role, content_cipher,
        present, settled, eligible)
    VALUES (
        1, %d,
        '20000000-0000-4000-8000-%012d'::uuid,
        '30000000-0000-4000-8000-%012d'::uuid,
        1, 1, 'st:capacity:%d', 'user', 'synthetic',
        true, true, true)
    RETURNING id, source_ref
)
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, st_source_ref, status)
SELECT 1, nextval('vc.work_item_id_seq'), 'ST_MEMORY_EXTRACT', id, source_ref, 'PENDING'
  FROM src`, conv, i, i, i)); err != nil {
			t.Fatal(err)
		}
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
		if kinds["MEMORY_EXTRACT"] != 0 {
			t.Fatalf("retired MEMORY_EXTRACT claimed: %+v", kinds)
		}
		return kinds
	}

	// Per-kind caps apply independently: one free slot of each live kind
	// claims one of each, regardless of the other kind's backlog.
	if got := claim(32, 1, 1); got["GENERATION"] != 1 || got["ST_MEMORY_EXTRACT"] != 1 {
		t.Fatalf("first round %+v, want 1 GENERATION + 1 ST_MEMORY_EXTRACT", got)
	}
	// A zero limit claims none of that kind; the other kind still flows.
	if got := claim(32, 0, 2); got["GENERATION"] != 0 || got["ST_MEMORY_EXTRACT"] != 2 {
		t.Fatalf("second round %+v, want 0 GENERATION + 2 ST_MEMORY_EXTRACT", got)
	}
	// Remaining backlog: 2 GENERATION, 0 ST_MEMORY_EXTRACT.
	if got := claim(32, 1, 1); got["GENERATION"] != 1 || got["ST_MEMORY_EXTRACT"] != 0 {
		t.Fatalf("third round %+v, want 1 GENERATION only", got)
	}
	// The overall batch limit caps the total across kinds.
	if got := claim(1, 8, 8); got["GENERATION"] != 1 || got["ST_MEMORY_EXTRACT"] != 0 {
		t.Fatalf("final round %+v, want the batch-limited 1 GENERATION", got)
	}
	pending, err := psqlSuper(`SELECT count(*) FROM vc.work_item WHERE owner_user_id = 1 AND kind = 'MEMORY_EXTRACT' AND status = 'PENDING'`)
	if err != nil {
		t.Fatal(err)
	}
	if pending != "3" {
		t.Fatalf("retired backlog status count %s, want 3 still PENDING and unclaimed", pending)
	}
}
