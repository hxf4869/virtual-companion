package httpapi

import (
	"net/http"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type ageStateJSON struct {
	AgeState    string  `json:"ageState"`
	ProviderRef *string `json:"providerRef"`
	VerifiedAt  *string `json:"verifiedAt"`
}

func (s *Server) handleGetAgeState(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	state, err := s.core.Store.GetAgeState(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, ageStateResponse(state))
}

func (s *Server) handleVerifyAge(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	state, err := s.core.Store.VerifyAge(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, ageStateResponse(state))
}

func ageStateResponse(state postgres.AgeState) ageStateJSON {
	var verifiedAt *string
	if state.VerifiedAt != nil {
		v := rfc3339(*state.VerifiedAt)
		verifiedAt = &v
	}
	return ageStateJSON{
		AgeState:    state.State,
		ProviderRef: state.ProviderRef,
		VerifiedAt:  verifiedAt,
	}
}
