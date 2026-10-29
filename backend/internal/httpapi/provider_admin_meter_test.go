package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestVerifyModelToolCallsReserveUsesUsageStatus(t *testing.T) {
	server, store := newProviderServer(t)
	path := "/api/v1/admin/providers/acme/models/m1/verify-tool-calls"
	store.configs[0].Models[0].Capabilities = postgres.ModelCapabilities{"toolCalls": postgres.CapabilityDeclared}
	store.usageErr = &postgres.ModelUsageError{Reason: postgres.ModelUsageOverLimit}
	over := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if over.Code != http.StatusTooManyRequests || decodeBody(t, over)["code"] != "RATE_LIMITED" {
		t.Fatalf("over limit %d %s", over.Code, over.Body.String())
	}
	store.usageErr = &postgres.ModelUsageError{Reason: postgres.ModelUsageNoBudget}
	budget := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if budget.Code != http.StatusConflict || decodeBody(t, budget)["code"] != "MODEL_NO_ELIGIBLE_DEPLOYMENT" ||
		!strings.Contains(budget.Body.String(), `"NO_BUDGET"`) {
		t.Fatalf("no budget %d %s", budget.Code, budget.Body.String())
	}
	store.usageErr = errors.New("db down")
	down := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if down.Code != http.StatusServiceUnavailable || len(store.verified) != 0 {
		t.Fatalf("store %d verified=%v %s", down.Code, store.verified, down.Body.String())
	}
}

func TestVerifyModelToolCallsRejectsIdentityChangedDuringProbe(t *testing.T) {
	var store *providerMemStore
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		store.configs[0].Models[0].ModelID = "remote-b"
		store.configs[0].Revision = 4
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"output":[{"type":"function_call","name":"get_current_weather","arguments":"{\"city\":\"北京\"}"}],"usage":{"input_tokens":4,"output_tokens":5}}`)
	}))
	defer upstream.Close()

	server, created := newProviderServer(t)
	store = created
	server.cfg.Provider.AllowLoopbackHTTP = true
	store.configs[0].Protocol = postgres.ProtocolOpenAIResponses
	store.configs[0].BaseURL = upstream.URL + "/v1"
	store.configs[0].Revision = 3
	store.configs[0].Models[0].ProfileKey = "m@chat"
	store.configs[0].Models[0].ModelID = "remote-a"
	store.configs[0].Models[0].Capabilities = postgres.ModelCapabilities{"toolCalls": postgres.CapabilityDeclared}
	path := "/api/v1/admin/providers/acme/models/m@chat/verify-tool-calls"
	rec := providerRequest(t, server, store, http.MethodPost, path, "{}", 9, true)
	if rec.Code != http.StatusConflict || decodeBody(t, rec)["code"] != "REVISION_CONFLICT" ||
		strings.Contains(rec.Body.String(), "北京") || len(store.verified) != 0 ||
		store.markModelID != "remote-a" || store.markRevision != 3 ||
		store.configs[0].Models[0].Capabilities["toolCalls"] != postgres.CapabilityDeclared {
		t.Fatalf("stale %d mark=%s@%d caps=%v body=%s", rec.Code, store.markModelID, store.markRevision, store.configs[0].Models[0].Capabilities, rec.Body.String())
	}
}

func TestMeterToolProbeRetriesCancelWithoutTheCallerContext(t *testing.T) {
	server, store := newProviderServer(t)
	parent, cancel := context.WithCancel(context.Background())
	cancel()
	var logs bytes.Buffer
	server.log = slog.New(slog.NewTextHandler(&logs, nil))
	store.usageCancelFailures = 2
	_ = server.meterToolProbe(parent, store, 9, 41, modelprovider.ToolProbeResult{Sent: true}, false)
	if store.usageCancelTries != 3 || store.usageLastCancel != "UNKNOWN" || store.usageCancelSawCanceled ||
		strings.Contains(logs.String(), "CANCEL_FAILED") {
		t.Fatalf("recovered tries=%d cancel=%s saw=%v log=%s", store.usageCancelTries, store.usageLastCancel, store.usageCancelSawCanceled, logs.String())
	}

	logs.Reset()
	store.usageLastCancel = ""
	store.usageCancelTries = 0
	store.usageCancelFailures = 3
	_ = server.meterToolProbe(parent, store, 9, 41, modelprovider.ToolProbeResult{Sent: true}, false)
	if store.usageCancelTries != 3 || store.usageLastCancel != "" || store.usageCancelSawCanceled ||
		!strings.Contains(logs.String(), "CANCEL_FAILED") || strings.Contains(logs.String(), "41") {
		t.Fatalf("failed tries=%d cancel=%s saw=%v log=%s", store.usageCancelTries, store.usageLastCancel, store.usageCancelSawCanceled, logs.String())
	}
}
