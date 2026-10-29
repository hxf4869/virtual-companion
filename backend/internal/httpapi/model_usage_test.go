package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) ReserveModelUsage(_ context.Context, in postgres.ModelUsageReserve) (postgres.ModelUsageHold, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usageCalls++
	if m.usageErr != nil {
		return postgres.ModelUsageHold{}, m.usageErr
	}
	m.usageLastAttempt = in.AttemptID
	m.usageLastPurpose = in.Purpose
	return postgres.ModelUsageHold{
		ReservationID: 41, Purpose: in.Purpose, Status: "HELD",
		AttemptID: in.AttemptID, ReservedUSD: "1.000000",
	}, nil
}

func (m *memStore) SettleModelUsage(_ context.Context, _, reservationID, input, output int64, _ *int64) (postgres.ModelUsageSettlement, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usageCalls++
	if m.settleErr != nil {
		return postgres.ModelUsageSettlement{}, m.settleErr
	}
	m.usageSettles++
	idempotent := m.usageSettles > 1
	return postgres.ModelUsageSettlement{
		ReservationID: reservationID, Purpose: postgres.PurposeForegroundChat, Status: "SETTLED",
		ActualUSD: "0.003000", InputTokens: input, OutputTokens: output, Idempotent: idempotent,
	}, nil
}

func (m *memStore) CancelModelUsage(_ context.Context, _, reservationID int64, disposition string) (postgres.ModelUsageCancellation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usageCalls++
	m.usageLastCancel = disposition
	status := "RELEASED"
	if disposition == "UNKNOWN" {
		status = "UNKNOWN"
	}
	return postgres.ModelUsageCancellation{
		ReservationID: reservationID, Purpose: postgres.PurposeToolTurn, Status: status,
		ReservedUSD: "1.000000", Idempotent: false,
	}, nil
}

func (m *memStore) RecordLocalEmbeddingCall(context.Context, int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usageCalls++
	return nil
}

func (m *memStore) AdminModelUsageSummary(context.Context, int64, time.Time, time.Time) ([]postgres.ModelUsagePurposeRow, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.usageSummaryCalls++
	return []postgres.ModelUsagePurposeRow{{
		Purpose: postgres.PurposeForegroundChat, Calls: 1,
	}}, nil
}

func newUsageServer(t *testing.T, store *memStore) *Server {
	t.Helper()
	s := newCoreServer(t, "full", store)
	s.cfg.STPlugin.ServiceToken = "st-plugin-service-token-0123456789abcdef"
	s.cfg.STPlugin.HostBaseURL = "http://127.0.0.1:8752"
	return s
}

