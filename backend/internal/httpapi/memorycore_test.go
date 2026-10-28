package httpapi

import (
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
		})
	}
}
