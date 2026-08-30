package realtime

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

var (
	// ErrNotFound means no in-process hub entry. Callers must use the durable snapshot.
	ErrNotFound = errors.New("realtime: hub not found")
	// ErrTooMany means this generation already has MaxSubscribers live subscribers.
	ErrTooMany = errors.New("realtime: subscriber limit")
)

const defaultTTL = 2 * time.Second

// Stats is a low-cardinality hub snapshot. No owner or generation id.
type Stats struct {
	Subscribers     int64
	SlowDisconnects uint64
	SnapshotResumes uint64
}

// Hub fans out reviewed public events to per-subscriber bounded queues.
// One mutex protects in-memory state and enqueue; it never wraps socket
// writes, provider I/O, or database calls.
type Hub struct {
	TTL time.Duration

	mu              sync.Mutex
	gens            map[string]*generation
	subscribers     atomic.Int64
	slowDisconnects atomic.Uint64
	snapshotResumes atomic.Uint64
}

type generation struct {
	acc    string
	subs   []*Sub
	closed bool
	term   companion.PublicEvent
	expire *time.Timer
}

// Sub is one subscriber. Recv/Close run outside the hub mutex.
type Sub struct {
	h        *Hub
	gid      string
	catchup  []Event
	catchIdx int
	live     chan Event
	queued   atomic.Int64
	closed   bool
	released bool
}

// New returns an empty hub. Idle conversations have no entry.
func New() *Hub {
	return &Hub{
		TTL:  defaultTTL,
		gens: make(map[string]*generation),
	}
}

func (h *Hub) Stats() Stats {
	if h == nil {
		return Stats{}
	}
	return Stats{
		Subscribers:     h.subscribers.Load(),
		SlowDisconnects: h.slowDisconnects.Load(),
		SnapshotResumes: h.snapshotResumes.Load(),
	}
}

// RecordSnapshotResume counts reconnects that used the durable snapshot path.
func (h *Hub) RecordSnapshotResume() {
	if h != nil {
		h.snapshotResumes.Add(1)
	}
}

func (h *Hub) Exists(id string) bool {
	if h == nil || id == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	_, ok := h.gens[id]
	return ok
}

