package httpapi

import (
	"net/http"
	"strings"
)

type consentJSON struct {
	ConsentID   string  `json:"consentId"`
	ConsentType string  `json:"consentType"`
	Version     string  `json:"version"`
	Granted     bool    `json:"granted"`
	GrantedAt   string  `json:"grantedAt"`
	RevokedAt   *string `json:"revokedAt,omitempty"`
}

type incognitoPrefJSON struct {
	DefaultIncognito bool `json:"defaultIncognito"`
}

func (s *Server) handleListConsents(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	list, err := s.core.Store.ListConsents(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	out := make([]consentJSON, 0, len(list))
	for _, c := range list {
		out = append(out, consentJSON{
			ConsentID:   idString(c.ID),
			ConsentType: c.Type,
			Version:     c.Version,
			Granted:     c.Granted,
			GrantedAt:   rfc3339(c.GrantedAt),
			RevokedAt:   optTime(c.RevokedAt),
		})
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleRecordConsent(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		ConsentType     string `json:"consentType"`
		Version         string `json:"version"`
		Granted         *bool  `json:"granted"`
		CurrentPassword string `json:"currentPassword"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.Granted == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	if !*body.Granted {
		if !s.requireCurrentPassword(w, r, p, body.CurrentPassword) {
			return
		}
	}
	rec, err := s.core.Store.RecordConsent(r.Context(), p.AccountID, strings.TrimSpace(body.ConsentType), strings.TrimSpace(body.Version), *body.Granted)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, consentJSON{
		ConsentID:   idString(rec.ID),
		ConsentType: rec.Type,
		Version:     rec.Version,
		Granted:     rec.Granted,
		GrantedAt:   rfc3339(rec.GrantedAt),
		RevokedAt:   optTime(rec.RevokedAt),
	})
}

func (s *Server) handleGetIncognitoPref(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	v, err := s.core.Store.GetIncognitoPref(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, incognitoPrefJSON{DefaultIncognito: v})
}

func (s *Server) handleUpdateIncognitoPref(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		DefaultIncognito *bool `json:"defaultIncognito"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if body.DefaultIncognito == nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	v, err := s.core.Store.UpdateIncognitoPref(r.Context(), p.AccountID, *body.DefaultIncognito)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, incognitoPrefJSON{DefaultIncognito: v})
}
