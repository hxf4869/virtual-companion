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

func TestMemoryRecallMetrics(t *testing.T) {
	t.Parallel()
	reg := NewRegistry()
	reg.ObserveMemoryRecall(MemoryRecallStats{
		SummaryAllow: 1, SummaryReject: 2,
		ProfileAllow: 3, ProfileReject: 4,
		EmbeddingCacheHit: 5, EmbeddingCacheMiss: 6,
		RecallEmpty: 7,
	})
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"vc_memory_summary_gate_allow_total",
		"vc_memory_summary_gate_reject_total",
		"vc_memory_profile_gate_allow_total",
		"vc_memory_profile_gate_reject_total",
		"vc_memory_embedding_cache_hit_total",
		"vc_memory_embedding_cache_miss_total",
		"vc_memory_recall_empty_total",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
	if strings.Contains(body, "owner") || strings.Contains(body, "secret") {
		t.Fatalf("memory metrics leaked a label: %s", body)
	}
	reg.SetJobsStatsSource(func() JobsStats { return JobsStats{Claims: 7, ActiveGenerations: 3, PeakGenerations: 4} })
	buf.Reset()
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), "vc_generation_active 3") || !strings.Contains(buf.String(), "vc_job_claims_total") {
		t.Fatal("memory metrics changed generation counters")
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
