//go:build integration

package postgres

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestMemoryExtractLeaseRecoveryBoundedAndDeadLetters pins the V127 recovery
// contract on ST_MEMORY_EXTRACT: an expired claimed job is listed by the
// recovery pass, requeued with the claim reset (bounded by the same retry
// budget) and finally dead-lettered. The SQL row kind stays ST_MEMORY_EXTRACT.
// Requeue keeps ref_id, so a rerun re-hits the same auto-save idempotency keys
// (no duplicate rows) and the same no_memory tombstone guards (no resurrection)
// — both already pinned by TestCreateAutoSavedMemoryIntegration.
func TestMemoryExtractLeaseRecoveryBoundedAndDeadLetters(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	useSTExtractRoute(t, store)
	const (
		recoveryChat      = "10000000-0000-0000-0000-0000000000d8"
		recoveryMessage   = "20000000-0000-0000-0000-0000000000d8"
		recoveryCandidate = "30000000-0000-0000-0000-0000000000d8"
	)
	sourceID := openSTExtractSource(t, store, recoveryChat, "extract-card-d", recoveryMessage, recoveryCandidate, "恢复来源")
	jobs := stExtractJobIDs(t, store, 1)
	if len(jobs) != 1 {
		t.Fatalf("ST extract jobs %v, want 1", jobs)
	}
	jobID := jobs[0]

	claimJob := func() {
		t.Helper()
		claim := claimSTExtract(t, store, jobID)
		if claim.RefID != sourceID {
			t.Fatalf("extract ref %d, want source %d", claim.RefID, sourceID)
		}
	}
	expireLease := func() {
		t.Helper()
		if err := IsolationSuperExec(ctx,
			`UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 minute'
			  WHERE owner_user_id = 1 AND id = $1 AND kind = 'ST_MEMORY_EXTRACT'`, jobID); err != nil {
			t.Fatal(err)
		}
	}
	assertKind := func() {
		t.Helper()
		var kind string
		if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, `SELECT kind FROM vc.work_item WHERE id = $1`, jobID).Scan(&kind)
		}); err != nil {
			t.Fatal(err)
		}
		if kind != "ST_MEMORY_EXTRACT" {
			t.Fatalf("job kind %s, want ST_MEMORY_EXTRACT", kind)
		}
	}

	// A live claim must never be recoverable.
	claimJob()
	assertKind()
	if action, err := store.RecoverExpiredMemoryExtract(ctx, 1, jobID); err != nil || action != "LEASE_ACTIVE" {
		t.Fatalf("live-claim recover action=%q err=%v, want LEASE_ACTIVE", action, err)
	}

	// Bounded requeue: each cycle claims, expires, recovers.
	for wantAttempts := 1; wantAttempts <= 2; wantAttempts++ {
		expireLease()
		expired, err := store.ListExpiredMemoryExtractJobs(ctx, 8)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, c := range expired {
			if c.OwnerID == 1 && c.JobID == jobID {
				found = true
			}
		}
		if !found {
			t.Fatalf("expired list %v misses job %d", expired, jobID)
		}
		assertKind()
		action, err := store.RecoverExpiredMemoryExtract(ctx, 1, jobID)
		if err != nil || action != "REQUEUED" {
			t.Fatalf("recover %d action=%q err=%v, want REQUEUED", wantAttempts, action, err)
		}
		var status string
		var attempts int
		var token *string
		if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx,
				`SELECT status, attempt_count, claim_token FROM vc.work_item WHERE id = $1`, jobID,
			).Scan(&status, &attempts, &token)
		}); err != nil {
			t.Fatal(err)
		}
		if status != "PENDING" || attempts != wantAttempts || token != nil {
			t.Fatalf("after recover %d: status=%s attempts=%d token=%v", wantAttempts, status, attempts, token)
		}
		claimJob()
	}

	// Retry budget exhausted: dead letter, terminal and visible.
	expireLease()
	action, err := store.RecoverExpiredMemoryExtract(ctx, 1, jobID)
	if err != nil || action != "DEAD_LETTERED" {
		t.Fatalf("final recover action=%q err=%v, want DEAD_LETTERED", action, err)
	}
	var status string
	var attempts int
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT status, attempt_count FROM vc.work_item WHERE id = $1`, jobID,
		).Scan(&status, &attempts)
	}); err != nil {
		t.Fatal(err)
	}
	if status != "DEAD_LETTERED" || attempts != 3 {
		t.Fatalf("dead-lettered row status=%s attempts=%d", status, attempts)
	}
	// Terminal rows are never listed again.
	expired, err := store.ListExpiredMemoryExtractJobs(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range expired {
		if c.JobID == jobID {
			t.Fatalf("dead-lettered job %d still listed", jobID)
		}
	}
}
