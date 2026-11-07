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
	"github.com/jackc/pgx/v5/pgconn"
)

// Follow the continuation flag even on empty pages and verify ordered,
// duplicate-free results plus strictly advancing scanned-window boundaries.
func walkStoredSearch(t *testing.T, s *Store, chatID, query string, initial *StoredMessagePage, forward bool) (map[string]bool, StoredMessagePage, int, time.Duration) {
	t.Helper()
	seen := map[string]bool{}
	cursor := ""
	var prior int64
	if forward {
		prior = -1
	} else {
		prior = 1<<63 - 1
	}
	var page StoredMessagePage
	requests := 0
	start := time.Now()
	for {
		if requests > 300 {
			t.Fatal("search continuation did not terminate")
		}
		if initial != nil {
			page = *initial
			initial = nil
		} else {
			q := ChatMessageQuery{Q: query, Limit: 200}
			if forward {
				q.After = cursor
			} else {
				q.Before = cursor
			}
			var err error
			page, err = s.ListStoredMessages(context.Background(), 1, chatID, q)
			if err != nil {
				t.Fatal(err)
			}
			requests++
		}
		for i, m := range page.Items {
			if seen[m.MessageID] {
				t.Fatal("duplicate search result")
			}
			if i > 0 && page.Items[i-1].MessageID >= m.MessageID {
				t.Fatal("search results are not ascending")
			}
			seen[m.MessageID] = true
		}
		more, next := page.HasOlder, page.BeforeCursor
		if forward {
			more, next = page.HasNewer, page.AfterCursor
		}
		if !more {
			return seen, page, requests, time.Since(start)
		}
		if next == nil {
			t.Fatal("nonterminal search lost cursor")
		}
		c, err := s.decodeChatCursor(*next)
		if err != nil {
			t.Fatal(err)
		}
		if (forward && c.Position <= prior) || (!forward && c.Position >= prior) {
			t.Fatal("search cursor failed to progress")
		}
		prior = c.Position
		cursor = *next
	}
}

func TestStoredChatSparseSearchBudget(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 20001)
	s := testEnv.store
	oldTimeout := s.txTimeout
	s.txTimeout = 5 * time.Second
	defer func() { s.txTimeout = oldTimeout }()
	seen, first, backward, elapsed := walkStoredSearch(t, s, c.ChatID, "needle", nil, false)
	if len(seen) != 2 || !seen[syntheticMessageID(1)] || !seen[syntheticMessageID(20000)] {
		t.Fatal("sparse search missed selected matches")
	}
	forwardSeen, _, forward, forwardElapsed := walkStoredSearch(t, s, c.ChatID, "needle", &first, true)
	if len(forwardSeen) != 2 || !forwardSeen[syntheticMessageID(1)] || !forwardSeen[syntheticMessageID(20000)] {
		t.Fatal("forward sparse search missed selected matches")
	}
	if backward != 101 || forward != 100 {
		t.Fatalf("unbounded sparse traversal request count: backward=%d forward=%d", backward, forward)
	}
	t.Logf("sparse rows=20001 backward_requests=%d backward_total=%s forward_requests=%d forward_total=%s tx_timeout=5s gomaxprocs=%d", backward, elapsed, forward, forwardElapsed, runtime.GOMAXPROCS(0))
}

