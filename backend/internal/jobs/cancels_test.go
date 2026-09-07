package jobs

import (
	"sync/atomic"
	"testing"
)

// These tests pin the cancel registry's kind-scoped key spaces: GENERATION ids
// (c.RefID) and MEMORY_EXTRACT job ids (c.JobID) come from two independent
// bigint sequences, so the same numeric id must never let one kind overwrite,
// cancel or unregister the other's entry.

func TestCancelsKindKeyspacesAreIndependent(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var genCalls, extractCalls atomic.Int32
	c.Register(KindGeneration, 1, 100, func() { genCalls.Add(1) })
	c.Register(KindMemoryExtract, 1, 100, func() { extractCalls.Add(1) })

	if !c.Cancel(KindGeneration, 100) {
		t.Fatal("generation cancel not registered")
	}
	if genCalls.Load() != 1 || extractCalls.Load() != 0 {
		t.Fatalf("generation cancel hit extract entry: gen %d extract %d", genCalls.Load(), extractCalls.Load())
	}
	if c.Cancel(KindGeneration, 100) {
		t.Fatal("generation entry must be consumed by the first cancel")
	}
	// The same-numbered extract entry survived the generation cancel.
	if got := c.CancelOwner(1); got != 1 {
		t.Fatalf("owner cancels %d want 1 (extract entry)", got)
	}
	if extractCalls.Load() != 1 {
		t.Fatalf("extract calls %d want 1", extractCalls.Load())
	}
	if got := c.CancelOwner(1); got != 0 {
		t.Fatalf("entries remained after owner cancellation: %d", got)
	}
}

func TestCancelsUnregisterIsKindScoped(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var genCalls, extractCalls atomic.Int32
	c.Register(KindGeneration, 1, 200, func() { genCalls.Add(1) })
	c.Register(KindMemoryExtract, 1, 200, func() { extractCalls.Add(1) })

	c.Unregister(KindGeneration, 200)
	if got := c.CancelOwner(1); got != 1 {
		t.Fatalf("owner cancels %d want 1 (extract entry must survive)", got)
	}
	if genCalls.Load() != 0 || extractCalls.Load() != 1 {
		t.Fatalf("gen %d extract %d, want only extract cancelled", genCalls.Load(), extractCalls.Load())
	}
}

func TestCancelsOwnersAreIsolatedAcrossKindsForSameID(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var owner1Calls, owner2Calls atomic.Int32
	c.Register(KindGeneration, 1, 300, func() { owner1Calls.Add(1) })
	c.Register(KindMemoryExtract, 2, 300, func() { owner2Calls.Add(1) })

	if got := c.CancelOwner(1); got != 1 {
		t.Fatalf("owner 1 cancels %d want 1", got)
	}
	if owner1Calls.Load() != 1 || owner2Calls.Load() != 0 {
		t.Fatalf("owner1 %d owner2 %d, want only owner 1 cancelled", owner1Calls.Load(), owner2Calls.Load())
	}
	if got := c.CancelOwner(2); got != 1 {
		t.Fatalf("owner 2 cancels %d want 1", got)
	}
	if owner2Calls.Load() != 1 {
		t.Fatalf("owner2 calls %d want 1", owner2Calls.Load())
	}
}

// TestCancelsCancelOwnerCancelsAcrossKinds keeps the account-deletion
// semantics: CancelOwner cancels every in-process call of that owner, now
// across both kinds, and never another owner's entries.
func TestCancelsCancelOwnerCancelsAcrossKinds(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var genCalls, extractCalls, otherCalls atomic.Int32
	c.Register(KindGeneration, 1, 400, func() { genCalls.Add(1) })
	c.Register(KindMemoryExtract, 1, 401, func() { extractCalls.Add(1) })
	c.Register(KindGeneration, 2, 402, func() { otherCalls.Add(1) })

	if got := c.CancelOwner(1); got != 2 {
		t.Fatalf("owner 1 cancels %d want 2 (generation + extract)", got)
	}
	if genCalls.Load() != 1 || extractCalls.Load() != 1 {
		t.Fatalf("gen %d extract %d, want both owner 1 kinds cancelled", genCalls.Load(), extractCalls.Load())
	}
	if otherCalls.Load() != 0 {
		t.Fatalf("other owner cancelled %d times, want 0", otherCalls.Load())
	}
	if got := c.CancelOwner(2); got != 1 {
		t.Fatalf("owner 2 cancels %d want 1", got)
	}
}
