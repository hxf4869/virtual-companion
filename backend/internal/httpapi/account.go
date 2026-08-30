package httpapi

import (
	"net/http"
)

func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request) {
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
	if err := s.core.Store.RequestAccountDeletion(r.Context(), p.AccountID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	pointers, err := s.core.Store.ListOwnerExportObjects(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	if len(pointers) > 0 && s.core.Blobs == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	for _, obj := range pointers {
		if err := s.core.Blobs.Delete(r.Context(), obj.ObjectKey); err != nil {
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
			return
		}
		_ = s.core.Store.ClearExportObject(r.Context(), p.AccountID, obj.ExportID, obj.ObjectKey)
	}
	remaining, err := s.core.Store.ListOwnerExportObjects(r.Context(), p.AccountID)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	for _, obj := range remaining {
		if _, err := s.core.Blobs.Get(r.Context(), obj.ObjectKey); err == nil {
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
			return
		}
	}
	if err := s.core.Store.DeleteAccount(r.Context(), p.AccountID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
