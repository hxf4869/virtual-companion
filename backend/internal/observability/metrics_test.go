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
