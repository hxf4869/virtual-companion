//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// claimExportJob claims the owner's PENDING DATA_EXPORT work item that
// CreateExport enqueued and returns the live claim. Per-kind limits are zero:
// only the export row is wanted here.
func claimExportJob(t *testing.T, ctx context.Context, store *Store, owner, exportID int64) JobClaim {
	t.Helper()
	claims, err := store.ClaimJobs(ctx, 30*time.Second, 60*time.Second, 30*time.Second, 32, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range claims {
		if c.Kind == "DATA_EXPORT" && c.OwnerID == owner && c.RefID == exportID {
			return c
		}
	}
	t.Fatalf("claimed set %v misses DATA_EXPORT job for owner %d export %d", claims, owner, exportID)
	return JobClaim{}
}

// exportJobState reads the work item row the owner context can see.
// last_error_code, claim_token, claim_fence and lease_expires_at are nullable.
func exportJobState(t *testing.T, ctx context.Context, store *Store, owner, jobID int64) (status string, lastErr, token, fence *string, lease *time.Time) {
	t.Helper()
	if err := store.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT status, last_error_code, claim_token, claim_fence, lease_expires_at
			   FROM vc.work_item WHERE owner_user_id = $1 AND id = $2`,
			owner, jobID,
		).Scan(&status, &lastErr, &token, &fence, &lease)
	}); err != nil {
		t.Fatal(err)
	}
	return status, lastErr, token, fence, lease
}

// superPool opens the synthetic superuser pool for assertions the runtime
// role cannot make: the ciphertext column and the SECURITY-DEFINER-only
// vc.export_upload_intent table.
func superPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// TestExportFailLifecycleClosesPendingExportAndUnblocksOwner pins the failed
// export closure: FailExportJob terminalizes the work item (claim cleared,
// stable error code) and the still-PENDING export in one transaction, so the
// owner is no longer stuck behind count_inflight_exports and can request a
// new export.
func TestExportFailLifecycleClosesPendingExportAndUnblocksOwner(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	exp, err := store.CreateExport(ctx, 1, "tok-fixture-fail")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)

	// While the export stays PENDING, a second request is refused.
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-fail-blocked"); !errors.Is(err, ErrConflict) {
		t.Fatalf("in-flight guard err=%v, want ErrConflict", err)
	}

	// Production EXPORT_PUT ordering: the intent is recorded after the key is
	// minted and the put then fails, so the failure close runs against a live
	// OPEN intent.
	objectKey := fmt.Sprintf("exports/1/%d-0123456789abcdef.json", exp.ID)
	if _, err := store.RecordExportUploadIntent(ctx, 1, exp.ID, objectKey, 600); err != nil {
		t.Fatal(err)
	}

	if err := store.FailExportJob(ctx, 1, claim.JobID, exp.ID, claim.Token, claim.Fence, "EXPORT_PUT"); err != nil {
		t.Fatal(err)
	}

	// The OPEN intent survives the terminal untouched (V114 defect C): the
	// pre-cascade deletion worklist still addresses the key, and the intent
	// row is neither consumed nor cleared.
	objects, err := store.ListOwnerExportObjects(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, o := range objects {
		if o.ExportID == exp.ID && o.ObjectKey == objectKey {
			found = true
		}
	}
	if !found {
		t.Fatalf("owner objects %v miss the OPEN intent key %q", objects, objectKey)
	}
	pool := superPool(t, ctx)
	var state, key string
	var intentLease time.Time
	if err := pool.QueryRow(ctx,
		`SELECT state, object_key, lease_expires_at FROM vc.export_upload_intent
		  WHERE owner_user_id = 1 AND export_id = $1 AND object_key = $2`,
		exp.ID, objectKey,
	).Scan(&state, &key, &intentLease); err != nil {
		t.Fatal(err)
	}
	if state != "OPEN" || key != objectKey || intentLease.IsZero() || !intentLease.After(time.Now()) {
		t.Fatalf("intent state=%q key=%q lease=%v, want OPEN with the same key and a future lease",
			state, key, intentLease)
	}
	// PENDING→FAILED must not write an object pointer: a FAILED row carrying
	// object_key would be an unreachable PENDING-mode pointer.
	var pointer *string
	if err := pool.QueryRow(ctx,
		`SELECT object_key FROM vc.export_request WHERE owner_user_id = 1 AND id = $1`,
		exp.ID,
	).Scan(&pointer); err != nil {
		t.Fatal(err)
	}
	if pointer != nil {
		t.Fatalf("FAILED export carries object pointer %q", *pointer)
	}

	status, lastErr, token, fence, lease := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "FAILED" || lastErr == nil || *lastErr != "EXPORT_PUT" || token != nil || fence != nil || lease != nil {
		t.Fatalf("work item status=%q last_error=%v token=%v fence=%v lease=%v",
			status, lastErr, token, fence, lease)
	}

	got, err := store.GetExport(ctx, 1, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "FAILED" || got.ErrorMessage == nil || *got.ErrorMessage != "EXPORT_PUT" || got.CompletedAt == nil {
		t.Fatalf("export status=%q error=%v completed=%v", got.Status, got.ErrorMessage, got.CompletedAt)
	}

	// Core acceptance: the failed export no longer blocks a new request.
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-fail-after"); err != nil {
		t.Fatalf("new export after failed closure: %v", err)
	}
}

// TestExportFailLifecycleRejectsStaleClaim pins the stale-claim protection:
// go_assert_live_claim RAISEs for an expired lease or a wrong token, the
// whole transaction rolls back, and the export is never shot down by a
// worker that no longer owns the claim.
func TestExportFailLifecycleRejectsStaleClaim(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store

	exp, err := store.CreateExport(ctx, 1, "tok-fixture-stale")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 second'
		  WHERE owner_user_id = 1 AND id = $1 AND kind = 'DATA_EXPORT'`, claim.JobID); err != nil {
		t.Fatal(err)
	}

	err = store.FailExportJob(ctx, 1, claim.JobID, exp.ID, claim.Token, claim.Fence, "EXPORT_PUT")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expired-lease FailExportJob err=%v, want ErrConflict", err)
	}
	status, _, token, _, _ := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "CLAIMED" || token == nil || *token != claim.Token {
		t.Fatalf("work item status=%q token=%v, want CLAIMED with the live token kept", status, token)
	}
	if got, err := store.GetExport(ctx, 1, exp.ID); err != nil || got.Status != "PENDING" {
		t.Fatalf("export after stale close err=%v status=%q, want PENDING", err, got.Status)
	}
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-stale-blocked"); !errors.Is(err, ErrConflict) {
		t.Fatalf("export was shot down by a stale claim: err=%v, want ErrConflict", err)
	}

	// Wrong-token variant on a second owner: the live-claim assert RAISEs and
	// rolls the closure back the same way.
	exp2, err := store.CreateExport(ctx, 2, "tok-fixture-stale-b")
	if err != nil {
		t.Fatal(err)
	}
	claim2 := claimExportJob(t, ctx, store, 2, exp2.ID)
	err = store.FailExportJob(ctx, 2, claim2.JobID, exp2.ID, "wrong-token", claim2.Fence, "EXPORT_PUT")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("wrong-token FailExportJob err=%v, want ErrConflict", err)
	}
	status2, _, token2, _, _ := exportJobState(t, ctx, store, 2, claim2.JobID)
	if status2 != "CLAIMED" || token2 == nil || *token2 != claim2.Token {
		t.Fatalf("work item status=%q token=%v, want CLAIMED with the live token kept", status2, token2)
	}
	if got, err := store.GetExport(ctx, 2, exp2.ID); err != nil || got.Status != "PENDING" {
		t.Fatalf("export after wrong-token close err=%v status=%q, want PENDING", err, got.Status)
	}
	if _, err := store.CreateExport(ctx, 2, "tok-fixture-stale-b-blocked"); !errors.Is(err, ErrConflict) {
		t.Fatalf("export was shot down by a wrong token: err=%v, want ErrConflict", err)
	}
}

