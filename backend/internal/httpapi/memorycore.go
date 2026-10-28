package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"github.com/hxf4869/virtual-companion/internal/memorycore"
	"io"
	"net/http"
)

func (s *Server) handleMemoryCoreLLM(w http.ResponseWriter, r *http.Request) {
	token := s.cfg.MemoryCoreCallbackToken
	if token == "" || s.core == nil || s.core.MemoryCore == nil {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "memory callback unavailable")
		return
	}
	if r.Header.Get("Origin") != "" {
		s.writeAPIError(w, 403, "ACCESS_DENIED", "browser origin rejected")
		return
	}
	expected := "Bearer " + token
	actual := r.Header.Get("Authorization")
	if len(actual) != len(expected) || subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) != 1 {
		s.writeAPIError(w, 401, "AUTHENTICATION_REQUIRED", "service authentication required")
		return
	}
	var body memorycore.Request
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&body) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid callback request")
		return
	}
	out, err := s.core.MemoryCore.Call(r.Context(), body)
	if err != nil {
		s.writeAPIError(w, 409, "INVALID_REQUEST", "memory callback refused or failed")
		return
	}
	s.writeJSON(w, 200, out)
}
