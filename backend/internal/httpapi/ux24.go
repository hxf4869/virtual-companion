package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// ReplySuggester is the background-model pass behind reply-suggestions.
type ReplySuggester interface {
	SuggestReplies(ctx context.Context, owner, relationshipID int64, messages []proactive.SuggestMessage) ([]string, error)
}

type relationshipCheckStore interface {
	RelationshipOwned(ctx context.Context, owner, relationshipID int64) error
}

type memoryPinStore interface {
	SetMemoryPin(ctx context.Context, owner, id int64, pinned bool) error
}

type favoriteStore interface {
	CreateFavorite(ctx context.Context, owner, relationshipID int64, in postgres.FavoriteWrite) (postgres.Favorite, error)
	ListFavorites(ctx context.Context, owner, relationshipID, after int64, limit int) ([]postgres.Favorite, string, error)
	DeleteFavorite(ctx context.Context, owner, id int64) error
}

type reminderStore interface {
	CreateReminder(ctx context.Context, owner, relationshipID int64, text string, remindAt time.Time, recurrence string) (postgres.Reminder, error)
	ListActiveReminders(ctx context.Context, owner, relationshipID int64, limit int) ([]postgres.Reminder, error)
	DeleteReminder(ctx context.Context, owner, id int64) error
}

type diaryStore interface {
	ListDiaryMonth(ctx context.Context, owner, relationshipID int64, month string) ([]postgres.DiaryEntry, error)
	GetDiaryEntry(ctx context.Context, owner, id int64) (postgres.DiaryEntry, error)
}

func storeAs[T any](s *Server, w http.ResponseWriter) (T, bool) {
	var zero T
	if s.core == nil || s.core.Store == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return zero, false
	}
	st, ok := s.core.Store.(T)
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return zero, false
	}
	return st, true
}

// handlePutMemoryPin and handleDeleteMemoryPin return the refreshed memory.
func (s *Server) handlePutMemoryPin(w http.ResponseWriter, r *http.Request) {
	s.setMemoryPin(w, r, true)
}
func (s *Server) handleDeleteMemoryPin(w http.ResponseWriter, r *http.Request) {
	s.setMemoryPin(w, r, false)
}

func (s *Server) setMemoryPin(w http.ResponseWriter, r *http.Request, pinned bool) {
	if s.restoreGateClosed(w) {
		return
	}
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("memoryId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	pins, ok := storeAs[memoryPinStore](s, w)
	if !ok {
		return
	}
	memories := s.managedMemories(w)
	if memories == nil {
		return
	}
	if err := pins.SetMemoryPin(r.Context(), p.AccountID, id, pinned); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	row, err := memories.GetManagedMemory(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, row)
}

type favoriteJSON struct {
	FavoriteID     string  `json:"favoriteId"`
	RelationshipID string  `json:"relationshipId"`
	ChatFile       string  `json:"chatFile"`
	MesID          int     `json:"mesId"`
	Role           string  `json:"role"`
	MessageAt      *string `json:"messageAt"`
	Body           string  `json:"body"`
	CreatedAt      string  `json:"createdAt"`
}

func favoriteJSONFrom(f postgres.Favorite) favoriteJSON {
	return favoriteJSON{
		FavoriteID: idString(f.ID), RelationshipID: idString(f.RelationshipID), ChatFile: f.ChatFile,
		MesID: f.MesID, Role: f.Role, MessageAt: optTime(f.MessageAt), Body: f.Body, CreatedAt: rfc3339(f.CreatedAt),
	}
}

func (s *Server) handleCreateFavorite(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var req struct {
		ChatFile  string  `json:"chatFile"`
		MesID     *int    `json:"mesId"`
		Role      string  `json:"role"`
		MessageAt *string `json:"messageAt"`
		Body      string  `json:"body"`
	}
	if !s.decodeJSON(w, r, &req) {
		return
	}
	in := postgres.FavoriteWrite{ChatFile: req.ChatFile, Role: req.Role, Body: req.Body}
	if req.MesID == nil || *req.MesID < 0 {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	in.MesID = *req.MesID
	if req.MessageAt != nil && *req.MessageAt != "" {
		at, err := time.Parse(time.RFC3339, *req.MessageAt)
		if err != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		in.MessageAt = &at
	}
	st, ok := storeAs[favoriteStore](s, w)
	if !ok {
		return
	}
	row, err := st.CreateFavorite(r.Context(), p.AccountID, id, in)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, favoriteJSONFrom(row))
}

func (s *Server) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	limit, after := 30, int64(0)
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		limit = n
	}
	if raw := r.URL.Query().Get("after"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || n < 1 {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		after = n
	}
	st, ok := storeAs[favoriteStore](s, w)
	if !ok {
		return
	}
	rows, next, err := st.ListFavorites(r.Context(), p.AccountID, id, after, limit)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	items := make([]favoriteJSON, 0, len(rows))
	for _, row := range rows {
		items = append(items, favoriteJSONFrom(row))
	}
	body := map[string]any{"items": items}
	if next != "" {
		body["nextCursor"] = next
	}
	s.writeJSON(w, http.StatusOK, body)
}

