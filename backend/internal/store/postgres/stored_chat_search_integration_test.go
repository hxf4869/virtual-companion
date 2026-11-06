//go:build integration

package postgres

import (
	"context"
	"errors"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestStoredChatSparseSearchBudget(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 20000)
	s := testEnv.store
	ctx := context.Background()
	err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		start := time.Now()
		_, epoch, err := lockChatAuthority(ctx, tx, 1, false)
		if err != nil {
			return err
		}
		_, err = s.readStoredChat(ctx, tx, 1, c.ChatID, epoch)
		if err != nil {
			return err
		}
		t.Logf("read fence %s", time.Since(start))
		keys, err := s.storedMessageKeys(ctx, tx, 1, c.ChatID, nil, false, false, "needle", 1)
		t.Logf("bounded search elapsed=%s count=%d err=%v context=%v", time.Since(start), len(keys), err, ctx.Err())
		if err != nil {
			return err
		}
		ms, err := s.loadStoredMessagePage(ctx, tx, 1, c.ChatID, keys, "display", false)
		t.Logf("load page elapsed=%s count=%d err=%v context=%v", time.Since(start), len(ms), err, ctx.Err())
		if err != nil {
			return err
		}
		if len(keys) != 1 || keys[0].ID != syntheticMessageID(19999) || len(ms) != 1 {
			return errors.New("sparse search returned an incomplete page")
		}
		bound := keys[0].Position
		older, err := s.storedMessageKeys(ctx, tx, 1, c.ChatID, &bound, false, false, "needle", 1)
		t.Logf("older search elapsed=%s count=%d err=%v context=%v", time.Since(start), len(older), err, ctx.Err())
		if err == nil && (len(older) != 1 || older[0].ID != syntheticMessageID(1)) {
			return errors.New("sparse search missed the oldest match")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Exercise the full page API: no match must scan all selected encrypted bodies,
// while retaining only one bounded scan window. Keep timing and heap sampling
// separate because ReadMemStats itself pauses the runtime briefly.
func TestStoredChatNoHitSearchBudget(t *testing.T) {
	const (
		rows      = 20000
		bodyBytes = 2048
		samples   = 20
		heapLimit = 16 << 20
	)
	c := storedChatFixture(t)
	seedStoredHistoryWithMessageBytes(t, c, rows, bodyBytes)
	query := func() error {
		page, err := testEnv.store.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{
			Q: "absent-synthetic-search-marker", View: "display", Limit: 50,
		})
		if err != nil {
			return err
		}
		if len(page.Items) != 0 || page.HasOlder || page.HasNewer || page.BeforeCursor != nil || page.AfterCursor != nil {
			return errors.New("no-hit search returned content or a partial search cursor")
		}
		return nil
	}
	if err := query(); err != nil { // Warm connection/plans, excluded from samples.
		t.Fatal(err)
	}
	runtime.GC()
	durations := make([]time.Duration, samples)
	for i := range durations {
		start := time.Now()
		if err := query(); err != nil {
			t.Fatalf("no-hit page sample %d: %v", i+1, err)
		}
		durations[i] = time.Since(start)
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	p95 := durations[(samples*95+99)/100-1]
	// The existing store transaction timeout remains the latency ceiling. This
	// server-only sample makes no claim about front-end/MB2 history visibility.
	if p95 >= 8*time.Second {
		t.Fatalf("no-hit page P95 %s exceeds existing 8s transaction budget", p95)
	}
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	done := make(chan struct{})
	peakResult := make(chan uint64, 1)
	go func() {
		ticker := time.NewTicker(2 * time.Millisecond)
		defer ticker.Stop()
		peak := before.HeapAlloc
		for {
			select {
			case <-done:
				var end runtime.MemStats
				runtime.ReadMemStats(&end)
				peakResult <- max(peak, end.HeapAlloc)
				return
			case <-ticker.C:
				var current runtime.MemStats
				runtime.ReadMemStats(&current)
				peak = max(peak, current.HeapAlloc)
			}
		}
	}()
	err := query()
	close(done)
	peak := <-peakResult
	if err != nil {
		t.Fatal(err)
	}
	delta := peak - before.HeapAlloc
	t.Logf("no_hit rows=%d selected_body_bytes=%d timing_samples=%d store_page_p50=%s store_page_p95=%s latency_ceiling=8s heap_base_bytes=%d sampled_heap_peak_bytes=%d heap_increment_bytes=%d heap_increment_limit_bytes=%d heap_sample_period=2ms", rows, bodyBytes, samples, durations[samples/2], p95, before.HeapAlloc, peak, delta, heapLimit)
	if delta > heapLimit {
		t.Fatalf("no-hit scan heap increment %d exceeds %d bytes", delta, heapLimit)
	}
}
