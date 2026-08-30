package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/pprof"
	"sync/atomic"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/httpapi"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// Plane is a startable production capability. G2 only wires spies in tests;
// production companiond has none until later slices provide implementations.
type Plane interface {
	Name() config.Plane
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

// Lease is the migration-window generation-plane exclusive lock. api-migration
// must never acquire it. full mode must acquire it before starting any
// ForbiddenPlanes. G2 does not talk to PostgreSQL; production wiring leaves
// this nil and therefore starts no such planes.
type Lease interface {
	Acquire(ctx context.Context) error
	Release(ctx context.Context) error
}

// Deps is the explicit composition root. No DI container.
type Deps struct {
	Provider         Plane
	Jobs             Plane
	Realtime         Plane
	Scheduler        Plane
	GenerationWorker Plane
	Lease            Lease
}

type Runtime struct {
	cfg     config.Config
	log     *slog.Logger
	deps    Deps
	metrics *observability.Registry

	live  atomic.Bool
	ready atomic.Bool

	http      *http.Server
	ln        net.Listener
	pprof     *http.Server
	pprofLn   net.Listener
	started   []Plane
	heldLease bool
	store     *postgres.Store
}

func New(cfg config.Config, log *slog.Logger, deps Deps) (*Runtime, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if err := rejectMigrationWiring(cfg, deps); err != nil {
		return nil, err
	}
	if err := requireLeaseForPlanes(cfg, deps); err != nil {
		return nil, err
	}
	if log == nil {
		log = observability.NewLogger(cfg.Log.Level, nil)
	}
	return &Runtime{
		cfg:     cfg,
		log:     log,
		deps:    deps,
		metrics: observability.NewRegistry(),
	}, nil
}

func rejectMigrationWiring(cfg config.Config, deps Deps) error {
	if cfg.Mode != config.ModeAPIMigration {
		return nil
	}
	var named []string
	for _, p := range deps.planes() {
		named = append(named, string(p.Name()))
	}
	if deps.Lease != nil {
		named = append(named, "generation-plane-lease")
	}
	if len(named) == 0 {
		return nil
	}
	return fmt.Errorf("api-migration mode cannot wire %v", named)
}

func requireLeaseForPlanes(cfg config.Config, deps Deps) error {
	if cfg.Mode != config.ModeFull {
		return nil
	}
	if len(deps.planes()) == 0 {
		return nil
	}
	if deps.Lease == nil {
		return fmt.Errorf("full mode cannot start provider/jobs/realtime/scheduler/generation-worker without a generation plane lease")
	}
	return nil
}

func (d Deps) planes() []Plane {
	out := make([]Plane, 0, 5)
	if d.Provider != nil {
		out = append(out, d.Provider)
	}
	if d.Jobs != nil {
		out = append(out, d.Jobs)
	}
	if d.Realtime != nil {
		out = append(out, d.Realtime)
	}
	if d.Scheduler != nil {
		out = append(out, d.Scheduler)
	}
	if d.GenerationWorker != nil {
		out = append(out, d.GenerationWorker)
	}
	return out
}

func (r *Runtime) Live() bool  { return r.live.Load() }
func (r *Runtime) Ready() bool { return r.ready.Load() }

func (r *Runtime) Addr() string {
	if r.ln == nil {
		return ""
	}
	return r.ln.Addr().String()
}

func (r *Runtime) Start(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if r.cfg.Mode == config.ModeFull && r.deps.Lease != nil {
		if err := r.deps.Lease.Acquire(ctx); err != nil {
			return fmt.Errorf("generation plane lease: %w", err)
		}
		r.heldLease = true
	}
	if err := r.openStore(ctx); err != nil {
		r.releaseLease(ctx)
		return err
	}
	if err := r.startPlanes(ctx); err != nil {
		_ = r.stopStarted(ctx)
		r.closeStore()
		r.releaseLease(ctx)
		return err
	}
	if err := r.startPprof(); err != nil {
		_ = r.stopStarted(ctx)
		r.closeStore()
		r.releaseLease(ctx)
		return err
	}
	core, err := r.buildCore()
	if err != nil {
		_ = r.stopPprof(ctx)
		_ = r.stopStarted(ctx)
		r.closeStore()
		r.releaseLease(ctx)
		return err
	}
	api := httpapi.New(r.cfg, r.log, r, r.metrics, nil, core)
	ln, err := net.Listen("tcp", r.cfg.HTTP.Addr)
	if err != nil {
		_ = r.stopPprof(ctx)
		_ = r.stopStarted(ctx)
		r.closeStore()
		r.releaseLease(ctx)
		return err
	}
	r.ln = ln
	srv := &http.Server{
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
	}
	r.http = srv
	r.live.Store(true)
	r.ready.Store(true)
	r.log.Info("companiond listening",
		slog.String("operation", "listen"),
		slog.String("outcome", "ok"),
		slog.String("mode", string(r.cfg.Mode)),
	)
	go func() {
		err := srv.Serve(ln)
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			r.log.Error("http serve",
				slog.String("operation", "serve"),
				slog.String("outcome", "error"),
				slog.String("error_code", "HTTP_SERVE"),
			)
		}
	}()
	return nil
}

