package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestProactivePolicyRejectsUnparsedTimezone(t *testing.T) {
	store := newFollowHTTPStore()
	rel := mustFollowRel(t, store, 1)
	srv := newCoreServer(t, "full", store)
	path := "/api/v1/relationships/" + idString(rel) + "/proactive-policy"
	body := func(zone string) string {
		return fmt.Sprintf(`{"enabled":true,"dailyLimit":3,"recentInteractionMinutes":0,"allowedModes":["COMPANION"],"offlineCapable":false,"quietHoursStart":"22:00","quietHoursEnd":"08:00","quietHoursTimezone":%q}`, zone)
	}
	for _, zone := range []string{"asia/shanghai", "UTC+8"} {
		rec := followRequest(t, srv, store, http.MethodPut, path, body(zone), 1, followCall{reauth: true})
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s status %d %s", zone, rec.Code, rec.Body.String())
		}
		assertEnvelope(t, rec, "INVALID_REQUEST")
	}
	rec := followRequest(t, srv, store, http.MethodPut, path, body("Asia/Shanghai"), 1, followCall{reauth: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("Asia/Shanghai %d %s", rec.Code, rec.Body.String())
	}
	var policy proactivePolicyJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &policy); err != nil {
		t.Fatal(err)
	}
	if policy.QuietHoursTimezone == nil || *policy.QuietHoursTimezone != "Asia/Shanghai" {
		t.Fatalf("stored zone = %v", policy.QuietHoursTimezone)
	}
}

func TestFollowUpOperations(t *testing.T) {
	if operation("/api/v1/relationships/10/proactive-policy") != "proactive_policy" {
		t.Fatal(operation("/api/v1/relationships/10/proactive-policy"))
	}
	if operation("/api/v1/relationships/10/follow-ups") != "follow_ups" {
		t.Fatal(operation("/api/v1/relationships/10/follow-ups"))
	}
	if operation("/api/v1/follow-ups/4") != "follow_up" {
		t.Fatal(operation("/api/v1/follow-ups/4"))
	}
	if operation("/api/v1/follow-ups/4/cancel") != "follow_up_cancel" {
		t.Fatal(operation("/api/v1/follow-ups/4/cancel"))
	}
}

