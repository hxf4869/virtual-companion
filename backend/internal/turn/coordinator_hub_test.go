package turn

import (
	"context"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/safety"
)

func TestCoordinatorFansOutReviewedDeltas(t *testing.T) {
	t.Parallel()
	hub := realtime.New()
	p := &scripted{
		deltas: []string{"听起来你今天真的很累。"},
		result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 8, OutputTokens: 6, TotalTokens: 14}},
	}
	c, _, _ := newCoord(t, p, baseSeed())
	c.Hub = hub
	hub.Accepted("turn-1")
	sub, err := hub.Subscribe("turn-1")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-hub", Budget: budget()})
	if res.Public != companion.EventCompleted {
		t.Fatalf("%+v", res)
	}
	if hub.Accumulator("turn-1") != "听起来你今天真的很累。" {
		t.Fatalf("acc %q", hub.Accumulator("turn-1"))
	}
	evs := drainSub(t, sub)
	var sawCompleted bool
	for _, ev := range evs {
		if ev.Name == companion.EventCompleted {
			sawCompleted = true
		}
	}
	if !sawCompleted {
		t.Fatalf("events %+v", evs)
	}
}

func TestCoordinatorBlockedClearsHubDraft(t *testing.T) {
	t.Parallel()
	hub := realtime.New()
	p := &scripted{
		deltas: []string{"今天天气不错。", "其实我是真人。"},
		result: companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{TotalTokens: 4}},
	}
	store := NewMemStore()
	store.PutSeed(baseSeed())
	c := &Coordinator{Store: store, Provider: p, Policy: safety.New(), Hub: hub}
	hub.Accepted("turn-1")
	sub, err := hub.Subscribe("turn-1")
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Close()
	res := c.Run(context.Background(), Command{TurnID: "turn-1", RunID: "run-block", Budget: budget()})
	if res.Public != companion.EventBlocked {
		t.Fatalf("%+v", res)
	}
	if hub.Accumulator("turn-1") != "" {
		t.Fatal("blocked left partial in hub")
	}
	evs := drainSub(t, sub)
	var sawBlocked bool
	for _, ev := range evs {
		if ev.Name == companion.EventBlocked {
			sawBlocked = true
		}
		if ev.Name == companion.EventCompleted {
			t.Fatal("completed after safety fail")
		}
	}
	if !sawBlocked {
		t.Fatalf("%+v", evs)
	}
}

func drainSub(t *testing.T, sub *realtime.Sub) []realtime.Event {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var out []realtime.Event
	for {
		ev, ok := sub.Recv(ctx)
		if !ok {
			break
		}
		out = append(out, ev)
		if ev.Terminal() {
			break
		}
	}
	return out
}
