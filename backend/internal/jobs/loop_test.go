package jobs

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/notify"
)

func TestCancelsInvokesRegisteredFunc(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	var n atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	c.Register(KindGeneration, 1, 7, func() {
		n.Add(1)
		cancel()
	})
	if !c.Cancel(KindGeneration, 7) {
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
	if c.Cancel(KindGeneration, 7) {
		t.Fatal("cancel must only report the first signal")
	}
	if n.Load() != 1 {
		t.Fatalf("calls after repeated cancel %d", n.Load())
	}
	c.Unregister(KindGeneration, 7)
}

func TestCancelsCancelOwnerIsIsolatedAndIdempotent(t *testing.T) {
	t.Parallel()
	c := NewCancels()
	ownerA1, cancelA1 := context.WithCancel(context.Background())
	ownerA2, cancelA2 := context.WithCancel(context.Background())
	ownerB, cancelB := context.WithCancel(context.Background())
	c.Register(KindGeneration, 1, 11, cancelA1)
	c.Register(KindGeneration, 1, 12, cancelA2)
	c.Register(KindGeneration, 2, 21, cancelB)

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
			c.Register(KindGeneration, ownerID, int64(i+1), func() { calls[i].Add(1) })
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
				c.Register(KindGeneration, ownerID, int64(total+i+1), func() { extraCalls[i].Add(1) })
				c.Unregister(KindGeneration, int64(i+1))
				return
			}
			c.Cancel(KindGeneration, int64(i+1))
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
	if p.HoldReservationMaxAge != HoldReservationMaxAge(cfg.Budget.TotalTimeout) {
		t.Fatalf("hold sweep age %s", p.HoldReservationMaxAge)
	}
}

func TestNotificationSendingSweepAgeUsesChannelTimeout(t *testing.T) {
	t.Parallel()
	if notify.DefaultSendTimeout != 10*time.Second {
		t.Fatalf("channel timeout %s", notify.DefaultSendTimeout)
	}
	if got := NotificationSendingSweepAge(); got != notify.DefaultSendTimeout+holdReservationMargin {
		t.Fatalf("sweep age %s", got)
	}
	if got := NotificationSendingSweepAge(); got != 40*time.Second {
		t.Fatalf("sweep age %s", got)
	}
}

func TestRecoverOnceRecordsStaleNotificationSending(t *testing.T) {
	t.Parallel()
	store := newSchedulerTestStore()
	store.notificationSweepN = 2
	var buf bytes.Buffer
	loop := NewLoop(slog.New(slog.NewTextHandler(&buf, nil)), testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, nil)
	if err := loop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	ages := append([]time.Duration(nil), store.notificationSweepAges...)
	store.mu.Unlock()
	if len(ages) != 1 || ages[0] != NotificationSendingSweepAge() {
		t.Fatalf("sweep ages %+v", ages)
	}
	if got := loop.Stats().Recoveries; got != 2 {
		t.Fatalf("recoveries %d", got)
	}
	if !strings.Contains(buf.String(), "decision_code="+NotificationSendingUnknown) || strings.Contains(buf.String(), "planted-pass") {
		t.Fatalf("log %s", buf.String())
	}

	quiet := newSchedulerTestStore()
	var quietBuf bytes.Buffer
	quietLoop := NewLoop(slog.New(slog.NewTextHandler(&quietBuf, nil)), testLoopPolicy(1), testTurnBudget())
	quietLoop.Use(quiet, nil, nil, nil)
	if err := quietLoop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(quietBuf.String(), NotificationSendingUnknown) {
		t.Fatalf("empty sweep logged %s", quietBuf.String())
	}

	failing := newSchedulerTestStore()
	failing.notificationSweepErr = errors.New("synthetic unavailable")
	var failBuf bytes.Buffer
	failLoop := NewLoop(slog.New(slog.NewTextHandler(&failBuf, nil)), testLoopPolicy(1), testTurnBudget())
	failLoop.Use(failing, nil, nil, nil)
	if err := failLoop.RecoverOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	failing.mu.Lock()
	held := len(failing.sweptAges)
	failing.mu.Unlock()
	if held != 1 {
		t.Fatalf("hold sweep did not run after notification sweep error")
	}
	text := failBuf.String()
	if !strings.Contains(text, "error_code=RECOVER_FAILED") || strings.Contains(text, "decision_code="+NotificationSendingUnknown) || strings.Contains(text, "synthetic unavailable") {
		t.Fatalf("error log %s", text)
	}
}

func TestHoldReservationMaxAgeUsesLongestCall(t *testing.T) {
	t.Parallel()
	// Defaults: foreground 240s, tool 120s, memory ExtractTotal 5m30s, plus 30s.
	if got := HoldReservationMaxAge(240 * time.Second); got != 6*time.Minute {
		t.Fatalf("default age %s", got)
	}
	if got := HoldReservationMaxAge(10 * time.Minute); got != 10*time.Minute+30*time.Second {
		t.Fatalf("raised foreground age %s", got)
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
