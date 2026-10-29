package httpapi

import (
	"bytes"
	"context"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type memoryRecallHTTPStore struct {
	*memStore
	calls   int
	owner   int64
	request postgres.STMemoryRequest
}

func (m *memoryRecallHTTPStore) RecallSTMemory(_ context.Context, owner int64, in postgres.STMemoryRequest) (postgres.STMemoryResult, error) {
	m.calls++
	m.owner = owner
	m.request = in
	if owner != 1 {
		return postgres.STMemoryResult{}, postgres.ErrNotFound
	}
	if in.Revision != 3 {
		return postgres.STMemoryResult{}, postgres.ErrConflict
	}
	return postgres.STMemoryResult{Status: "ok", Block: "合成来源资料", Sources: []postgres.STSourceState{}, MemoryIDs: []string{}, SummaryIDs: []string{}}, nil
}
func TestSTMemoryRecallUsesCookieIdentityAndRejectsStalePage(t *testing.T) {
	m := &memoryRecallHTTPStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", m)
	path := "/api/v1/st/memory/recall"
	body := `{"chatIdentity":"10000000-0000-0000-0000-000000000001","revision":3,"enabled":true,"budgetTokens":1024,"ownerAccountId":"2","relationshipId":"20","query":"untrusted text"}`
	got := doJSON(t, s, http.MethodPost, path, body, 1)
	if got.Code != 200 || m.owner != 1 || m.request.Revision != 3 {
		t.Fatalf("recall owner boundary: status=%d owner=%d", got.Code, m.owner)
	}
	if got := doJSON(t, s, http.MethodPost, path, body, 2); got.Code != 404 {
		t.Fatalf("foreign binding=%d", got.Code)
	}
	if got := doJSON(t, s, http.MethodPost, path, strings.Replace(body, `"revision":3`, `"revision":2`, 1), 1); got.Code != 409 {
		t.Fatalf("stale revision=%d", got.Code)
	}
	calls := m.calls
	for _, header := range []string{"Origin", "X-CSRF-Token", "X-VC-Expected-Account-ID", "X-VC-Expected-Session-ID"} {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		attachAuth(t, s, req, 1, true)
		req.Header.Del(header)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != 403 && rec.Code != 409 {
			t.Fatalf("missing %s status=%d", header, rec.Code)
		}
	}
	if m.calls != calls {
		t.Fatal("untrusted page reached recall store")
	}
}

func TestRecallMetricsKeepStageDurations(t *testing.T) {
	t.Parallel()
	stats := recallMetrics(postgres.RecallObserve{
		QueryEmbeddingMs: 15, LooseRetrievalMs: 20, OriginalGateMs: 9,
		KeywordRecoveryMs: 4, RerankMs: 30, SummaryProfileGateMs: 8,
		RerankCacheHit: 7, RerankCacheMiss: 2, SourceMs: 11, RecallMs: 80,
	})
	if stats.QueryEmbeddingMs != 15 || stats.RerankCacheHit != 7 || stats.RerankCacheMiss != 2 || stats.SourceMs != 11 || stats.RecallMs != 80 {
		t.Fatalf("%+v", stats)
	}
	reg := observability.NewRegistry()
	reg.ObserveMemoryRecall(stats)
	var buf bytes.Buffer
	if err := reg.WritePrometheus(&buf); err != nil {
		t.Fatal(err)
	}
	body := buf.String()
	for _, want := range []string{
		"vc_memory_rerank_cache_hit_total 7.000000000",
		"vc_memory_rerank_cache_miss_total 2.000000000",
		"vc_memory_embedding_stage_seconds_sum 0.015000000",
		"vc_memory_loose_retrieval_seconds_sum 0.020000000",
		"vc_memory_original_gate_seconds_sum 0.009000000",
		"vc_memory_keyword_recovery_seconds_sum 0.004000000",
		"vc_memory_rerank_seconds_sum 0.030000000",
		"vc_memory_summary_profile_gate_seconds_sum 0.008000000",
		"vc_memory_source_check_seconds_sum 0.011000000",
		"vc_memory_recall_seconds_sum 0.080000000",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("missing %q in %s", want, body)
		}
	}
	if strings.Contains(body, "合成") || strings.Contains(body, "owner") || strings.Contains(body, "query") {
		t.Fatalf("stage metrics leaked text: %s", body)
	}
}