func TestFollowUpHTTPAuthAndOwner(t *testing.T) {
	store := newFollowHTTPStore()
	rel1 := mustFollowRel(t, store, 1)
	rel2 := mustFollowRel(t, store, 2)
	trigger := time.Date(2026, 11, 2, 7, 4, 0, 0, time.UTC)
	own := store.seed(1, rel1, "SCHEDULED", &trigger)
	other := store.seed(2, rel2, "SCHEDULED", &trigger)
	srv := newCoreServer(t, "full", store)
	policyBody := `{"enabled":true,"dailyLimit":3,"recentInteractionMinutes":120,"allowedModes":["COMPANION"],"offlineCapable":false,"quietHoursStart":"22:00","quietHoursEnd":"08:00","quietHoursTimezone":"Asia/Shanghai"}`

	anon := httptest.NewRequest(http.MethodGet, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous %d", rec.Code)
	}

	rec = doJSON(t, srv, http.MethodGet, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", "", 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("default policy %d %s", rec.Code, rec.Body.String())
	}
	var policy proactivePolicyJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &policy); err != nil {
		t.Fatal(err)
	}
	if policy.Enabled || policy.OfflineCapable || policy.DailyLimit != 0 || policy.RecentInteractionMinutes != 0 || len(policy.AllowedModes) != 1 || policy.AllowedModes[0] != "COMPANION" || policy.RelationshipID != idString(rel1) || policy.Mode != "OFF" || policy.CheckInAfterMinutes != 720 {
		t.Fatalf("default = %+v", policy)
	}

	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{reauth: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("put %d %s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &policy); err != nil {
		t.Fatal(err)
	}
	if !policy.Enabled || policy.OfflineCapable || policy.DailyLimit != 3 || policy.QuietHoursStart == nil || *policy.QuietHoursStart != "22:00" || policy.Mode != "FOLLOW_UP" || policy.CheckInAfterMinutes != 720 {
		t.Fatalf("put body = %+v", policy)
	}

	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("reauth %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{reauth: true, skipCSRF: true})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("csrf %d", rec.Code)
	}
	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{reauth: true, origin: "https://evil.test"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("origin %d", rec.Code)
	}
	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{reauth: true, skipAccount: true})
	if rec.Code != http.StatusConflict {
		t.Fatalf("account context %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCOUNT_CONTEXT_CHANGED")
	rec = followRequest(t, srv, store, http.MethodPut, "/api/v1/relationships/"+idString(rel1)+"/proactive-policy", policyBody, 1, followCall{reauth: true, account: "2"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("wrong account %d", rec.Code)
	}

	rec = doJSON(t, srv, http.MethodGet, "/api/v1/relationships/"+idString(rel2)+"/proactive-policy", "", 1)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign policy %d", rec.Code)
	}
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/relationships/"+idString(rel2)+"/follow-ups", "", 1)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign list %d", rec.Code)
	}
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/relationships/"+idString(rel1)+"/follow-ups", "", 1)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) == "null" {
		t.Fatalf("list %d %s", rec.Code, rec.Body.String())
	}
	var listed []followUpJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].FollowUpID != idString(own) || listed[0].Status != "SCHEDULED" {
		t.Fatalf("list = %+v", listed)
	}
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/follow-ups/"+idString(other), "", 1)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign follow-up %d", rec.Code)
	}
	rec = doJSON(t, srv, http.MethodGet, "/api/v1/follow-ups/999", "", 1)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing follow-up %d", rec.Code)
	}
	rec = followRequest(t, srv, store, http.MethodPost, "/api/v1/follow-ups/"+idString(other)+"/cancel", "", 1, followCall{reauth: true})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign cancel %d", rec.Code)
	}
	rec = followRequest(t, srv, store, http.MethodPost, "/api/v1/follow-ups/"+idString(own)+"/cancel", "", 1, followCall{reauth: true})
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel %d %s", rec.Code, rec.Body.String())
	}
	var cancelled followUpJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &cancelled); err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != "CANCELLED" || cancelled.TriggerAt != nil || cancelled.EventID == "" {
		t.Fatalf("cancelled = %+v", cancelled)
	}
	rec = followRequest(t, srv, store, http.MethodPost, "/api/v1/follow-ups/"+idString(own)+"/cancel", "", 1, followCall{reauth: true, skipSession: true})
	if rec.Code != http.StatusConflict {
		t.Fatalf("session context %d", rec.Code)
	}

	plain := newCoreServer(t, "full", newMemStore())
	rec = doJSON(t, plain, http.MethodGet, "/api/v1/relationships/1/follow-ups", "", 1)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing store %d", rec.Code)
	}
}

type followCall struct {
	reauth      bool
	skipCSRF    bool
	skipAccount bool
	skipSession bool
	origin      string
	account     string
}

func followRequest(t *testing.T, srv *Server, store *followHTTPStore, method, path, body string, account int64, call followCall) *httptest.ResponseRecorder {
	t.Helper()
	if call.origin == "" {
		call.origin = "https://vc.test"
	}
	if call.account == "" {
		call.account = strconv.FormatInt(account, 10)
	}
	raw, hash, err := auth.NewSessionToken()
	if err != nil {
		t.Fatal(err)
	}
	sid, err := store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if call.reauth {
		if err := store.RecordOpaqueReauth(context.Background(), account, sid); err != nil {
			t.Fatal(err)
		}
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: raw})
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if !call.skipAccount {
		req.Header.Set(expectedAccountHeader, call.account)
	}
	if !call.skipSession {
		req.Header.Set(expectedSessionHeader, strconv.FormatInt(sid, 10))
	}
	if isStateChanging(method) {
		req.Header.Set("Origin", call.origin)
		if !call.skipCSRF {
			req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
			req.Header.Set(csrfHeader, "csrf-token")
		}
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	return rec
}

type followHTTPStore struct {
	*memStore
	policies map[int64]postgres.ProactivePolicy
	rows     map[int64]followRec
}

type followRec struct {
	owner int64
	row   postgres.FollowUp
}

