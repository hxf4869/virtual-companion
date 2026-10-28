package httpapi

import (
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"net/http"
	"regexp"
)

func (s *Server) handleReconcileSTSources(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		ChatIdentities []string `json:"chatIdentities"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if len(body.ChatIdentities) == 0 || len(body.ChatIdentities) > 64 {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "expected 1..64 chat identities")
		return
	}
	seen := map[string]bool{}
	for _, id := range body.ChatIdentities {
		if !stsource.ValidIdentity(id) || seen[id] {
			s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid chat identities")
			return
		}
		seen[id] = true
	}
	states, err := s.core.Store.ReconcileSTSources(r.Context(), p.AccountID, body.ChatIdentities)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, states)
}

var stHandlePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func (s *Server) handleRegisterSTProfile(w http.ResponseWriter, r *http.Request) {
	if !s.serviceCaller(w, r) {
		return
	}
	if s.cfg.STPlugin.HostBaseURL == "" || s.core.Store == nil {
		s.writeAPIError(w, 503, "INVALID_REQUEST", "ST data channel is not configured")
		return
	}
	var body struct {
		Owner  string `json:"ownerAccountId"`
		Handle string `json:"handle"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	owner, ok := parsePathID(body.Owner)
	if !ok || idString(owner) != body.Owner || !stHandlePattern.MatchString(body.Handle) {
		s.writeAPIError(w, 400, "INVALID_REQUEST", "invalid ST profile")
		return
	}
	if err := s.core.Store.RegisterSTProfile(r.Context(), owner, body.Handle); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, 200, map[string]string{"ownerAccountId": body.Owner, "handle": body.Handle})
}
