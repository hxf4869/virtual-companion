package observability

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Registry holds low-cardinality process and HTTP metrics. Labels are handler
// names and status codes only — never owner, id, or error text.
type Registry struct {
	mu   sync.Mutex
	http map[httpKey]httpStat
}

type httpKey struct {
	handler string
	method  string
	code    string
}

type httpStat struct {
	count    uint64
	duration time.Duration
}

func NewRegistry() *Registry {
	return &Registry{http: make(map[httpKey]httpStat)}
}

func (r *Registry) ObserveHTTP(handler, method string, code int, d time.Duration) {
	if r == nil {
		return
	}
	if handler == "" {
		handler = "unmapped"
	}
	if method == "" {
		method = "UNKNOWN"
	}
	key := httpKey{handler: handler, method: method, code: strconv.Itoa(code)}
	r.mu.Lock()
	st := r.http[key]
	st.count++
	st.duration += d
	r.http[key] = st
	r.mu.Unlock()
}

func (r *Registry) WritePrometheus(w io.Writer) error {
	snap := SnapshotProcess()
	var buf bytes.Buffer
	writeGauge(&buf, "go_goroutines", "Number of goroutines.", float64(snap.Goroutines))
	writeGauge(&buf, "go_memstats_heap_alloc_bytes", "Bytes of allocated heap objects.", float64(snap.HeapAllocBytes))
	if snap.RSSBytes > 0 {
		writeGauge(&buf, "process_resident_memory_bytes", "Resident memory size in bytes.", float64(snap.RSSBytes))
	}
	if snap.OpenFDs >= 0 {
		writeGauge(&buf, "process_open_fds", "Number of open file descriptors.", float64(snap.OpenFDs))
	}
	writeCounter(&buf, "process_cpu_seconds_total", "Total user and system CPU time spent in seconds.", snap.CPUSeconds)

	var rows []httpRow
	if r != nil {
		r.mu.Lock()
		for k, st := range r.http {
			rows = append(rows, httpRow{
				handler: k.handler,
				method:  k.method,
				code:    k.code,
				count:   st.count,
				seconds: st.duration.Seconds(),
			})
		}
		r.mu.Unlock()
	}
	sortRows(rows)
	buf.WriteString("# HELP vc_http_requests_total HTTP requests handled by companiond.\n")
	buf.WriteString("# TYPE vc_http_requests_total counter\n")
	for _, rw := range rows {
		fmt.Fprintf(&buf, "vc_http_requests_total{handler=%q,method=%q,code=%q} %d\n", rw.handler, rw.method, rw.code, rw.count)
	}
	buf.WriteString("# HELP vc_http_request_duration_seconds_sum Total HTTP handler duration in seconds.\n")
	buf.WriteString("# TYPE vc_http_request_duration_seconds_sum counter\n")
	for _, rw := range rows {
		fmt.Fprintf(&buf, "vc_http_request_duration_seconds_sum{handler=%q,method=%q,code=%q} %.9f\n", rw.handler, rw.method, rw.code, rw.seconds)
	}
	_, err := w.Write(buf.Bytes())
	return err
}

func writeGauge(buf *bytes.Buffer, name, help string, v float64) {
	fmt.Fprintf(buf, "# HELP %s %s\n# TYPE %s gauge\n%s %.0f\n", name, help, name, name, v)
}

func writeCounter(buf *bytes.Buffer, name, help string, v float64) {
	fmt.Fprintf(buf, "# HELP %s %s\n# TYPE %s counter\n%s %.9f\n", name, help, name, name, v)
}

type httpRow struct {
	handler, method, code string
	count                 uint64
	seconds               float64
}

func sortRows(rows []httpRow) {
	for i := 1; i < len(rows); i++ {
		j := i
		for j > 0 && rowLess(rows[j], rows[j-1]) {
			rows[j], rows[j-1] = rows[j-1], rows[j]
			j--
		}
	}
}

func rowLess(a, b httpRow) bool {
	if a.handler != b.handler {
		return a.handler < b.handler
	}
	if a.method != b.method {
		return a.method < b.method
	}
	return a.code < b.code
}

// ProcessSnapshot is a point-in-time view of cheap process stats.
type ProcessSnapshot struct {
	Goroutines     int
	HeapAllocBytes uint64
	RSSBytes       uint64
	OpenFDs        int
	CPUSeconds     float64
}

func SnapshotProcess() ProcessSnapshot {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	snap := ProcessSnapshot{
		Goroutines:     runtime.NumGoroutine(),
		HeapAllocBytes: ms.HeapAlloc,
		OpenFDs:        -1,
	}
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err == nil {
		snap.CPUSeconds = float64(ru.Utime.Sec) + float64(ru.Utime.Usec)/1e6 +
			float64(ru.Stime.Sec) + float64(ru.Stime.Usec)/1e6
	}
	if rss := currentRSSBytes(); rss > 0 {
		snap.RSSBytes = rss
	}
	if n, ok := openFDCount(); ok {
		snap.OpenFDs = n
	}
	return snap
}

func currentRSSBytes() uint64 {
	f, err := os.Open("/proc/self/status")
	if err != nil {
		return 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kb, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kb * 1024
	}
	return 0
}

func openFDCount() (int, bool) {
	for _, dir := range []string{"/proc/self/fd", "/dev/fd"} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		return len(entries), true
	}
	return 0, false
}
