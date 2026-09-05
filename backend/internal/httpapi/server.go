package httpapi

import (
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/realtime"
)

const maxBodyBytes = 1 << 20

type Probes interface {
	Live() bool
	Ready() bool
}

// Realtime is the G6 SSE surface. All three fields are required to register
// the stream route. companiond leaves this nil until generation cutover.
type Realtime struct {
	Hub       *realtime.Hub
	Sessions  auth.Sessions
	Snapshots realtime.Snapshots
}

type Server struct {
	cfg      config.Config
	log      *slog.Logger
	probes   Probes
	metrics  *observability.Registry
	mux      *http.ServeMux
	realtime *Realtime
	core     *Core
}

func New(cfg config.Config, log *slog.Logger, probes Probes, metrics *observability.Registry, rt *Realtime, core *Core) *Server {
	if log == nil {
		log = observability.NewLogger(cfg.Log.Level, nil)
	}
	s := &Server{
		cfg:      cfg,
		log:      log,
		probes:   probes,
		metrics:  metrics,
		mux:      http.NewServeMux(),
		realtime: rt,
	}
	s.mux.HandleFunc("GET /actuator/health", s.handleHealth)
	s.mux.HandleFunc("GET /actuator/health/liveness", s.handleLiveness)
	s.mux.HandleFunc("GET /actuator/health/readiness", s.handleReadiness)
	s.mux.HandleFunc("GET /actuator/prometheus", s.handlePrometheus)
	s.mux.HandleFunc("GET /api/v1/version", s.handleVersion)
	if rt != nil && rt.Hub != nil && rt.Sessions != nil && rt.Snapshots != nil {
		s.mux.HandleFunc("GET /api/v1/realtime/streams/{generationId}", s.handleRealtimeStream)
		if metrics != nil {
			metrics.SetRealtimeStatsSource(func() observability.RealtimeStats {
				st := rt.Hub.Stats()
				return observability.RealtimeStats{
					Subscribers:     st.Subscribers,
					SlowDisconnects: st.SlowDisconnects,
					SnapshotResumes: st.SnapshotResumes,
				}
			})
		}
	}
	// Phase 4: writers stay off in api-migration. Isolation/cutover uses full.
	// G9 opaque auth is registered only with those writers; production traffic
	// is not switched here.
	if core != nil && core.Store != nil && core.Sessions != nil && cfg.AllowsWrites() {
		s.core = core
		if s.core.Limiter == nil {
			s.core.Limiter = auth.NewLimiter()
		}
		s.registerCore()
	}
	return s
}

func (s *Server) Handler() http.Handler {
	return http.MaxBytesHandler(http.HandlerFunc(s.serve), maxBodyBytes)
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	requestID := requestIDFrom(r)
	w.Header().Set("X-Request-Id", requestID)
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	s.mux.ServeHTTP(rec, r)
	op := operation(r.URL.Path)
	s.metrics.ObserveHTTP(op, r.Method, rec.status, time.Since(start))
	if quiet(op) {
		s.log.Debug("http",
			slog.String("request_id", requestID),
			slog.String("operation", op),
			slog.String("outcome", httpOutcome(rec.status)),
			slog.Int("duration_ms", int(time.Since(start).Milliseconds())),
		)
		return
	}
	s.log.Info("http",
		slog.String("request_id", requestID),
		slog.String("operation", op),
		slog.String("outcome", httpOutcome(rec.status)),
		slog.Int("duration_ms", int(time.Since(start).Milliseconds())),
	)
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	// Overall health matches current Caddy/docker probe: process is serving.
	s.writeStatus(w, s.live(), "health")
}

func (s *Server) handleLiveness(w http.ResponseWriter, _ *http.Request) {
	s.writeStatus(w, s.live(), "liveness")
}

func (s *Server) handleReadiness(w http.ResponseWriter, _ *http.Request) {
	s.writeStatus(w, s.ready(), "readiness")
}

func (s *Server) handlePrometheus(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = s.metrics.WritePrometheus(w)
}

func (s *Server) handleVersion(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(struct {
		Version string `json:"version"`
		Commit  string `json:"commit"`
	}{Version: s.cfg.Version.Version, Commit: s.cfg.Version.Commit})
}

func (s *Server) writeStatus(w http.ResponseWriter, up bool, _ string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	status := "UP"
	if !up {
		status = "DOWN"
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}

func (s *Server) live() bool {
	if s.probes == nil {
		return true
	}
	return s.probes.Live()
}

func (s *Server) ready() bool {
	if s.probes == nil {
		return true
	}
	return s.probes.Ready()
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

func requestIDFrom(r *http.Request) string {
	incoming := r.Header.Get("X-Request-Id")
	if validRequestID(incoming) {
		return incoming
	}
	return newRequestID()
}

func validRequestID(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case c == '.' || c == '_' || c == '-' || c == '~':
		default:
			return false
		}
	}
	return true
}

func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "req_fallback"
	}
	const hex = "0123456789abcdef"
	out := make([]byte, 32)
	for i, v := range b {
		out[i*2] = hex[v>>4]
		out[i*2+1] = hex[v&0x0f]
	}
	return string(out)
}

