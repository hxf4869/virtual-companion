package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"github.com/hxf4869/virtual-companion/internal/observability"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMemoryCoreCallbackAuthentication(t *testing.T) {
	s, _ := newProviderServer(t)
	s.cfg.MemoryCoreCallbackToken = "synthetic-memorycore-service-token"
	s.core.MemoryCore = memorycore.New(nil, nil)
	for _, tc := range []struct {
		name, token, origin, body string
		status                    int
	}{
		{"unauthenticated", "", "", `{}`, 401},
		{"browser", s.cfg.MemoryCoreCallbackToken, "http://localhost", `{}`, 403},
		{"unknown capability", s.cfg.MemoryCoreCallbackToken, "", `{"operationToken":"unknown","stage":"l1-extraction","callSequence":1,"messages":[]}`, 409},
		{"owner override", s.cfg.MemoryCoreCallbackToken, "", `{"ownerAccountId":"1"}`, 400},
		{"callback override", s.cfg.MemoryCoreCallbackToken, "", `{"callbackUrl":"https://attacker.example"}`, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/api/v1/service/memorycore/llm", strings.NewReader(tc.body))
			req.Header.Set("Authorization", "Bearer "+tc.token)
			req.Header.Set("Origin", tc.origin)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status %d want %d", rec.Code, tc.status)
			}
			if tc.name == "unknown capability" && !strings.Contains(rec.Body.String(), `"code":"MEMORYCORE_CAPABILITY"`) {
				t.Fatalf("capability body %s", rec.Body.String())
			}
		})
	}
}

type callbackHTTPStore struct {
	purpose  postgres.ResolvedPurpose
	live     error
	budget   bool
	resolves int
	prepared int
}

func (s *callbackHTTPStore) ResolvePurpose(_ context.Context, in postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	s.resolves++
	if s.resolves > 1 && (in.ProviderRevision != nil || in.BindingRevision != nil) {
		return postgres.ResolvedPurpose{}, &postgres.ResolveConflictError{}
	}
	if s.resolves > 1 && s.live != nil {
		return postgres.ResolvedPurpose{}, s.live
	}
	return s.purpose, nil
}
func (s *callbackHTTPStore) PrepareMemoryCoreCall(context.Context, postgres.MemoryCoreCall) (postgres.MemoryExtractPreparation, error) {
	if s.budget {
		return postgres.MemoryExtractPreparation{}, postgres.ErrRateLimited
	}
	s.prepared++
	return postgres.MemoryExtractPreparation{AttemptID: int64(s.prepared), Decision: "EXTRACTABLE"}, nil
}
func (s *callbackHTTPStore) RecordMemoryExtractOutcome(context.Context, int64, int64, int64, postgres.MemoryExtractOutcome) (int64, error) {
	return 1, nil
}

type callbackHTTPProvider struct {
	calls int
	err   error
}

func (p *callbackHTTPProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls++
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if err := emit(companion.OutputDelta{Text: "synthetic"}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2}}, nil
}

func TestMemoryCoreCallbackClosedCodes(t *testing.T) {
	const fact = "synthetic-secret-fact"
	const credential = "synthetic-callback-credential"
	s, _ := newProviderServer(t)
	s.cfg.MemoryCoreCallbackToken = "synthetic-memorycore-service-token"
	var logs bytes.Buffer
	s.log = observability.NewLogger("info", &logs)
	purpose := postgres.ResolvedPurpose{
		ProviderID: "fixture", ProviderName: "Fixture", Protocol: postgres.ProtocolOpenAIChat, Credential: credential,
		Model: postgres.ProviderModel{ModelID: "frozen-model", MaxOutputTokens: 64},
	}
	cases := []struct {
		name   string
		live   error
		stream error
		budget bool
		replay bool
		revoke bool
		want   string
		sent   bool
	}{
		{name: "disabled", live: &postgres.PurposeUnavailableError{Status: postgres.BindingDisabled, Reason: postgres.PurposeReasonDisabled}, want: "MEMORYCORE_PURPOSE_DISABLED"},
		{name: "credential", live: &postgres.PurposeUnavailableError{Status: postgres.BindingUnavailable, Reason: postgres.PurposeReasonCredential}, want: "MEMORYCORE_CREDENTIAL_REVOKED"},
		{name: "budget", budget: true, want: "MEMORYCORE_BUDGET_DENIED"},
		{name: "timeout", stream: companion.Timeout(companion.TimeoutTotal, companion.DeliveryUnknown), want: "MEMORYCORE_UPSTREAM_TIMEOUT", sent: true},
		{name: "malformed", stream: companion.Malformed(companion.DeliveryReceived), want: "MEMORYCORE_UPSTREAM_MALFORMED", sent: true},
		{name: "replay", replay: true, want: "MEMORYCORE_REPLAY", sent: true},
		{name: "revoked", revoke: true, want: "MEMORYCORE_CAPABILITY"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			logs.Reset()
			st := &callbackHTTPStore{purpose: purpose, live: tc.live, budget: tc.budget}
			p := &callbackHTTPProvider{err: tc.stream}
			broker := memorycore.New(st, func(modelprovider.Route) (companion.Provider, error) { return p, nil })
			s.core.MemoryCore = broker
			token, err := broker.Open(context.Background(), memorycore.Scope{Owner: 1, Job: 2, Source: 3, ClaimToken: "lease", ClaimFence: "fence", OperationID: "op", ExpiresAt: time.Now().Add(time.Minute)})
			if err != nil {
				t.Fatal(err)
			}
			sequence := 1
			if tc.replay {
				if rec := callbackPost(t, s, token, 1, fact); rec.Code != 200 {
					t.Fatalf("prime status %d %s", rec.Code, rec.Body.String())
				}
				logs.Reset()
			}
			if tc.revoke {
				broker.Revoke(token)
			}
			rec := callbackPost(t, s, token, sequence, fact)
			if rec.Code != 409 {
				t.Fatalf("status %d %s", rec.Code, rec.Body.String())
			}
			var env map[string]string
			if json.Unmarshal(rec.Body.Bytes(), &env) != nil || env["code"] != tc.want || env["message"] != "memory callback refused" {
				t.Fatalf("body %s", rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), fact) || strings.Contains(rec.Body.String(), credential) || strings.Contains(logs.String(), fact) || strings.Contains(logs.String(), credential) {
				t.Fatal("callback log or response holds body or credential")
			}
			if !strings.Contains(logs.String(), `"decision_code":"`+tc.want+`"`) {
				t.Fatalf("decision_code missing: %s", logs.String())
			}
			if tc.replay {
				if p.calls != 1 {
					t.Fatalf("replay sent again: %d", p.calls)
				}
				return
			}
			if tc.sent != (p.calls > 0) {
				t.Fatalf("sent=%v calls=%d", tc.sent, p.calls)
			}
		})
	}
}

func callbackPost(t *testing.T, s *Server, token string, sequence int, fact string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"operationToken": token, "stage": "l2-scene", "callSequence": sequence, "messages": []map[string]string{{"role": "user", "content": fact}}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/service/memorycore/llm", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+s.cfg.MemoryCoreCallbackToken)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}
