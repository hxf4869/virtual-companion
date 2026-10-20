//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// TestExportLeaseRecoveryFailsExpiredClaimAndUnblocksOwner pins the DATA_EXPORT
// lease-recovery entry (V135): a worker that dies mid-build leaves the work
// item CLAIMED with an elapsed lease while the export stays PENDING, and the
// recovery pass must terminalize both (EXPORT_LEASE_EXPIRED, no requeue) so
// the owner is no longer stuck behind count_inflight_exports. The late worker
// keeps its stale-claim protection and cannot regress the terminal state.
func TestExportLeaseRecoveryFailsExpiredClaimAndUnblocksOwner(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	exp, err := store.CreateExport(ctx, 1, "tok-fixture-lease")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)

	// The worker dies mid-build after recording its upload intent: the claim
	// lease elapses while the export is still PENDING. Expire synthetically
	// instead of sleeping out the lease.
	objectKey := fmt.Sprintf("exports/1/%d-0123456789abcdef.json", exp.ID)
	if _, err := store.RecordExportUploadIntent(ctx, 1, exp.ID, objectKey, 600); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 minute'
		  WHERE owner_user_id = 1 AND id = $1 AND kind = 'DATA_EXPORT'`, claim.JobID); err != nil {
		t.Fatal(err)
	}

	// Gap probe (VC-R06): the pre-V135 recovery surface has no DATA_EXPORT
	// entry — neither expired list contains the stuck job.
	gens, err := store.ListExpiredGenerationJobs(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range gens {
		if c.JobID == claim.JobID {
			t.Fatalf("generation recovery list contains export job %d", claim.JobID)
		}
	}
	extracts, err := store.ListExpiredMemoryExtractJobs(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range extracts {
		if c.JobID == claim.JobID {
			t.Fatalf("memory extract recovery list contains export job %d", claim.JobID)
		}
	}
	// The still-PENDING export keeps blocking a new request.
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-lease-blocked"); !errors.Is(err, ErrConflict) {
		t.Fatalf("in-flight guard err=%v, want ErrConflict", err)
	}

	// The export recovery list picks the expired claim up and the guarded
	// recovery terminalizes it.
	expired, err := store.ListExpiredExportJobs(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range expired {
		if c.OwnerID == 1 && c.JobID == claim.JobID && c.Kind == "DATA_EXPORT" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expired export list %v misses job %d", expired, claim.JobID)
	}
	action, err := store.RecoverExpiredExport(ctx, 1, claim.JobID)
	if err != nil || action != "FAILED" {
		t.Fatalf("recover action=%q err=%v, want FAILED", action, err)
	}

	// The work item is terminally closed with the claim fully cleared.
	status, lastErr, token, fence, lease := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "FAILED" || lastErr == nil || *lastErr != "EXPORT_LEASE_EXPIRED" || token != nil || fence != nil || lease != nil {
		t.Fatalf("work item status=%q last_error=%v token=%v fence=%v lease=%v",
			status, lastErr, token, fence, lease)
	}
	// The PENDING export failed with the same stable code.
	got, err := store.GetExport(ctx, 1, exp.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != "FAILED" || got.ErrorMessage == nil || *got.ErrorMessage != "EXPORT_LEASE_EXPIRED" || got.CompletedAt == nil {
		t.Fatalf("export status=%q error=%v completed=%v", got.Status, got.ErrorMessage, got.CompletedAt)
	}

	// The OPEN intent survives the terminal untouched (same as R05): neither
	// consumed nor cleared, and the owner object worklist still addresses the
	// key until the intent lease expires.
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
	objects, err := store.ListOwnerExportObjects(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	found = false
	for _, o := range objects {
		if o.ExportID == exp.ID && o.ObjectKey == objectKey {
			found = true
		}
	}
	if !found {
		t.Fatalf("owner objects %v miss the OPEN intent key %q", objects, objectKey)
	}

	// Core acceptance: the failed export no longer blocks a new request.
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-lease-after"); err != nil {
		t.Fatalf("new export after lease recovery: %v", err)
	}

	// The late worker cannot shoot anything down: its expired claim is
	// refused by the live-claim assert, and a late seal of the FAILED export
	// cannot resurrect it as READY.
	err = store.FailExportJob(ctx, 1, claim.JobID, exp.ID, claim.Token, claim.Fence, "EXPORT_PUT")
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("late FailExportJob err=%v, want ErrConflict", err)
	}
	if err := store.CompleteExport(ctx, 1, exp.ID, "late-payload", time.Now().UTC().Add(time.Hour)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("late CompleteExport err=%v, want ErrNotFound", err)
	}
	after, err := store.GetExport(ctx, 1, exp.ID)
	if err != nil || after.Status != "FAILED" {
		t.Fatalf("export after late worker status=%q err=%v, want FAILED", after.Status, err)
	}
}

// TestExportLeaseRecoveryKeepsLiveClaim pins the live-claim guard: a DATA_EXPORT
// claim whose lease has not elapsed is never listed nor recovered, the export
// stays PENDING, and a cross-owner recovery call is refused without side
// effects.
func TestExportLeaseRecoveryKeepsLiveClaim(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	exp, err := store.CreateExport(ctx, 1, "tok-fixture-live")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)

	expired, err := store.ListExpiredExportJobs(ctx, 8)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range expired {
		if c.JobID == claim.JobID {
			t.Fatalf("live claim %d listed as expired: %v", claim.JobID, expired)
		}
	}
	action, err := store.RecoverExpiredExport(ctx, 1, claim.JobID)
	if err != nil || action != "LEASE_ACTIVE" {
		t.Fatalf("live-claim recover action=%q err=%v, want LEASE_ACTIVE", action, err)
	}
	status, _, token, fence, lease := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "CLAIMED" || token == nil || *token != claim.Token || fence == nil || lease == nil {
		t.Fatalf("work item status=%q token=%v fence=%v lease=%v, want CLAIMED with the live claim kept",
			status, token, fence, lease)
	}
	if got, err := store.GetExport(ctx, 1, exp.ID); err != nil || got.Status != "PENDING" {
		t.Fatalf("export after live-claim recover err=%v status=%q, want PENDING", err, got.Status)
	}
	if _, err := store.CreateExport(ctx, 1, "tok-fixture-live-blocked"); !errors.Is(err, ErrConflict) {
		t.Fatalf("live claim shot down: err=%v, want ErrConflict", err)
	}

	// Cross-owner recovery is refused (owner binding + row scoping) and
	// leaves both rows untouched.
	if action, err := store.RecoverExpiredExport(ctx, 2, claim.JobID); err == nil || action != "" {
		t.Fatalf("cross-owner recover action=%q err=%v, want an error", action, err)
	}
	status, _, token, _, _ = exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "CLAIMED" || token == nil || *token != claim.Token {
		t.Fatalf("work item after cross-owner recover status=%q token=%v, want CLAIMED with the token kept",
			status, token)
	}
	if got, err := store.GetExport(ctx, 1, exp.ID); err != nil || got.Status != "PENDING" {
		t.Fatalf("export after cross-owner recover err=%v status=%q, want PENDING", err, got.Status)
	}
}

// TestExportLeaseRecoveryDoesNotRegressReadyExport pins that fail_export
// affecting 0 rows is not an error in the recovery path either: an export the
// worker sealed READY before crashing keeps its terminal state and one-time
// download while the expired work item still closes as FAILED.
func TestExportLeaseRecoveryDoesNotRegressReadyExport(t *testing.T) {
	// The harness TestMain opens the shared store without a field cipher;
	// arm it so CompleteExport→ConsumeExport exercises the real encrypted
	// storage path instead of the nil-cipher plaintext compatibility mode.
	installSyntheticCipher(t)
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	exp, err := store.CreateExport(ctx, 1, "tok-fixture-lease-ready")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, store, 1, exp.ID)
	if err := store.CompleteExport(ctx, 1, exp.ID, "payload-fixture-lease", time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}

	// The worker crashes after sealing; the claim lease elapses.
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.work_item SET lease_expires_at = clock_timestamp() - interval '1 minute'
		  WHERE owner_user_id = 1 AND id = $1 AND kind = 'DATA_EXPORT'`, claim.JobID); err != nil {
		t.Fatal(err)
	}
	action, err := store.RecoverExpiredExport(ctx, 1, claim.JobID)
	if err != nil || action != "FAILED" {
		t.Fatalf("recover action=%q err=%v, want FAILED", action, err)
	}

	status, lastErr, token, fence, lease := exportJobState(t, ctx, store, 1, claim.JobID)
	if status != "FAILED" || lastErr == nil || *lastErr != "EXPORT_LEASE_EXPIRED" || token != nil || fence != nil || lease != nil {
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
	dl, err := store.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-lease-ready")
	if err != nil || dl.Payload != "payload-fixture-lease" {
		t.Fatalf("one-time download after recovery err=%v payload=%q", err, dl.Payload)
	}
}