func operation(path string) string {
	switch path {
	case "/actuator/health":
		return "health"
	case "/actuator/health/liveness":
		return "liveness"
	case "/actuator/health/readiness":
		return "readiness"
	case "/actuator/prometheus":
		return "prometheus"
	case "/api/v1/version":
		return "version"
	case "/api/v1/service-mode":
		return "service_mode"
	case "/api/v1/age/state":
		return "age_state"
	case "/api/v1/age/verification":
		return "age_verification"
	case "/api/v1/relationships":
		return "relationships"
	case "/api/v1/conversations":
		return "conversations"
	case "/api/v1/conversations/wipe-preview":
		return "chat_wipe_preview"
	case "/api/v1/conversations/wipe":
		return "chat_wipe"
	case "/api/v1/incognito-pref":
		return "incognito_pref"
	case "/api/v1/consents":
		return "consents"
	case "/api/v1/reports":
		return "reports"
	case "/api/v1/exports":
		return "exports"
	case "/api/v1/auth/account":
		return "account"
	case "/api/v1/auth/login":
		return "auth_login"
	case "/api/v1/auth/register":
		return "auth_register"
	case "/api/v1/auth/registration-status":
		return "auth_registration_status"
	case "/api/v1/auth/session":
		return "auth_session"
	case "/api/v1/auth/logout":
		return "auth_logout"
	case "/api/v1/auth/sessions":
		return "auth_sessions"
	case "/api/v1/auth/sessions/revoke-all":
		return "auth_revoke_all"
	case "/api/v1/auth/password":
		return "auth_password"
	case "/api/v1/auth/reauth":
		return "auth_reauth"
	case "/api/v1/auth/trusted-devices":
		return "auth_trusted_devices"
	case "/api/v1/admin/providers":
		return "admin_providers"
	case "/api/v1/admin/model-routing-order":
		return "admin_model_routing_order"
	default:
		if strings.HasPrefix(path, "/api/v1/auth/challenges/") {
			return "auth_challenge"
		}
		if strings.HasPrefix(path, "/api/v1/auth/trusted-devices/") {
			return "auth_trusted_device"
		}
		if strings.HasPrefix(path, "/api/v1/admin/accounts/") && strings.HasSuffix(path, "/authenticator-reset") {
			return "admin_authenticator_reset"
		}
		if strings.HasPrefix(path, "/api/v1/admin/providers/") {
			if strings.HasSuffix(path, "/models/discover") {
				return "admin_provider_model_discovery"
			}
			return "admin_provider"
		}
		if strings.HasPrefix(path, "/api/v1/realtime/streams/") {
			return "realtime_stream"
		}
		if strings.HasSuffix(path, "/generations") {
			return "generation_send"
		}
		if strings.HasPrefix(path, "/api/v1/generations/") {
			switch {
			case strings.HasSuffix(path, "/cancel"):
				return "generation_cancel"
			case strings.HasSuffix(path, "/snapshot"):
				return "generation_snapshot"
			case strings.HasSuffix(path, "/feedback"):
				return "generation_feedback"
			}
		}
		if strings.HasPrefix(path, "/api/v1/relationships/") {
			if strings.HasSuffix(path, "/deactivate") {
				return "relationship_deactivate"
			}
			return "relationship"
		}
		if strings.Contains(path, "/messages/") {
			return "message"
		}
		if strings.HasSuffix(path, "/messages") {
			return "messages"
		}
		if strings.HasSuffix(path, "/end") {
			return "conversation_end"
		}
		if strings.HasPrefix(path, "/api/v1/conversations/") {
			return "conversation"
		}
		if strings.Contains(path, "/memories/candidates") {
			return "memory_candidate"
		}
		if strings.HasSuffix(path, "/memories") {
			return "memories"
		}
		if strings.HasSuffix(path, "/confirm") {
			return "memory_confirm"
		}
		if strings.HasSuffix(path, "/reject") {
			return "memory_reject"
		}
		if strings.HasSuffix(path, "/evidence") {
			return "memory_evidence"
		}
		if strings.HasPrefix(path, "/api/v1/memories/") {
			return "memory"
		}
		if strings.HasSuffix(path, "/download") {
			return "export_download"
		}
		if strings.HasPrefix(path, "/api/v1/exports/") {
			return "export"
		}
		if strings.HasPrefix(path, "/api/v1/auth/sessions/") {
			return "auth_session"
		}
		if strings.HasSuffix(path, "/feedback") {
			return "generation_feedback"
		}
		if strings.HasPrefix(path, "/api/v1/generations/") {
			return "generation"
		}
		return "unmapped"
	}
}

func quiet(op string) bool {
	switch op {
	case "health", "liveness", "readiness", "prometheus":
		return true
	default:
		return false
	}
}

func httpOutcome(code int) string {
	switch {
	case code >= 200 && code < 300:
		return "ok"
	case code >= 400 && code < 500:
		return "client_error"
	default:
		return "error"
	}
}
