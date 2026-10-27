package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
)

// sseWriter bounds every socket write of one SSE stream. A subscriber that
// stops draining blocks its handler inside the kernel write path; the hub
// queue overflow only removes the subscriber from fan-out and cannot release
// that blocked write. arming a fresh write deadline per frame does: the write
// fails, the handler returns, and the response finish path also fails so the
// connection is closed. The deadline is cleared again before the handler goes
// back to waiting for events, so provider idle gaps never inherit a stale
// deadline, and each connection's handler is independent, so one stalled
// stream cannot limit another.
type sseWriter struct {
	w       http.ResponseWriter
	rc      *http.ResponseController
	timeout time.Duration
}

func (s *Server) newSSEWriter(w http.ResponseWriter) (*sseWriter, error) {
	sw := &sseWriter{
		w:       w,
		rc:      http.NewResponseController(w),
		timeout: s.cfg.HTTP.SSEWriteTimeout,
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	if err := sw.arm(); err != nil {
		return nil, err
	}
	w.WriteHeader(http.StatusOK)
	if err := sw.rc.Flush(); err != nil {
		return nil, err
	}
	return sw, nil
}

func (sw *sseWriter) arm() error {
	return sw.rc.SetWriteDeadline(time.Now().Add(sw.timeout))
}

// disarm lifts the write deadline while the handler waits for the next event.
func (sw *sseWriter) disarm() {
	_ = sw.rc.SetWriteDeadline(time.Time{})
}

// finish re-arms the deadline for the response close path (terminal chunk,
// buffered trailer) so a subscriber that stops reading right after the last
// frame cannot pin the connection goroutine either.
func (sw *sseWriter) finish() {
	_ = sw.arm()
}

func (sw *sseWriter) write(ev realtime.Event) error {
	if err := sw.arm(); err != nil {
		return err
	}
	if err := realtime.Write(sw.w, ev); err != nil {
		return err
	}
	err := sw.rc.Flush()
	if err == nil {
		sw.disarm()
	}
	return err
}

func (sw *sseWriter) writeAll(evs []realtime.Event) error {
	for _, ev := range evs {
		if err := sw.write(ev); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleRealtimeStream(w http.ResponseWriter, r *http.Request) {
	// Browsers omit Origin on a normal same-origin GET. Credentialed
	// cross-origin fetches include it, so validate every present Origin while
	// allowing the empty case to continue through opaque-cookie authentication
	// and the owner-scoped snapshot lookup.
	origin := r.Header.Get("Origin")
	if origin != "" && !auth.AllowOrigin(origin, s.cfg.HTTP.AllowedOrigins) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "origin rejected")
		return
	}
	token := auth.CookieToken(r)
	if token == "" {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return
	}
	principal, err := s.realtime.Sessions.Lookup(r.Context(), token)
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if principal == nil || principal.AccountID <= 0 {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "authentication required")
		return
	}

	gid := r.PathValue("generationId")
	if !validGenerationID(gid) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}

	snap, ok, err := s.realtime.Snapshots.Load(r.Context(), principal.AccountID, gid)
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}

	sub, err := s.realtime.Hub.Subscribe(gid)
	if errors.Is(err, realtime.ErrTooMany) {
		w.Header().Set("Retry-After", "1")
		s.writeAPIError(w, http.StatusTooManyRequests, "RATE_LIMITED", "subscriber limit reached")
		return
	}
	if errors.Is(err, realtime.ErrNotFound) {
		s.realtime.Hub.RecordSnapshotResume()
		s.writeSnapshotStream(w, snap)
		return
	}
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	defer sub.Close()

	sw, err := s.newSSEWriter(w)
	if err != nil {
		return
	}
	defer sw.finish()
	var terminal companion.PublicEvent
	for {
		ev, ok := sub.Recv(r.Context())
		if !ok {
			break
		}
		if ev.Terminal() {
			terminal = ev.Name
			break
		}
		if sw.write(ev) != nil {
			return
		}
	}
	if terminal == "" {
		return
	}
	committed, found, loadErr := s.realtime.Snapshots.Load(r.Context(), principal.AccountID, gid)
	if loadErr == nil && found {
		if sw.writeAll(realtime.SnapshotEvents(committed.Text)) != nil {
			return
		}
	}
	_ = sw.write(realtime.Named(terminal))
}

func (s *Server) writeSnapshotStream(w http.ResponseWriter, snap realtime.Snapshot) {
	sw, err := s.newSSEWriter(w)
	if err != nil {
		return
	}
	defer sw.finish()
	if sw.writeAll(realtime.SnapshotEvents(snap.Text)) != nil {
		return
	}
	if snap.Terminal != "" {
		_ = sw.write(realtime.Named(snap.Terminal))
	}
}

func (s *Server) writeAPIError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "message": message})
}

func validGenerationID(id string) bool {
	if len(id) < 1 || len(id) > 19 {
		return false
	}
	if id[0] == '0' {
		return false
	}
	for i := 0; i < len(id); i++ {
		if id[i] < '0' || id[i] > '9' {
			return false
		}
	}
	return true
}
