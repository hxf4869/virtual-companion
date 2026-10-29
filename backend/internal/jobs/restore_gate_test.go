package jobs

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestClaimAndRecoverStayShutUntilRestoreGateOpens(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	gate := filepath.Join(dir, "restore-gate.json")
	if err := os.WriteFile(gate, []byte("{\"blocked\":true}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := &concurrencyStore{claims: []postgres.JobClaim{{
		OwnerID: 1, JobID: 7, Kind: KindGeneration, RefID: 1, Token: "token", Fence: "fence",
	}}}
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.store = store
	loop.UseRestoreGate(gate)
	if n := loop.ClaimOnce(context.Background()); n != 0 {
		t.Fatalf("claimed %d while restore gate blocked", n)
	}
	if store.claimCalls != 0 {
		t.Fatalf("claim calls %d", store.claimCalls)
	}
	if err := loop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	loop.RunInboxAndNotifications(context.Background())
	if err := os.Remove(gate); err != nil {
		t.Fatal(err)
	}
	store.claims = nil
	if n := loop.ClaimOnce(context.Background()); n != 0 {
		t.Fatalf("open gate with no pending work claimed %d", n)
	}
	if store.claimCalls != 1 {
		t.Fatalf("open gate claim calls %d", store.claimCalls)
	}
}
