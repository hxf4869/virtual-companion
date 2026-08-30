package app

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"log/slog"

	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
)

func TestAPIMigrationRejectsEveryForbiddenPlane(t *testing.T) {
	t.Parallel()
	log := observability.NewLogger("error", io.Discard)
	cfg := mustConfig(t, config.ModeAPIMigration)
	for _, plane := range config.ForbiddenPlanes() {
		spy := &spyPlane{name: plane}
		_, err := New(cfg, log, depsWith(t, plane, spy))
		if err == nil {
			t.Fatalf("api-migration accepted wiring for %s", plane)
		}
		if !strings.Contains(err.Error(), string(plane)) {
			t.Fatalf("error %q should name %s", err, plane)
		}
		if spy.starts.Load() != 0 {
			t.Fatalf("%s Start was called in api-migration", plane)
		}
	}
}

func TestAPIMigrationRejectsGenerationPlaneLease(t *testing.T) {
	t.Parallel()
	lease := &recordingLease{}
	_, err := New(mustConfig(t, config.ModeAPIMigration), testLog(), Deps{Lease: lease})
	if err == nil {
		t.Fatal("api-migration must not wire a generation plane lease")
	}
	if lease.acquired.Load() {
		t.Fatal("api-migration acquired generation plane lease")
	}
}

func TestAPIMigrationDoesNotServeRealtimeStream(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeAPIMigration, Deps{})
	res := get(t, "http://"+rt.Addr()+"/api/v1/realtime/streams/42")
	defer res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("api-migration must not serve SSE, got %d", res.StatusCode)
	}
	post, err := http.Post("http://"+rt.Addr()+"/api/v1/realtime/tickets", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer post.Body.Close()
	if post.StatusCode != http.StatusNotFound && post.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("ticket endpoint %d", post.StatusCode)
	}
}

func TestAPIMigrationDoesNotServeCoreWriters(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeAPIMigration, Deps{})
	post, err := http.Post("http://"+rt.Addr()+"/api/v1/relationships", "application/json", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	if err != nil {
		t.Fatal(err)
	}
	defer post.Body.Close()
	if post.StatusCode != http.StatusNotFound && post.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration must not serve relationship writes, got %d", post.StatusCode)
	}
	consent, err := http.Post("http://"+rt.Addr()+"/api/v1/consents", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	defer consent.Body.Close()
	if consent.StatusCode != http.StatusNotFound && consent.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration must not serve consent writes, got %d", consent.StatusCode)
	}
	conv, err := http.Post("http://"+rt.Addr()+"/api/v1/conversations", "application/json", strings.NewReader(`{"relationshipId":1}`))
	if err != nil {
		t.Fatal(err)
	}
	defer conv.Body.Close()
	if conv.StatusCode != http.StatusNotFound && conv.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration must not serve conversation writes, got %d", conv.StatusCode)
	}
}

func TestAPIMigrationServesHealthWithoutPlanes(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeAPIMigration, Deps{})
	res := get(t, "http://"+rt.Addr()+"/actuator/health")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("health %d", res.StatusCode)
	}
	ready := get(t, "http://"+rt.Addr()+"/actuator/health/readiness")
	defer ready.Body.Close()
	if ready.StatusCode != http.StatusOK {
		t.Fatalf("readiness %d", ready.StatusCode)
	}
}

func TestFullModeStartsPlanesAfterLease(t *testing.T) {
	t.Parallel()
	spies := map[config.Plane]*spyPlane{}
	deps := Deps{Lease: &recordingLease{}}
	for _, p := range config.ForbiddenPlanes() {
		spy := &spyPlane{name: p}
		spies[p] = spy
		deps = assignPlane(deps, p, spy)
	}
	rt := startRuntime(t, config.ModeFull, deps)
	lease, ok := rt.deps.Lease.(*recordingLease)
	if !ok || !lease.acquired.Load() {
		t.Fatal("full mode must acquire generation plane lease before planes")
	}
	for p, spy := range spies {
		if spy.starts.Load() != 1 {
			t.Fatalf("%s Start count=%d", p, spy.starts.Load())
		}
	}
	if err := rt.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !lease.released.Load() {
		t.Fatal("shutdown must release generation plane lease")
	}
	for p, spy := range spies {
		if spy.stops.Load() != 1 {
			t.Fatalf("%s Stop count=%d", p, spy.stops.Load())
		}
	}
}

func TestFullModePlanesRequireLease(t *testing.T) {
	t.Parallel()
	spy := &spyPlane{name: config.PlaneProvider}
	_, err := New(mustConfig(t, config.ModeFull), testLog(), Deps{Provider: spy})
	if err == nil {
		t.Fatal("full mode must refuse provider without a generation plane lease")
	}
	if spy.starts.Load() != 0 {
		t.Fatal("provider started without lease")
	}
}

func TestFullModeWithoutPlanesDoesNotNeedLease(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeFull, Deps{})
	res := get(t, "http://"+rt.Addr()+"/actuator/health")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("health %d", res.StatusCode)
	}
}

type spyPlane struct {
	name   config.Plane
	starts atomic.Int32
	stops  atomic.Int32
}

func (s *spyPlane) Name() config.Plane { return s.name }

func (s *spyPlane) Start(context.Context) error {
	s.starts.Add(1)
	return nil
}

func (s *spyPlane) Stop(context.Context) error {
	s.stops.Add(1)
	return nil
}

type recordingLease struct {
	acquired atomic.Bool
	released atomic.Bool
}

func (l *recordingLease) Acquire(context.Context) error {
	l.acquired.Store(true)
	return nil
}

func (l *recordingLease) Release(context.Context) error {
	l.released.Store(true)
	return nil
}

func depsWith(t *testing.T, p config.Plane, sp Plane) Deps {
	t.Helper()
	return assignPlane(Deps{}, p, sp)
}

func assignPlane(d Deps, p config.Plane, sp Plane) Deps {
	switch p {
	case config.PlaneProvider:
		d.Provider = sp
	case config.PlaneJobs:
		d.Jobs = sp
	case config.PlaneRealtime:
		d.Realtime = sp
	case config.PlaneScheduler:
		d.Scheduler = sp
	case config.PlaneGenerationWorker:
		d.GenerationWorker = sp
	default:
		panic("unmapped plane " + string(p))
	}
	return d
}

func mustConfig(t *testing.T, mode config.Mode) config.Config {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return string(mode)
		case "VC_HTTP_ADDR":
			return "127.0.0.1:0"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

func testLog() *slog.Logger {
	return observability.NewLogger("error", io.Discard)
}

func startRuntime(t *testing.T, mode config.Mode, deps Deps) *Runtime {
	t.Helper()
	rt, err := New(mustConfig(t, mode), observability.NewLogger("error", io.Discard), deps)
	if err != nil {
		t.Fatal(err)
	}
	if err := rt.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		shut, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = rt.Shutdown(shut)
	})
	return rt
}

func get(t *testing.T, url string) *http.Response {
	t.Helper()
	var last error
	for i := 0; i < 50; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		res, err := http.DefaultClient.Do(req)
		cancel()
		if err == nil {
			return res
		}
		last = err
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("GET %s: %v", url, last)
	return nil
}
