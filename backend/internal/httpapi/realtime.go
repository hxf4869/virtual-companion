package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
)

func (s *Server) handleRealtimeStream(w http.ResponseWriter, r *http.Request) {
	if !auth.AllowOrigin(r.Header.Get("Origin"), s.cfg.HTTP.AllowedOrigins) {
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
		s.writeAPIError(w, http.StatusTooManyRequests, "INVALID_REQUEST", "subscriber limit reached")
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

	flusher := writeSSEHeaders(w)
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
		if err := realtime.Write(w, ev); err != nil {
			return
		}
		flush(flusher)
	}
	if terminal == "" {
		return
	}
	committed, found, loadErr := s.realtime.Snapshots.Load(r.Context(), principal.AccountID, gid)
	if loadErr == nil && found {
		writeEvents(w, flusher, realtime.SnapshotEvents(committed.Text))
	}
	_ = realtime.Write(w, realtime.Named(terminal))
	flush(flusher)
}

func (s *Server) writeSnapshotStream(w http.ResponseWriter, snap realtime.Snapshot) {
	flusher := writeSSEHeaders(w)
	writeEvents(w, flusher, realtime.SnapshotEvents(snap.Text))
	if snap.Terminal != "" {
		_ = realtime.Write(w, realtime.Named(snap.Terminal))
		flush(flusher)
	}
}

func writeSSEHeaders(w http.ResponseWriter) http.Flusher {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	flush(flusher)
	return flusher
}

func writeEvents(w http.ResponseWriter, flusher http.Flusher, evs []realtime.Event) {
	for _, ev := range evs {
		if err := realtime.Write(w, ev); err != nil {
			return
		}
		flush(flusher)
	}
}

func flush(f http.Flusher) {
	if f != nil {
		f.Flush()
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