func usageService(t *testing.T, s *Server, method, path, token, origin, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func TestModelUsageServiceReserveAndSettle(t *testing.T) {
	store := newMemStore()
	s := newUsageServer(t, store)
	token := s.cfg.STPlugin.ServiceToken
	reserveBody := `{"ownerAccountId":"1","purpose":"FOREGROUND_CHAT","attemptId":"fg-1","providerId":"prov-a","modelId":"model-a","estimatedInputTokens":10,"estimatedOutputTokens":4}`

	if rec := usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", "", "", reserveBody); rec.Code != http.StatusUnauthorized || store.usageCalls != 0 {
		t.Fatalf("unauthenticated %d calls=%d", rec.Code, store.usageCalls)
	}
	if rec := usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", token, "https://vc.test", reserveBody); rec.Code != http.StatusForbidden || store.usageCalls != 0 {
		t.Fatalf("origin %d calls=%d", rec.Code, store.usageCalls)
	}
	if rec := usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", token, "", `{`); rec.Code != http.StatusBadRequest || store.usageCalls != 0 {
		t.Fatalf("bad json %d calls=%d", rec.Code, store.usageCalls)
	}

	store.usageErr = &postgres.ModelUsageError{Reason: postgres.ModelUsageNoPrice}
	rec := usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", token, "", reserveBody)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), `"MODEL_NO_ELIGIBLE_DEPLOYMENT"`) || !strings.Contains(rec.Body.String(), `"NO_PRICE"`) {
		t.Fatalf("no price %d %s", rec.Code, rec.Body.String())
	}
	store.usageErr = &postgres.ModelUsageError{Reason: postgres.ModelUsageOverLimit}
	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", token, "", reserveBody)
	if rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), `"OVER_LIMIT"`) {
		t.Fatalf("over limit %d %s", rec.Code, rec.Body.String())
	}
	store.usageErr = nil
	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations", token, "", reserveBody)
	if rec.Code != http.StatusOK || store.usageLastAttempt != "fg-1" {
		t.Fatalf("reserve %d %s attempt=%s", rec.Code, rec.Body.String(), store.usageLastAttempt)
	}
	var reserved map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &reserved); err != nil || reserved["reservationId"] != "41" || reserved["reservedUsd"] != "1.000000" || reserved["status"] != "HELD" {
		t.Fatalf("reserve body %s %v", rec.Body.String(), err)
	}

	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations/41/settle", token, "", `{"ownerAccountId":"1","inputTokens":10,"outputTokens":4}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"idempotent":false`) {
		t.Fatalf("settle %d %s", rec.Code, rec.Body.String())
	}
	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations/41/settle", token, "", `{"ownerAccountId":"1","inputTokens":10,"outputTokens":4}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"idempotent":true`) || store.usageSettles != 2 {
		t.Fatalf("second settle %d %s settles=%d", rec.Code, rec.Body.String(), store.usageSettles)
	}

	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/reservations/41/cancel", token, "", `{"ownerAccountId":"1","disposition":"UNKNOWN"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"UNKNOWN"`) || !strings.Contains(rec.Body.String(), `"reservedUsd":"1.000000"`) || !strings.Contains(rec.Body.String(), `"actualUsd":null`) {
		t.Fatalf("cancel %d %s", rec.Code, rec.Body.String())
	}
	rec = usageService(t, s, http.MethodPost, "/api/v1/service/model-usage/local-embeddings", token, "", `{"ownerAccountId":"1"}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"billing":"NONE"`) {
		t.Fatalf("embedding %d %s", rec.Code, rec.Body.String())
	}
}

func TestAdminModelUsageRequiresAdmin(t *testing.T) {
	store := newMemStore()
	store.identities["admin@example.com"] = postgres.Identity{AccountID: 9, Role: "ADMIN", Status: "ACTIVE", Username: "admin"}
	s := newUsageServer(t, store)
	rec := doJSON(t, s, http.MethodGet, "/api/v1/auth/admin/usage?days=14", "", 1)
	if rec.Code != http.StatusForbidden || store.usageSummaryCalls != 0 {
		t.Fatalf("user %d calls=%d %s", rec.Code, store.usageSummaryCalls, rec.Body.String())
	}
	rec = doJSON(t, s, http.MethodGet, "/api/v1/auth/admin/usage", "", 9)
	if rec.Code != http.StatusOK || store.usageSummaryCalls != 1 {
		t.Fatalf("admin %d calls=%d %s", rec.Code, store.usageSummaryCalls, rec.Body.String())
	}
	var body struct {
		Purposes []map[string]any `json:"purposes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || len(body.Purposes) != 1 || body.Purposes[0]["purpose"] != "FOREGROUND_CHAT" {
		t.Fatalf("summary %s %v", rec.Body.String(), err)
	}
	bare := httptest.NewRequest(http.MethodGet, "/api/v1/auth/admin/usage", nil)
	unauth := httptest.NewRecorder()
	s.Handler().ServeHTTP(unauth, bare)
	if unauth.Code != http.StatusUnauthorized || store.usageSummaryCalls != 1 {
		t.Fatalf("anonymous %d calls=%d", unauth.Code, store.usageSummaryCalls)
	}
}
