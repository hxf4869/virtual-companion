package httpapi

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/datarights"
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
	var deleteObject func(context.Context, string) error
	if s.core.Blobs != nil {
		deleteObject = s.core.Blobs.Delete
	}
	progress, err := datarights.ContinueDeletion(r.Context(), p.AccountID, s.core.Store, deleteObject)
	if err != nil {
		if errors.Is(err, datarights.ErrObjectUnavailable) {
			s.writeJSON(w, http.StatusServiceUnavailable, map[string]any{"code": "INVALID_REQUEST", "message": "account deletion is pending", "status": progress.Status, "pendingDomains": progress.PendingDomains})
		} else {
			s.writeStoreErr(w, err)
		}
		return
	}
	if progress.Status != "COMPLETED" {
		s.writeJSON(w, http.StatusAccepted, progress)
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
