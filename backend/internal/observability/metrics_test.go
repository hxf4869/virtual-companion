package observability

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

func TestProcessSnapshotAndPrometheus(t *testing.T) {
	t.Parallel()
	snap := SnapshotProcess()
	if snap.Goroutines < 1 {
		t.Fatalf("goroutines %d", snap.Goroutines)
	}
	if snap.CPUSeconds < 0 {
		t.Fatalf("cpu %f", snap.CPUSeconds)
	}
	reg := NewRegistry()
	reg.ObserveHTTP("health", "GET", 200, 2*time.Millisecond)
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"# TYPE go_goroutines gauge",
		"go_goroutines",
		"process_cpu_seconds_total",
		`vc_http_requests_total{handler="health",method="GET",code="200"} 1`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
}

func TestRealtimeMetrics(t *testing.T) {
	t.Parallel()
	reg := NewRegistry()
	reg.SetRealtimeStatsSource(func() RealtimeStats {
		return RealtimeStats{Subscribers: 2, SlowDisconnects: 3, SnapshotResumes: 4}
	})
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"vc_realtime_subscribers",
		"vc_realtime_slow_disconnect_total",
		"vc_realtime_snapshot_resume_total",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
}

func TestJobsMetrics(t *testing.T) {
	t.Parallel()
	reg := NewRegistry()
	reg.SetJobsStatsSource(func() JobsStats {
		return JobsStats{Claims: 7, Recoveries: 2, ActiveGenerations: 3, PeakGenerations: 4}
	})
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"vc_job_claims_total",
		"vc_job_recoveries_total",
		"vc_generation_active 3",
		"vc_generation_peak 4",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
}

func TestDBPoolMetrics(t *testing.T) {
	t.Parallel()
	reg := NewRegistry()
	reg.SetDBStatsSource(func() DBStats {
		return DBStats{Acquired: 1, Idle: 2, Max: 8, EmptyAcquire: 3, TxCount: 4, TxSeconds: 0.5}
	})
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"vc_db_pool_acquired",
		"vc_db_pool_idle",
		"vc_db_pool_max",
		"vc_db_tx_total",
		"vc_db_tx_duration_seconds_sum",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
}
