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
	cancelSignals := 0
	if s.core.Cancels != nil {
		cancelSignals = s.core.Cancels.CancelOwner(p.AccountID)
	}
	if err := s.core.Store.RecordAccountDeletionCancelSignals(r.Context(), p.AccountID, cancelSignals); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	// Each successful clear removes this batch from the durable worklist.
	// Continue until empty; an ambiguous read/clear failure must never permit
	// the account cascade to discard pointers to objects still in storage.
	for {
		pointers, err := s.core.Store.ListOwnerExportObjects(r.Context(), p.AccountID)
		if err != nil {
			s.writeStoreErr(w, err)
			return
		}
		if len(pointers) == 0 {
			break
		}
		if s.core.Blobs == nil {
			s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
			return
		}
		for _, obj := range pointers {
			if err := s.core.Blobs.Delete(r.Context(), obj.ObjectKey); err != nil {
				s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
				return
			}
			if err := s.core.Store.ClearExportObject(r.Context(), p.AccountID, obj.ExportID, obj.ObjectKey); err != nil {
				s.writeStoreErr(w, err)
				return
			}
		}
	}
	if err := s.core.Store.DeleteAccount(r.Context(), p.AccountID); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	// VC-R16: the server-side cascade above (the account and every session
	// it owned) is the deletion contract. The response sets no cookies: an
	// expiring Set-Cookie is addressed by name and path only, so a delayed
	// success response would delete whatever vc_session/vc_csrf a newer
	// login has just installed. The deleted account's cookies left in the
	// browser are inert until the next login overwrites them.
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