// Sample a single bounded page independently from complete traversal.
func TestStoredChatNoHitSearchBudget(t *testing.T) {
	const (
		rows      = 20000
		bodyBytes = 2048
		samples   = 20
		heapLimit = 16 << 20
	)
	c := storedChatFixture(t)
	seedStoredHistoryWithMessageBytes(t, c, rows, bodyBytes)
	s := testEnv.store
	oldTimeout := s.txTimeout
	s.txTimeout = 5 * time.Second
	defer func() { s.txTimeout = oldTimeout }()
	query := func() error {
		page, err := testEnv.store.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{
			Q: "absent-synthetic-search-marker", View: "display", Limit: 50,
		})
		if err != nil {
			return err
		}
		if len(page.Items) != 0 || !page.HasOlder || page.HasNewer || page.BeforeCursor == nil || page.AfterCursor == nil {
			return errors.New("no-hit search lost bounded continuation")
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
	if p95 >= 5*time.Second {
		t.Fatalf("no-hit page P95 %s exceeds production 5s transaction budget", p95)
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
	t.Logf("no_hit rows=%d selected_body_bytes=%d timing_samples=%d store_page_p50=%s store_page_p95=%s latency_ceiling=5s heap_base_bytes=%d sampled_heap_peak_bytes=%d heap_increment_bytes=%d heap_increment_limit_bytes=%d heap_sample_period=2ms", rows, bodyBytes, samples, durations[samples/2], p95, before.HeapAlloc, peak, delta, heapLimit)
	if delta > heapLimit {
		t.Fatalf("no-hit scan heap increment %d exceeds %d bytes", delta, heapLimit)
	}
	seen, first, backward, elapsed := walkStoredSearch(t, s, c.ChatID, "absent-synthetic-search-marker", nil, false)
	forwardSeen, _, forward, forwardElapsed := walkStoredSearch(t, s, c.ChatID, "absent-synthetic-search-marker", &first, true)
	if len(seen) != 0 || len(forwardSeen) != 0 || backward != 100 || forward != 99 {
		t.Fatalf("no-hit traversal: backward=%d forward=%d matches=%d/%d", backward, forward, len(seen), len(forwardSeen))
	}
	t.Logf("no_hit traversal_backward_requests=%d traversal_backward_total=%s traversal_forward_requests=%d traversal_forward_total=%s store_page_max=%s tx_timeout=5s gomaxprocs=%d", backward, elapsed, forward, forwardElapsed, durations[len(durations)-1], runtime.GOMAXPROCS(0))

}

func TestStoredChatSearchWindowProgress(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 20001)
	s := testEnv.store
	page, err := s.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{Q: "absent-marker"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 0 || !page.HasOlder || page.HasNewer || page.BeforeCursor == nil || page.AfterCursor == nil {
		t.Fatal("empty bounded search must retain continuation cursors")
	}
	before, err := s.decodeChatCursor(*page.BeforeCursor)
	if err != nil {
		t.Fatal(err)
	}
	after, err := s.decodeChatCursor(*page.AfterCursor)
	if err != nil {
		t.Fatal(err)
	}
	if before.Position != 19802 || after.Position != 20001 {
		t.Fatalf("search scanned beyond 200 documents: %d..%d", before.Position, after.Position)
	}
	next, err := s.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{Q: "absent-marker", Before: *page.BeforeCursor})
	if err != nil {
		t.Fatal(err)
	}
	nextBound, err := s.decodeChatCursor(*next.BeforeCursor)
	if err != nil {
		t.Fatal(err)
	}
	if nextBound.Position != 19602 {
		t.Fatalf("empty continuation failed to advance: %d", nextBound.Position)
	}

	err = s.withStoredChatRead(context.Background(), 1, true, func(ctx context.Context, tx pgx.Tx, _ int64) error {
		bound := int64(20001)
		anchor, err := s.searchStoredMessageWindow(ctx, tx, 1, c.ChatID, &bound, false, true, "synthetic", 200)
		if err != nil {
			return err
		}
		if len(anchor.keys) != 200 || *anchor.last != 19802 || *anchor.first != 20001 {
			return errors.New("anchor exceeded its shared 200-document window")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

}

func TestStoredChatSearchDeadline(t *testing.T) {
	c := storedChatFixture(t)
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	_, err := testEnv.store.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "needle"})
	expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
}

func TestStoredChatSearchByteClipPreservesMatches(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistoryWithMessageBytes(t, c, 24, 40000)
	for _, view := range []string{"display", "full"} {
		for _, direction := range []string{"before", "after"} {
			t.Run(view+"/"+direction, func(t *testing.T) {
				seen := map[string]bool{}
				cursor := ""
				for requests := 0; ; requests++ {
					if requests >= 24 {
						t.Fatal("byte-clipped search did not terminate")
					}
					q := ChatMessageQuery{Q: "synthetic", View: view, Limit: 200}
					if direction == "before" {
						q.Before = cursor
					} else if cursor == "" {
						q.AnchorMessageID = syntheticMessageID(1)
					} else {
						q.After = cursor
					}
					page, err := testEnv.store.ListStoredMessages(context.Background(), 1, c.ChatID, q)
					if err != nil {
						t.Fatal(err)
					}
					for _, m := range page.Items {
						if seen[m.MessageID] {
							t.Fatal("duplicate search match")
						}
						seen[m.MessageID] = true
					}
					more, next := page.HasOlder, page.BeforeCursor
					if direction == "after" {
						more, next = page.HasNewer, page.AfterCursor
					}
					if !more {
						break
					}
					if next == nil || *next == cursor {
						t.Fatal("search cursor did not advance")
					}
					cursor = *next
				}
				if len(seen) != 24 {
					t.Fatalf("byte clipping skipped matches: got %d", len(seen))
				}
			})
		}
	}
}

func TestStoredChatSearchAnchorChecksOnlySelectedDocument(t *testing.T) {
	c := storedChatFixture(t)
	seedStoredHistory(t, c, 3)
	// An older corrupt body must not be consulted to reject this nonmatch.
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.stored_candidate SET data_cipher='enc2:invalid' WHERE owner_user_id=1 AND chat_id=$1 AND message_id=$2`, c.ChatID, syntheticMessageID(1)); err != nil {
		t.Fatal(err)
	}
	_, err := testEnv.store.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{Q: "absent-marker", AnchorMessageID: syntheticMessageID(3)})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("nonmatching anchor searched older bodies: %v", err)
	}
}

func TestStoredChatSearchDeadlineDuringWorkAndCommit(t *testing.T) {
	s := testEnv.store
	storedChatFixture(t)
	for _, stage := range []string{"work", "commit"} {
		t.Run(stage, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			err := s.withStoredChatRead(ctx, 1, true, func(ctx context.Context, tx pgx.Tx, _ int64) error {
				if stage == "work" {
					_, err := tx.Exec(ctx, "SELECT pg_sleep(1)")
					return err
				}
				<-ctx.Done()
				return nil
			})
			expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
		})
	}
}

func TestStoredChatSearchCiphertextBudget(t *testing.T) {
	for _, tc := range []struct {
		name             string
		count, bodyBytes int
	}{
		{"bounded", 32, 400000}, {"oversized-first", 2, 7 << 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := storedChatFixture(t)
			seedStoredHistoryWithMessageBytes(t, c, tc.count, tc.bodyBytes)
			page, err := testEnv.store.ListStoredMessages(context.Background(), 1, c.ChatID, ChatMessageQuery{Q: "absent-marker"})
			if err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != 0 || !page.HasOlder || page.BeforeCursor == nil || page.AfterCursor == nil {
				t.Fatal("ciphertext budget lost continuation")
			}
			first, err := testEnv.store.decodeChatCursor(*page.BeforeCursor)
			if err != nil {
				t.Fatal(err)
			}
			if tc.name == "oversized-first" {
				if first.Position != int64(tc.count) {
					t.Fatal("oversized first candidate did not advance alone")
				}
				return
			}
			var scannedBytes, nextBytes int64
			err = testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
				return tx.QueryRow(ctx, `SELECT coalesce(sum(octet_length(c.data_cipher)) FILTER(WHERE m.position >= $3),0),coalesce(max(octet_length(c.data_cipher)) FILTER(WHERE m.position=$3-1),0)
    FROM vc.stored_message m JOIN vc.stored_candidate c ON(c.owner_user_id,c.chat_id,c.message_id,c.candidate_id)=(m.owner_user_id,m.chat_id,m.message_id,m.selected_candidate_id)
    WHERE m.owner_user_id=1 AND m.chat_id=$1 AND m.position <= $2`, c.ChatID, tc.count, first.Position).Scan(&scannedBytes, &nextBytes)
			})
			if err != nil {
				t.Fatal(err)
			}
			if scannedBytes > storedChatSearchBytes || scannedBytes+nextBytes <= storedChatSearchBytes {
				t.Fatalf("wrong ciphertext scan window: bytes=%d next=%d", scannedBytes, nextBytes)
			}
		})
	}
}

func TestStoredChatSearchDeadlineDuringOwnerBinding(t *testing.T) {
	c := storedChatFixture(t)
	conn, err := pgx.Connect(context.Background(), testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "LOCK TABLE vc._owner_binding_secret IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err = testEnv.store.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "needle"})
	expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
}

func TestStoredChatSearchStatementTimeout(t *testing.T) {
	storedChatFixture(t)
	err := testEnv.store.withStoredChatRead(context.Background(), 1, true, func(ctx context.Context, tx pgx.Tx, _ int64) error {
		if _, err := tx.Exec(ctx, "SET LOCAL statement_timeout='20ms'"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "SELECT pg_sleep(1)")
		return err
	})
	expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
}

func TestStoredChatSearchStatementTimeoutDuringOwnerBinding(t *testing.T) {
	c := storedChatFixture(t)
	s, err := Open(context.Background(), OpenConfig{
		DSN:      testEnv.runtimeDSN + "&statement_timeout=200ms",
		MaxConns: 1, TxTimeout: 5 * time.Second, OwnerBindingSecret: testOwnerBindingSecret,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	conn, err := pgx.Connect(context.Background(), testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(context.Background(), "LOCK TABLE vc._owner_binding_secret IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = s.ListStoredMessages(ctx, 1, c.ChatID, ChatMessageQuery{Q: "needle"})
	if ctx.Err() != nil {
		t.Fatal("expected PostgreSQL statement timeout before Go deadline")
	}
	expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
	// Other API callers still see the fail-closed sentinel, with only a safe
	// timeout cause: no PostgreSQL message, detail or binding inputs escape.
	err = s.WithOwner(ctx, 1, func(context.Context, pgx.Tx) error {
		t.Fatal("timed-out binding reached owner work")
		return nil
	})
	if !errors.Is(err, ErrOwnerContextRejected) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("binding timeout lost safe sentinel/cause: %v", err)
	}
	if err.Error() != ErrOwnerContextRejected.Error()+": "+context.DeadlineExceeded.Error() {
		t.Fatal("binding timeout leaked extra error details")
	}
}

// pgx can expose a server error only while Close drains the unread results.
// Embed the interfaces to keep this fault injection limited to methods used by
// this single-window query; owner binding and commit still use the real DB.
type storedSearchCloseErrorRows struct {
	pgx.Rows
	encrypted               string
	served, scanned, closed bool
}

func (r *storedSearchCloseErrorRows) Next() bool {
	if r.served {
		r.Close()
		return false
	}
	r.served = true
	return true
}
func (r *storedSearchCloseErrorRows) Scan(dest ...any) error {
	*dest[0].(*string) = syntheticMessageID(1)
	*dest[1].(*int64) = 1
	*dest[2].(*string) = r.encrypted
	r.scanned = true
	return nil
}
func (r *storedSearchCloseErrorRows) Close() { r.closed = true }
func (r *storedSearchCloseErrorRows) Err() error {
	if r.closed {
		return &pgconn.PgError{Code: "57014", Message: "synthetic statement timeout"}
	}
	return nil
}

type storedSearchCloseErrorTx struct {
	pgx.Tx
	rows *storedSearchCloseErrorRows
}

func (tx storedSearchCloseErrorTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return tx.rows, nil
}

func TestStoredChatSearchCloseTimeoutAfterFirstMatch(t *testing.T) {
	c := storedChatFixture(t)
	s := testEnv.store
	encrypted, err := s.encodeChatJSON(ChatData{"mes": "synthetic needle"})
	if err != nil {
		t.Fatal(err)
	}
	rows := &storedSearchCloseErrorRows{encrypted: encrypted}
	err = s.withStoredChatRead(context.Background(), 1, true, func(ctx context.Context, tx pgx.Tx, _ int64) error {
		window, err := s.searchStoredMessageWindow(ctx, storedSearchCloseErrorTx{Tx: tx, rows: rows}, 1, c.ChatID, nil, false, false, "needle", 1)
		if len(window.keys) != 1 || !rows.scanned {
			t.Fatal("fault must occur after the first match filled the page")
		}
		return err
	})
	expectChatCode(t, err, "CHAT_SEARCH_TIMEOUT")
}
