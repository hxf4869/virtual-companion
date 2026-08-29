package app

import (
	"context"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/config"
)

func TestShutdownStopsReadinessFirst(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeAPIMigration, Deps{})
	if !rt.Ready() || !rt.Live() {
		t.Fatal("expected live and ready after start")
	}
	ready := get(t, "http://"+rt.Addr()+"/actuator/health/readiness")
	ready.Body.Close()
	if ready.StatusCode != http.StatusOK {
		t.Fatalf("readiness before shutdown %d", ready.StatusCode)
	}

	done := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		done <- rt.Shutdown(ctx)
	}()

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !rt.Ready() {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if rt.Ready() {
		t.Fatal("readiness must drop before shutdown returns")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if rt.Live() {
		t.Fatal("liveness must drop after shutdown")
	}
}

func TestPprofIsNotOnPublicMux(t *testing.T) {
	t.Parallel()
	rt := startRuntime(t, config.ModeAPIMigration, Deps{})
	res := get(t, "http://"+rt.Addr()+"/debug/pprof/")
	io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("pprof must not be public, got %d", res.StatusCode)
	}
}
