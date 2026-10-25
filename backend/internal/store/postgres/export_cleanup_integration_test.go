//go:build integration

package postgres

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

func TestExportPointerCleanupDuringAccountDeletion(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	hash, err := auth.Hash("synthetic-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
VALUES (1,'cleanup-owner',$1,'USER','ACTIVE','fixture')`, hash); err != nil {
		t.Fatal(err)
	}
	exp, err := s.CreateExport(ctx, 1, "synthetic-export-token")
	if err != nil {
		t.Fatal(err)
	}
	key := fmt.Sprintf("exports/1/%d-0123456789abcdef.json", exp.ID)
	if _, err := s.RecordExportUploadIntent(ctx, 1, exp.ID, key, 600); err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExportObject(ctx, 1, exp.ID, key, 10, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	// The exception only permits pointer erasure; changing other columns
	// while erasing a pointer remains a forbidden outbound write.
	if err := IsolationSuperExec(ctx, `UPDATE vc.export_request SET object_key=NULL,object_bytes=NULL,payload='late'
WHERE id=$1`, exp.ID); err == nil {
		t.Fatal("deletion guard allowed payload mutation")
	}
	if err := s.ClearExportObject(ctx, 1, exp.ID, key); err != nil {
		t.Fatalf("cleanup rejected: %v", err)
	}
	remaining, err := s.ListOwnerExportObjects(ctx, 1)
	if err != nil || len(remaining) != 0 {
		t.Fatalf("remaining=%v err=%v", remaining, err)
	}
	if err := s.DeleteAccount(ctx, 1); err != nil {
		t.Fatal(err)
	}
}

func TestFailedExportUploadsAreFencedAndRetriedForCleanup(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	exp, err := s.CreateExport(ctx, 1, "synthetic-failed-upload")
	if err != nil {
		t.Fatal(err)
	}
	claim := claimExportJob(t, ctx, s, 1, exp.ID)
	key := fmt.Sprintf("exports/1/%d-0123456789abcdef.json", exp.ID)
	intentID, err := s.RecordExportUploadIntent(ctx, 1, exp.ID, key, 600)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.FailExportJob(ctx, 1, claim.JobID, exp.ID, claim.Token, claim.Fence, "EXPORT_SEAL"); err != nil {
		t.Fatal(err)
	}
	items, err := s.ClaimExportUploadCleanup(ctx)
	if err != nil || len(items) != 0 {
		t.Fatalf("live upload claimed: %v %v", items, err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.export_upload_intent SET lease_expires_at=now()-interval '1 hour' WHERE id=$1`, intentID); err != nil {
		t.Fatal(err)
	}
	items, err = s.ClaimExportUploadCleanup(ctx)
	if err != nil || len(items) != 1 || items[0].ObjectKey != key {
		t.Fatalf("stale upload missing: %v %v", items, err)
	}
	// A delete failure does not mark the tombstone swept. Next maintenance
	// pass must see it again, without renewing the writer's right to seal.
	items, err = s.ClaimExportUploadCleanup(ctx)
	if err != nil || len(items) != 1 {
		t.Fatalf("retry lost: %v %v", items, err)
	}
	if _, err := s.RecordExportUploadIntent(ctx, 1, exp.ID, key, 600); err == nil {
		t.Fatal("reclaimed upload reopened")
	}
	if err := s.CompleteExportUploadCleanup(ctx, 1, intentID); err != nil {
		t.Fatal(err)
	}
	pool := superPool(t, ctx)
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vc.export_upload_intent WHERE id=$1`, intentID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("late-writer tombstone lost: count=%d err=%v", count, err)
	}
	if err := IsolationSuperExec(ctx, `UPDATE vc.export_upload_intent SET claimed_at=now()-interval '2 days',swept_at=now()-interval '2 days' WHERE id=$1`, intentID); err != nil {
		t.Fatal(err)
	}
	items, err = s.ClaimExportUploadCleanup(ctx)
	if err != nil || len(items) != 1 {
		t.Fatalf("final sweep missing: %v %v", items, err)
	}
	if err := s.CompleteExportUploadCleanup(ctx, 1, intentID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vc.export_upload_intent WHERE id=$1`, intentID).Scan(&count); err != nil || count != 0 {
		t.Fatalf("terminal tombstone retained: count=%d err=%v", count, err)
	}
}