// TestExportFailLifecycleDoesNotRegressReadyExport pins that fail_export
// affecting 0 rows is not an error: a worker whose claim is still live closes
// its work item as FAILED while an already-READY export stays READY and keeps
// its one-time download.
func TestExportFailLifecycleDoesNotRegressReadyExport(t *testing.T) {
	// The harness TestMain opens the shared store without a field cipher;
	// arm it so CompleteExport→ConsumeExport exercises the real encrypted
	// storage path instead of the nil-cipher plaintext compatibility mode.
	installSyntheticCipher(t)
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	exp, err := store.CreateExport(ctx, 1, "tok-fixture-ready")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)
	if err := store.CompleteExport(ctx, 1, exp.ID, "payload-fixture", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// The stored payload is ciphertext, not the plaintext fixture: the seal
	// went through the armed cipher rather than the plaintext fallback.
	var stored string
	if err := superPool(t, ctx).QueryRow(ctx,
		`SELECT payload FROM vc.export_request WHERE owner_user_id = 1 AND id = $1`,
		exp.ID,
	).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == "" || stored == "payload-fixture" {
		t.Fatalf("stored payload is plaintext (%d bytes), want ciphertext", len(stored))
	}

	if err := store.FailExportJob(ctx, 1, claim.JobID, exp.ID, claim.Token, claim.Fence, "EXPORT_PUT"); err != nil {
		t.Fatal(err)
	}

	status, lastErr, token, fence, lease := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "FAILED" || lastErr == nil || *lastErr != "EXPORT_PUT" || token != nil || fence != nil || lease != nil {
		t.Fatalf("work item status=%q last_error=%v token=%v fence=%v lease=%v",
			status, lastErr, token, fence, lease)
	}
	got, err := store.GetExport(ctx, 1, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "READY" {
		t.Fatalf("READY export regressed to %q", got.Status)
	}
	dl, err := store.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-ready")
	if err != nil || dl.Payload != "payload-fixture" {
		t.Fatalf("one-time download after close err=%v payload=%q", err, dl.Payload)
	}
}