func (r *Runtime) Run(ctx context.Context) error {
	if err := r.Start(ctx); err != nil {
		return err
	}
	<-ctx.Done()
	shutCtx, cancel := context.WithTimeout(context.Background(), r.cfg.Shutdown.Timeout)
	defer cancel()
	return r.Shutdown(shutCtx)
}

func (r *Runtime) Shutdown(ctx context.Context) error {
	if ctx == nil {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(context.Background(), r.cfg.Shutdown.Timeout)
		defer cancel()
	}
	r.ready.Store(false)
	r.log.Info("companiond shutting down",
		slog.String("operation", "shutdown"),
		slog.String("outcome", "ok"),
		slog.String("mode", string(r.cfg.Mode)),
	)
	var first error
	if srv := r.http; srv != nil {
		r.http = nil
		r.ln = nil
		if err := srv.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
			first = err
		}
	}
	if err := r.stopPprof(ctx); err != nil && first == nil {
		first = err
	}
	if err := r.stopStarted(ctx); err != nil && first == nil {
		first = err
	}
	r.closeStore()
	r.releaseLease(ctx)
	r.live.Store(false)
	return first
}

func (r *Runtime) openStore(ctx context.Context) error {
	if r.cfg.Database.DSN == "" {
		return nil
	}
	store, err := postgres.Open(ctx, postgres.OpenConfig{
		DSN:                r.cfg.Database.DSN,
		MaxConns:           r.cfg.Database.MaxConns,
		TxTimeout:          r.cfg.Database.TxTimeout,
		OwnerBindingSecret: r.cfg.OwnerBinding.Secret,
	})
	if err != nil {
		return fmt.Errorf("database: %w", err)
	}
	r.store = store
	r.metrics.SetDBStatsSource(func() observability.DBStats {
		st := store.Stats()
		return observability.DBStats{
			Acquired:     st.Acquired,
			Idle:         st.Idle,
			Max:          st.Max,
			EmptyAcquire: st.EmptyAcquire,
			TxCount:      st.TxCount,
			TxSeconds:    st.TxSeconds,
		}
	})
	return nil
}

func (r *Runtime) buildCore() (*httpapi.Core, error) {
	if r.cfg.Mode != config.ModeFull || r.store == nil {
		return nil, nil
	}
	if r.cfg.JWT.Secret == "" {
		return nil, nil
	}
	ver, err := auth.NewVerifier(r.cfg.JWT.Secret, r.cfg.JWT.Issuer)
	if err != nil {
		return nil, fmt.Errorf("jwt verifier: %w", err)
	}
	if r.cfg.Crypto.RestKeyBase64 != "" {
		ciph, err := postgres.NewFieldCipherWithPrevious(
			r.cfg.Crypto.RestKeyID,
			r.cfg.Crypto.RestKeyVersion,
			r.cfg.Crypto.RestKeyBase64,
			r.cfg.Crypto.PreviousRestKeyID,
			r.cfg.Crypto.PreviousRestKeyVersion,
			r.cfg.Crypto.PreviousRestKeyBase64,
		)
		if err != nil {
			return nil, fmt.Errorf("rest cipher: %w", err)
		}
		r.store.UseCipher(ciph)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		return nil, fmt.Errorf("password verifier: %w", err)
	}
	return &httpapi.Core{Store: r.store, JWT: ver, Passwords: pw}, nil
}

func (r *Runtime) closeStore() {
	if r.store == nil {
		return
	}
	r.store.Close()
	r.store = nil
}

func (r *Runtime) startPlanes(ctx context.Context) error {
	for _, p := range r.deps.planes() {
		if !r.cfg.Allows(p.Name()) {
			return fmt.Errorf("refusing to start %s in mode %s", p.Name(), r.cfg.Mode)
		}
		if err := p.Start(ctx); err != nil {
			return fmt.Errorf("start %s: %w", p.Name(), err)
		}
		r.started = append(r.started, p)
		r.log.Info("plane started",
			slog.String("operation", "plane_start"),
			slog.String("outcome", "ok"),
			slog.String("event_type", string(p.Name())),
		)
	}
	return nil
}

func (r *Runtime) stopStarted(ctx context.Context) error {
	var first error
	for i := len(r.started) - 1; i >= 0; i-- {
		p := r.started[i]
		if err := p.Stop(ctx); err != nil && first == nil {
			first = err
		}
	}
	r.started = nil
	return first
}

func (r *Runtime) releaseLease(ctx context.Context) {
	if !r.heldLease || r.deps.Lease == nil {
		return
	}
	_ = r.deps.Lease.Release(ctx)
	r.heldLease = false
}

func (r *Runtime) startPprof() error {
	if r.cfg.Pprof.Addr == "" {
		return nil
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
	ln, err := net.Listen("tcp", r.cfg.Pprof.Addr)
	if err != nil {
		return fmt.Errorf("pprof listen: %w", err)
	}
	r.pprofLn = ln
	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	r.pprof = srv
	go func() {
		_ = srv.Serve(ln)
	}()
	return nil
}

func (r *Runtime) stopPprof(ctx context.Context) error {
	if r.pprof == nil {
		return nil
	}
	err := r.pprof.Shutdown(ctx)
	r.pprof = nil
	r.pprofLn = nil
	return err
}
