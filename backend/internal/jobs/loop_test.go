package jobs

import (
	"context"
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
	c.Register(7, func() {
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
	c.Unregister(7)
	if c.Cancel(7) {
		t.Fatal("unregistered cancel")
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
