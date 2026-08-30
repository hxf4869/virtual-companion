package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
)

type exportJSON struct {
	ExportID      string  `json:"exportId"`
	Status        string  `json:"status"`
	RequestedAt   string  `json:"requestedAt"`
	CompletedAt   *string `json:"completedAt,omitempty"`
	ExpiresAt     *string `json:"expiresAt,omitempty"`
	ErrorMessage  *string `json:"errorMessage,omitempty"`
	DownloadToken *string `json:"downloadToken,omitempty"`
	DownloadURL   *string `json:"downloadUrl,omitempty"`
}

func (s *Server) handleCreateExport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	var body struct {
		CurrentPassword string `json:"currentPassword"`
	}
	if !s.decodeJSON(w, r, &body) {
		return
	}
	if !s.requireCurrentPassword(w, r, p, body.CurrentPassword) {
		return
	}
	token, err := newExportToken()
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	rec, err := s.core.Store.CreateExport(r.Context(), p.AccountID, token)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	download := "/api/v1/exports/" + idString(rec.ID) + "/download?token=" + url.QueryEscape(token)
	s.writeJSON(w, http.StatusOK, exportJSON{
		ExportID:      idString(rec.ID),
		Status:        rec.Status,
		RequestedAt:   rfc3339(rec.RequestedAt),
		CompletedAt:   optTime(rec.CompletedAt),
		ExpiresAt:     optTime(rec.ExpiresAt),
		ErrorMessage:  rec.ErrorMessage,
		DownloadToken: &token,
		DownloadURL:   &download,
	})
}

func (s *Server) handleGetExport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("exportId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	rec, err := s.core.Store.GetExport(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, exportJSON{
		ExportID:     idString(rec.ID),
		Status:       rec.Status,
		RequestedAt:  rfc3339(rec.RequestedAt),
		CompletedAt:  optTime(rec.CompletedAt),
		ExpiresAt:    optTime(rec.ExpiresAt),
		ErrorMessage: rec.ErrorMessage,
	})
}

func (s *Server) handleDownloadExport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("exportId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	token := r.URL.Query().Get("token")
	if token == "" {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	dl, err := s.core.Store.ConsumeExport(r.Context(), p.AccountID, id, token)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if dl.ObjectKey != "" {
		if s.core.Blobs == nil {
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
			return
		}
		envelope, err := s.core.Blobs.Get(r.Context(), dl.ObjectKey)
		if err != nil {
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(envelope)
		_ = s.core.Blobs.Delete(r.Context(), dl.ObjectKey)
		_ = s.core.Store.ClearExportObject(r.Context(), p.AccountID, id, dl.ObjectKey)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(dl.Payload))
}

func newExportToken() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
