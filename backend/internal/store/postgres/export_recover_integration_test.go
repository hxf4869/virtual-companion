//go:build integration

package postgres

// R214-C: vc.recover_export_request through the Store against the real
// database. The function pins the newest claimable copy (digest still set,
// PENDING or unexpired READY), re-arms only that row and re-checks it on the
// locked version; a consumed, expired, foreign or deleting-account copy is
// never re-armed and surfaces as ErrNotFound. The in-flight consume-vs-recover
// and recover-vs-deletion lock timelines are exercised with real connections
// in infra/db/tests/174_export_recover_token_rotation.sql.

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
)

// exportTokenHash reads the at-rest digest of a fixture export as the
// synthetic superuser ("" when NULL, i.e. consumed or terminal). Tests only
// compare these values; fixture tokens are synthetic.
func exportTokenHash(t *testing.T, id int64) string {
	t.Helper()
	out, err := psqlSuper(fmt.Sprintf(
		`SELECT coalesce(download_token_hash, '') FROM vc.export_request WHERE id = %d`, id))
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func TestExportRecoverPendingRotatesAndSealKeepsOnlyNewToken(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	exp, err := s.CreateExport(ctx, 1, "tok-fixture-a")
	if err != nil {
		t.Fatal(err)
	}
	original := exportTokenHash(t, exp.ID)

	rec, err := s.RecoverExport(ctx, 1, "tok-fixture-b")
	if err != nil {
		t.Fatal(err)
	}
	if rec.ID != exp.ID || rec.Status != "PENDING" || !rec.RequestedAt.Equal(exp.RequestedAt) {
		t.Fatalf("recover must re-arm the same PENDING row: got id=%d status=%s", rec.ID, rec.Status)
	}
	rotated := exportTokenHash(t, exp.ID)
	if rotated == "" || rotated == original || rotated == "tok-fixture-b" {
		t.Fatal("recover must store a fresh digest, never the plaintext")
	}
	// Still PENDING: neither token downloads anything yet.
	if _, err := s.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("pending consume %v", err)
	}
	if err := s.CompleteExport(ctx, 1, exp.ID, `{"conversations":[]}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if exportTokenHash(t, exp.ID) != rotated {
		t.Fatal("sealing must keep the re-issued digest")
	}
	if _, err := s.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-a"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("superseded token must not consume: %v", err)
	}
	dl, err := s.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-b")
	if err != nil || dl.Payload == "" {
		t.Fatalf("re-issued token consume %v", err)
	}
	if _, err := s.ConsumeExport(ctx, 1, exp.ID, "tok-fixture-b"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second consume %v", err)
	}
	// Consumed (digest NULL) is never re-armed.
	if _, err := s.RecoverExport(ctx, 1, "tok-fixture-c"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("recover after consume %v", err)
	}
	if exportTokenHash(t, exp.ID) != "" {
		t.Fatal("consumed export must keep a NULL digest")
	}
}

func TestExportRecoverReadyPrefersNewestUnclaimed(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	older, err := s.CreateExport(ctx, 1, "tok-older")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExport(ctx, 1, older.ID, `{"older":true}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	newer, err := s.CreateExport(ctx, 1, "tok-newer")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExport(ctx, 1, newer.ID, `{"newer":true}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	olderHash := exportTokenHash(t, older.ID)

	rec, err := s.RecoverExport(ctx, 1, "tok-recovered")
	if err != nil {
		t.Fatal(err)
	}
	if rec.ID != newer.ID || rec.Status != "READY" {
		t.Fatalf("recover must pick the newest READY row: got %d (%s) want %d", rec.ID, rec.Status, newer.ID)
	}
	if exportTokenHash(t, older.ID) != olderHash {
		t.Fatal("the older copy must not be touched")
	}
	if _, err := s.ConsumeExport(ctx, 1, newer.ID, "tok-newer"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("superseded token must not consume: %v", err)
	}
	if _, err := s.ConsumeExport(ctx, 1, newer.ID, "tok-recovered"); err != nil {
		t.Fatalf("re-issued token consume %v", err)
	}
	if _, err := s.ConsumeExport(ctx, 1, older.ID, "tok-older"); err != nil {
		t.Fatalf("older copy must keep its own token: %v", err)
	}
}

func TestExportRecoverAfterConsumeFallsBackToOlderUnclaimed(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	older, err := s.CreateExport(ctx, 1, "tok-older")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExport(ctx, 1, older.ID, `{"older":true}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	newer, err := s.CreateExport(ctx, 1, "tok-newer")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExport(ctx, 1, newer.ID, `{"newer":true}`, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// The newest copy is claimed first; a later recover must not revive it and
	// legitimately re-arms the older copy that is still unclaimed.
	if _, err := s.ConsumeExport(ctx, 1, newer.ID, "tok-newer"); err != nil {
		t.Fatal(err)
	}
	rec, err := s.RecoverExport(ctx, 1, "tok-recovered")
	if err != nil {
		t.Fatal(err)
	}
	if rec.ID != older.ID {
		t.Fatalf("recover must fall back to the older unclaimed copy: got %d want %d", rec.ID, older.ID)
	}
	if exportTokenHash(t, newer.ID) != "" {
		t.Fatal("the consumed newer copy must stay consumed")
	}
	if _, err := s.ConsumeExport(ctx, 1, older.ID, "tok-older"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("older copy's superseded token must not consume: %v", err)
	}
	if _, err := s.ConsumeExport(ctx, 1, older.ID, "tok-recovered"); err != nil {
		t.Fatalf("re-issued token consume %v", err)
	}
}

func TestExportRecoverRefusesEmptyExpiredForeignAndDeleting(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	s := testEnv.store
	if _, err := s.RecoverExport(ctx, 1, ""); !errors.Is(err, ErrInvalid) {
		t.Fatalf("empty token %v", err)
	}
	if _, err := s.RecoverExport(ctx, 1, "tok-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("nothing claimable %v", err)
	}
	expired, err := s.CreateExport(ctx, 1, "tok-expired")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CompleteExport(ctx, 1, expired.ID, `{"x":1}`, time.Now().UTC().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	expiredHash := exportTokenHash(t, expired.ID)
	if _, err := s.RecoverExport(ctx, 1, "tok-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired READY %v", err)
	}
	if exportTokenHash(t, expired.ID) != expiredHash {
		t.Fatal("an expired copy must not be re-armed")
	}

	live, err := s.CreateExport(ctx, 1, "tok-live")
	if err != nil {
		t.Fatal(err)
	}
	liveHash := exportTokenHash(t, live.ID)
	if _, err := s.RecoverExport(ctx, 2, "tok-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign owner %v", err)
	}
	if exportTokenHash(t, live.ID) != liveHash {
		t.Fatal("a foreign owner's recover must not touch owner 1's token")
	}

	hash, err := auth.Hash("synthetic-password")
	if err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
VALUES (1,'recover-owner',$1,'USER','ACTIVE','fixture')`, hash); err != nil {
		t.Fatal(err)
	}
	if err := s.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverExport(ctx, 1, "tok-x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("recover during deletion %v", err)
	}
	if exportTokenHash(t, live.ID) != liveHash {
		t.Fatal("a refused recover must not rotate the token")
	}
}