func newFollowHTTPStore() *followHTTPStore {
	return &followHTTPStore{memStore: newMemStore(), policies: map[int64]postgres.ProactivePolicy{}, rows: map[int64]followRec{}}
}

func mustFollowRel(t *testing.T, store *followHTTPStore, owner int64) int64 {
	t.Helper()
	rel, err := store.CreateRelationship(context.Background(), owner, "persona")
	if err != nil {
		t.Fatal(err)
	}
	return rel.ID
}

func (f *followHTTPStore) seed(owner, rel int64, status string, trigger *time.Time) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.next
	f.next++
	mem := id
	row := postgres.FollowUp{
		ID: id, RelationshipID: rel, MemoryItemID: &mem, Status: status, Body: "body",
		NormalizationStatus: "explicit_date", TimePrecision: followStrHTTP("minute"),
		EventDate: followStrHTTP("2026-11-02"), EventTime: followStrHTTP("15:04"),
		EventTimezone: followStrHTTP("Asia/Shanghai"), TriggerAt: trigger,
		EventID: "fu-m-test", Deliverable: "NOT_DELIVERABLE",
	}
	f.rows[id] = followRec{owner: owner, row: row}
	return id
}

func (f *followHTTPStore) owns(owner, rel int64) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.active[owner] == rel && rel != 0
}

func (f *followHTTPStore) GetProactivePolicy(_ context.Context, owner, rel int64) (postgres.ProactivePolicy, error) {
	if !f.owns(owner, rel) {
		return postgres.ProactivePolicy{}, postgres.ErrNotFound
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if row, ok := f.policies[rel]; ok {
		return row, nil
	}
	return postgres.ProactivePolicy{RelationshipID: rel, AllowedModes: []string{"COMPANION"}, Mode: "OFF", CheckInAfterMinutes: 720}, nil
}

func (f *followHTTPStore) PutProactivePolicy(_ context.Context, owner, rel int64, in postgres.ProactivePolicyWrite) (postgres.ProactivePolicy, error) {
	if !f.owns(owner, rel) {
		return postgres.ProactivePolicy{}, postgres.ErrNotFound
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	row := postgres.ProactivePolicy{
		RelationshipID: rel, Enabled: in.Enabled, QuietHoursStart: in.QuietHoursStart,
		QuietHoursEnd: in.QuietHoursEnd, QuietHoursTimezone: in.QuietHoursTimezone,
		DailyLimit: in.DailyLimit, RecentInteractionMinutes: in.RecentInteractionMinutes,
		AllowedModes: append([]string(nil), in.AllowedModes...), OfflineCapable: in.OfflineCapable,
		Mode: modeOr(in.Mode, "OFF"), CheckInAfterMinutes: checkOr(in.CheckInAfterMinutes, 720),
	}
	f.policies[rel] = row
	return row, nil
}

func (f *followHTTPStore) ListFollowUps(_ context.Context, owner, rel int64) ([]postgres.FollowUp, error) {
	if !f.owns(owner, rel) {
		return nil, postgres.ErrNotFound
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []postgres.FollowUp{}
	for _, rec := range f.rows {
		if rec.owner == owner && rec.row.RelationshipID == rel {
			out = append(out, rec.row)
		}
	}
	return out, nil
}

func (f *followHTTPStore) GetFollowUp(_ context.Context, owner, id int64) (postgres.FollowUp, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.rows[id]
	if !ok || rec.owner != owner {
		return postgres.FollowUp{}, postgres.ErrNotFound
	}
	return rec.row, nil
}

func (f *followHTTPStore) CancelFollowUp(_ context.Context, owner, id int64) (postgres.FollowUp, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.rows[id]
	if !ok || rec.owner != owner {
		return postgres.FollowUp{}, postgres.ErrNotFound
	}
	rec.row.Status = "CANCELLED"
	rec.row.TriggerAt = nil
	f.rows[id] = rec
	return rec.row, nil
}

func followStrHTTP(s string) *string { return &s }

func modeOr(v *string, fallback string) string {
	if v == nil || *v == "" {
		return fallback
	}
	return *v
}

func checkOr(v *int, fallback int) int {
	if v == nil {
		return fallback
	}
	return *v
}
