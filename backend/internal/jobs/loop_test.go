package jobs

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/config"
)

func TestCancelsInvokesRegisteredFunc(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var n atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	c.Register(1, 7, func() {
		n.Add(1)
		cancel()
	})
	if !c.Cancel(7) {
		t.Fatal("expected registered cancel")
	}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("cancel not observed")
	}
	if n.Load() != 1 {
		t.Fatalf("calls %d", n.Load())
	}
	if c.Cancel(7) {
		t.Fatal("cancel must only report the first signal")
	}
	if n.Load() != 1 {
		t.Fatalf("calls after repeated cancel %d", n.Load())
	}
	c.Unregister(7)
}

func TestCancelsCancelOwnerIsIsolatedAndIdempotent(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	ownerA1, cancelA1 := context.WithCancel(context.Background())
	ownerA2, cancelA2 := context.WithCancel(context.Background())
	ownerB, cancelB := context.WithCancel(context.Background())
	c.Register(1, 11, cancelA1)
	c.Register(1, 12, cancelA2)
	c.Register(2, 21, cancelB)

	if got := c.CancelOwner(1); got != 2 {
		t.Fatalf("owner A cancels %d want 2", got)
	}
	for name, ctx := range map[string]context.Context{"owner A generation 1": ownerA1, "owner A generation 2": ownerA2} {
		select {
		case <-ctx.Done():
		default:
			t.Fatalf("%s was not cancelled", name)
		}
	}
	select {
	case <-ownerB.Done():
		t.Fatal("owner B was cancelled with owner A")
	default:
	}
	if got := c.CancelOwner(1); got != 0 {
		t.Fatalf("repeated owner A cancels %d want 0", got)
	}
	if got := c.CancelOwner(2); got != 1 {
		t.Fatalf("owner B cancels %d want 1", got)
	}
}

func TestCancelsConcurrentOperationsInvokeAtMostOnce(t *testing.T) {
	t.Parallel()
	const total = 128
	c := NewCancels()
	calls := make([]atomic.Int32, total)
	extraCalls := make([]atomic.Int32, total)

	var register sync.WaitGroup
	for i := range total {
		register.Add(1)
		go func(i int) {
			defer register.Done()
			ownerID := int64(i%2 + 1)
			c.Register(ownerID, int64(i+1), func() { calls[i].Add(1) })
		}(i)
	}
	register.Wait()

	start := make(chan struct{})
	var race sync.WaitGroup
	for i := range total {
		race.Add(1)
		go func(i int) {
			defer race.Done()
			<-start
			if i%3 == 0 {
				ownerID := int64(i%2 + 1)
				c.Register(ownerID, int64(total+i+1), func() { extraCalls[i].Add(1) })
				c.Unregister(int64(i + 1))
				return
			}
			c.Cancel(int64(i + 1))
		}(i)
	}
	for ownerID := int64(1); ownerID <= 2; ownerID++ {
		race.Add(1)
		go func(ownerID int64) {
			defer race.Done()
			<-start
			c.CancelOwner(ownerID)
		}(ownerID)
	}
	close(start)
	race.Wait()

	c.CancelOwner(1)
	c.CancelOwner(2)
	if got := c.CancelOwner(1) + c.CancelOwner(2); got != 0 {
		t.Fatalf("entries remained after final cancellation: %d", got)
	}
	for i := range total {
		if got := calls[i].Load(); got > 1 {
			t.Fatalf("generation %d cancelled %d times", i+1, got)
		}
		if got := extraCalls[i].Load(); got > 1 {
			t.Fatalf("concurrent generation %d cancelled %d times", total+i+1, got)
		}
	}
}

func TestPolicyFromUsesBudgetTotalPlusFinalizeMargin(t *testing.T) {
	t.Parallel()
	cfg, err := config.LoadEnv(func(k string) string {
		if k == "VC_MODE" {
			return "full"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	p := PolicyFrom(cfg)
	if p.GenerationLease != cfg.Budget.TotalTimeout+30*time.Second {
		t.Fatalf("lease %s", p.GenerationLease)
	}
	if p.ClaimLimit != cfg.Concurrency.ClaimLimit {
		t.Fatalf("claim %d", p.ClaimLimit)
	}
	if p.MaxConcurrentTurns != cfg.Concurrency.MaxConcurrentTurns {
		t.Fatalf("concurrent turns %d", p.MaxConcurrentTurns)
	}
	if p.ProviderID != cfg.Provider.ID || p.SupplierName != cfg.Provider.SupplierName || p.ModelID != cfg.Provider.Model {
		t.Fatalf("provider identity %+v", p)
	}
}

func TestNamedPlanesDoNotStartWork(t *testing.T) {
	t.Parallel()
	for _, p := range []namedPlane{ProviderPlane(), RealtimePlane(), GenerationWorkerPlane()} {
		if err := p.Start(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err := p.Stop(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
}