func (h *Hub) Accumulator(id string) string {
	if h == nil {
		return ""
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil {
		return ""
	}
	return g.acc
}

func (h *Hub) LiveSubscribers(id string) int {
	if h == nil {
		return 0
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil {
		return 0
	}
	n := 0
	for _, s := range g.subs {
		if s != nil && !s.closed {
			n++
		}
	}
	return n
}

func (h *Hub) ttl() time.Duration {
	if h.TTL > 0 {
		return h.TTL
	}
	return defaultTTL
}

func (h *Hub) ensureLocked(id string) *generation {
	g := h.gens[id]
	if g == nil {
		g = &generation{}
		h.gens[id] = g
	}
	return g
}

// Accepted creates the hub entry for an active generation and fans out chat.accepted.
func (h *Hub) Accepted(id string) {
	if h == nil || id == "" {
		return
	}
	ev := newEvent(companion.EventAccepted, "")
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.ensureLocked(id)
	if g.closed {
		return
	}
	g.fanout(h, ev)
}

// Append adds a reviewed delta to the single accumulator and enqueues it.
func (h *Hub) Append(id, text string) {
	if h == nil || id == "" || text == "" {
		return
	}
	chunks := splitNamed(companion.EventDelta, text)
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil || g.closed {
		return
	}
	for _, ev := range chunks {
		next := g.acc + ev.Text
		if len(next) > MaxAccumulatorBytes {
			trimmed := companion.ClampUTF8(next, MaxAccumulatorBytes)
			if len(trimmed) <= len(g.acc) {
				return
			}
			ev = newEvent(companion.EventDelta, trimmed[len(g.acc):])
			g.acc = trimmed
			g.fanout(h, ev)
			return
		}
		g.acc = next
		g.fanout(h, ev)
	}
}

func (h *Hub) Completed(id string) { h.finish(id, companion.EventCompleted, false) }
func (h *Hub) Blocked(id string)   { h.finish(id, companion.EventBlocked, true) }
func (h *Hub) Failed(id string)    { h.finish(id, companion.EventFailed, true) }
func (h *Hub) Cancelled(id string) { h.finish(id, companion.EventCancelled, true) }

func (h *Hub) finish(id string, name companion.PublicEvent, clear bool) {
	if h == nil || id == "" {
		return
	}
	ev := newEvent(name, "")
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil || g.closed {
		return
	}
	if clear {
		g.acc = ""
	}
	g.closed = true
	g.term = name
	g.fanout(h, ev)
	for _, s := range g.subs {
		s.closeLive()
	}
	g.subs = nil
	if g.expire != nil {
		g.expire.Stop()
	}
	ttl := h.ttl()
	g.expire = time.AfterFunc(ttl, func() { h.dropGen(id) })
}

func (h *Hub) dropGen(id string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil || !g.closed {
		return
	}
	delete(h.gens, id)
}

// Subscribe joins fan-out. Catch-up snapshot is copied under the same mutex
// before the subscriber is added, so snapshot vs later deltas stay ordered.
func (h *Hub) Subscribe(id string) (*Sub, error) {
	if h == nil || id == "" {
		return nil, ErrNotFound
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	g := h.gens[id]
	if g == nil {
		return nil, ErrNotFound
	}
	if !g.closed && len(g.subs) >= MaxSubscribers {
		return nil, ErrTooMany
	}
	s := &Sub{
		h:    h,
		gid:  id,
		live: make(chan Event, MaxQueueEvents),
	}
	s.catchup = snapshotEvents(g.acc)
	if g.closed {
		s.catchup = append(s.catchup, newEvent(g.term, ""))
		s.closed = true
		close(s.live)
		h.subscribers.Add(1)
		return s, nil
	}
	g.subs = append(g.subs, s)
	h.subscribers.Add(1)
	return s, nil
}

func (s *Sub) Recv(ctx context.Context) (Event, bool) {
	if s == nil {
		return Event{}, false
	}
	if s.catchIdx < len(s.catchup) {
		ev := s.catchup[s.catchIdx]
		s.catchIdx++
		return ev, true
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case ev, ok := <-s.live:
		if !ok {
			return Event{}, false
		}
		s.queued.Add(-int64(ev.Size()))
		return ev, true
	case <-ctx.Done():
		return Event{}, false
	}
}

func (s *Sub) Close() {
	if s == nil || s.h == nil {
		return
	}
	s.h.remove(s)
}

func (h *Hub) remove(s *Sub) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if s.released {
		return
	}
	s.released = true
	h.subscribers.Add(-1)
	s.closeLive()
	g := h.gens[s.gid]
	if g == nil {
		return
	}
	keep := g.subs[:0]
	for _, cur := range g.subs {
		if cur != s {
			keep = append(keep, cur)
		}
	}
	g.subs = keep
}

func (s *Sub) closeLive() {
	if s.closed {
		return
	}
	s.closed = true
	close(s.live)
}

func (g *generation) fanout(h *Hub, ev Event) {
	keep := g.subs[:0]
	for _, s := range g.subs {
		if s == nil || s.closed {
			continue
		}
		if s.queued.Load()+int64(ev.Size()) > MaxQueueBytes || len(s.live) >= MaxQueueEvents {
			g.disconnectSlow(h, s)
			continue
		}
		select {
		case s.live <- ev:
			s.queued.Add(int64(ev.Size()))
			keep = append(keep, s)
		default:
			g.disconnectSlow(h, s)
		}
	}
	g.subs = keep
}

func (g *generation) disconnectSlow(h *Hub, s *Sub) {
	if s.released {
		return
	}
	s.released = true
	h.subscribers.Add(-1)
	h.slowDisconnects.Add(1)
	s.closeLive()
}