func (s *Server) handleDeleteFavorite(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("favoriteId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st, ok := storeAs[favoriteStore](s, w)
	if !ok {
		return
	}
	if err := st.DeleteFavorite(r.Context(), p.AccountID, id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type reminderJSON struct {
	ReminderID     string `json:"reminderId"`
	RelationshipID string `json:"relationshipId"`
	Text           string `json:"text"`
	RemindAt       string `json:"remindAt"`
	Recurrence     string `json:"recurrence"`
	Status         string `json:"status"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

func reminderJSONFrom(r postgres.Reminder) reminderJSON {
	return reminderJSON{
		ReminderID: idString(r.ID), RelationshipID: idString(r.RelationshipID), Text: r.Text,
		RemindAt: rfc3339(r.RemindAt), Recurrence: r.Recurrence, Status: r.Status,
		CreatedAt: rfc3339(r.CreatedAt), UpdatedAt: rfc3339(r.UpdatedAt),
	}
}

func (s *Server) handleCreateReminder(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var req struct {
		Text       string `json:"text"`
		RemindAt   string `json:"remindAt"`
		Recurrence string `json:"recurrence"`
	}
	if !s.decodeJSON(w, r, &req) {
		return
	}
	text := strings.TrimSpace(req.Text)
	// RFC3339 needs Z or a numeric offset, so date-only and zoneless values fail here.
	at, err := time.Parse(time.RFC3339, req.RemindAt)
	if text == "" || utf8.RuneCountInString(text) > 500 || err != nil || at.Before(time.Now().Add(-time.Minute)) {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	recurrence := req.Recurrence
	if recurrence == "" {
		recurrence = "NONE"
	}
	if recurrence != "NONE" && recurrence != "DAILY" && recurrence != "WEEKLY" {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st, ok := storeAs[reminderStore](s, w)
	if !ok {
		return
	}
	row, err := st.CreateReminder(r.Context(), p.AccountID, id, text, at, recurrence)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, reminderJSONFrom(row))
}

func (s *Server) handleListReminders(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
		limit = n
	}
	st, ok := storeAs[reminderStore](s, w)
	if !ok {
		return
	}
	rows, err := st.ListActiveReminders(r.Context(), p.AccountID, id, limit)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	items := make([]reminderJSON, 0, len(rows))
	for _, row := range rows {
		items = append(items, reminderJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, items)
}

func (s *Server) handleDeleteReminder(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("reminderId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st, ok := storeAs[reminderStore](s, w)
	if !ok {
		return
	}
	if err := st.DeleteReminder(r.Context(), p.AccountID, id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

type diaryJSON struct {
	EntryID        string   `json:"entryId"`
	RelationshipID string   `json:"relationshipId"`
	Day            string   `json:"day"`
	Body           string   `json:"body"`
	Vibe           string   `json:"vibe"`
	Moments        []string `json:"moments"`
	CreatedAt      string   `json:"createdAt"`
}

func diaryJSONFrom(d postgres.DiaryEntry) diaryJSON {
	moments := d.Moments
	if moments == nil {
		moments = []string{}
	}
	return diaryJSON{
		EntryID: idString(d.ID), RelationshipID: idString(d.RelationshipID), Day: d.Day,
		Body: d.Body, Vibe: d.Vibe, Moments: moments, CreatedAt: rfc3339(d.CreatedAt),
	}
}

// handleListDiary returns the month's days with a page. Each item already carries the
// body (at most 300 runes), so the month view needs no second request per day.
func (s *Server) handleListDiary(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	month := r.URL.Query().Get("month")
	if _, err := time.Parse("2006-01", month); !ok || err != nil {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	st, ok := storeAs[diaryStore](s, w)
	if !ok {
		return
	}
	rows, err := st.ListDiaryMonth(r.Context(), p.AccountID, id, month)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	items := make([]diaryJSON, 0, len(rows))
	for _, row := range rows {
		items = append(items, diaryJSONFrom(row))
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"month": month, "items": items})
}

func (s *Server) handleGetDiaryEntry(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, false)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("entryId"))
	if !ok {
		s.writeAPIError(w, http.StatusNotFound, "NOT_FOUND_OR_FORBIDDEN", "not found")
		return
	}
	st, ok := storeAs[diaryStore](s, w)
	if !ok {
		return
	}
	row, err := st.GetDiaryEntry(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeStoreErr(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, diaryJSONFrom(row))
}

func (s *Server) handleReplySuggestions(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipal(w, r, true)
	if p == nil {
		return
	}
	id, ok := parsePathID(r.PathValue("relationshipId"))
	if !ok {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	var req struct {
		Messages []proactive.SuggestMessage `json:"messages"`
	}
	if !s.decodeJSON(w, r, &req) {
		return
	}
	if len(req.Messages) == 0 || len(req.Messages) > proactive.SuggestMaxMessages {
		s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
		return
	}
	for _, m := range req.Messages {
		if m.Role != "user" && m.Role != "character" {
			s.writeAPIError(w, http.StatusBadRequest, "INVALID_REQUEST", "invalid request")
			return
		}
	}
	if s.core == nil || s.core.Suggester == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	owned, ok := storeAs[relationshipCheckStore](s, w)
	if !ok {
		return
	}
	if err := owned.RelationshipOwned(r.Context(), p.AccountID, id); err != nil {
		s.writeStoreErr(w, err)
		return
	}
	items, err := s.core.Suggester.SuggestReplies(r.Context(), p.AccountID, id, req.Messages)
	if err != nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "temporarily unavailable")
		return
	}
	if items == nil {
		items = []string{}
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"suggestions": items})
}
