package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestInboxHTTPClaimAckReadAndLease(t *testing.T) {
	store := newInboxHTTPStore()
	body := "下周见"
	own := store.seed(1, 10, 20, "fu-http", "BODY", &body)
	store.seed(2, 11, 21, "fu-other", "BODY", &body)
	waiting := store.seed(1, 10, 20, "fu-wait", "WAITING_HOST", nil)
	srv := newCoreServer(t, "full", store)

	anon := httptest.NewRecorder()
	srv.handleListInbox(anon, httptest.NewRequest(http.MethodGet, "/api/v1/inbox", nil))
	if anon.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous %d", anon.Code)
	}

	rec := inboxRequest(t, srv, store, http.MethodGet, "/api/v1/inbox", "", 1, "", inboxCall{})
	if rec.Code != http.StatusOK {
		t.Fatalf("list %d %s", rec.Code, rec.Body.String())
	}
	var listed []inboxEventJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || strings.Contains(rec.Body.String(), "leaseToken") {
		t.Fatalf("list = %s", rec.Body.String())
	}
	var found, wait inboxEventJSON
	for _, row := range listed {
		if row.EventID == own {
			found = row
		}
		if row.EventID == waiting {
			wait = row
		}
	}
	if !found.Persisted || found.STDelivered || found.Read || found.LinkStatus != "present" || found.Body == nil || *found.Body != body || found.Link.RelationshipID != "10" || found.Link.ConversationID != "20" {
		t.Fatalf("body event = %+v", found)
	}
	if wait.Intent != "WAITING_HOST" || wait.Body != nil || wait.STDelivered {
		t.Fatalf("waiting = %+v", wait)
	}

	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/claim", `{"leaseSeconds":30}`, 1, own, inboxCall{})
	if rec.Code != http.StatusOK {
		t.Fatalf("claim %d %s", rec.Code, rec.Body.String())
	}
	var claim inboxClaimJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &claim); err != nil {
		t.Fatal(err)
	}
	if claim.LeaseToken == "" || claim.LeaseExpiresAt == "" {
		t.Fatalf("claim = %+v", claim)
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/claim", `{"leaseSeconds":30}`, 1, own, inboxCall{})
	if rec.Code != http.StatusConflict {
		t.Fatalf("second claim %d %s", rec.Code, rec.Body.String())
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/fu-other/claim", `{"leaseSeconds":30}`, 1, "fu-other", inboxCall{})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("foreign claim %d", rec.Code)
	}
	assertEnvelope(t, rec, "NOT_FOUND_OR_FORBIDDEN")
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/claim", `{"leaseSeconds":0}`, 1, own, inboxCall{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad lease %d", rec.Code)
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/ack", `{"leaseToken":"nope","messageId":"m1","messageRevision":1}`, 1, own, inboxCall{})
	if rec.Code != http.StatusConflict {
		t.Fatalf("bad token %d %s", rec.Code, rec.Body.String())
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/ack", `{"leaseToken":"`+claim.LeaseToken+`","messageId":"01234567-89ab-4def-8abc-0123456789ab","messageRevision":2}`, 1, own, inboxCall{})
	if rec.Code != http.StatusOK {
		t.Fatalf("ack %d %s", rec.Code, rec.Body.String())
	}
	var acked inboxEventJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &acked); err != nil {
		t.Fatal(err)
	}
	if !acked.STDelivered || acked.Read || acked.LinkStatus != "present" || acked.MessageID == nil || *acked.MessageID != "01234567-89ab-4def-8abc-0123456789ab" || acked.MessageRevision == nil || *acked.MessageRevision != 2 || strings.Contains(rec.Body.String(), "leaseToken") {
		t.Fatalf("ack = %s", rec.Body.String())
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+waiting+"/ack", `{"leaseToken":"x","messageId":"m","messageRevision":1}`, 1, waiting, inboxCall{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("waiting ack %d %s", rec.Code, rec.Body.String())
	}
	store.claimLease(1, waiting, 30)
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+waiting+"/ack", `{"leaseToken":"`+store.lease(1, waiting)+`","messageId":"m","messageRevision":1}`, 1, waiting, inboxCall{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("waiting ack with lease %d %s", rec.Code, rec.Body.String())
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/read", "", 1, own, inboxCall{})
	if rec.Code != http.StatusOK {
		t.Fatalf("read %d %s", rec.Code, rec.Body.String())
	}
	var marked inboxEventJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &marked); err != nil {
		t.Fatal(err)
	}
	if !marked.Read || !marked.STDelivered || marked.LinkStatus != "present" || marked.ReadAt == nil {
		t.Fatalf("read = %+v", marked)
	}
	rec = inboxRequest(t, srv, store, http.MethodPost, "/api/v1/inbox/"+own+"/claim", `{"leaseSeconds":30}`, 1, own, inboxCall{skipCSRF: true})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("csrf %d", rec.Code)
	}

	plain := newCoreServer(t, "full", newMemStore())
	rec = inboxRequest(t, plain, nil, http.MethodGet, "/api/v1/inbox", "", 1, "", inboxCall{})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing store %d", rec.Code)
	}
}

type inboxCall struct {
	skipCSRF bool
}

func inboxRequest(t *testing.T, srv *Server, store *inboxHTTPStore, method, path, body string, account int64, eventID string, call inboxCall) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if eventID != "" {
		req.SetPathValue("eventId", eventID)
	}
	if store != nil {
		raw, hash, err := auth.NewSessionToken()
		if err != nil {
			t.Fatal(err)
		}
		sid, err := store.IssueOpaqueSession(context.Background(), account, hash, time.Now().Add(time.Hour))
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: raw})
		req.Header.Set(expectedAccountHeader, strconv.FormatInt(account, 10))
		req.Header.Set(expectedSessionHeader, strconv.FormatInt(sid, 10))
	} else {
		attachAuth(t, srv, req, account, isStateChanging(method))
	}
	if isStateChanging(method) {
		req.Header.Set("Origin", "https://vc.test")
		if !call.skipCSRF {
			req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
			req.Header.Set(csrfHeader, "csrf-token")
		}
	}
	rec := httptest.NewRecorder()
	switch {
	case method == http.MethodGet && path == "/api/v1/inbox":
		srv.handleListInbox(rec, req)
	case strings.HasSuffix(path, "/claim"):
		srv.handleClaimInbox(rec, req)
	case strings.HasSuffix(path, "/ack"):
		srv.handleAckInbox(rec, req)
	case strings.HasSuffix(path, "/read"):
		srv.handleMarkInboxRead(rec, req)
	default:
		t.Fatalf("unmapped %s %s", method, path)
	}
	return rec
}

type inboxHTTPStore struct {
	*memStore
	mu     sync.Mutex
	events map[string]inboxRec
}

type inboxRec struct {
	owner int64
	row   postgres.InboxEvent
	lease string
	until time.Time
}

func newInboxHTTPStore() *inboxHTTPStore {
	return &inboxHTTPStore{memStore: newMemStore(), events: map[string]inboxRec{}}
}

func inboxKey(owner int64, eventID string) string {
	return strconv.FormatInt(owner, 10) + "/" + eventID
}

func (s *inboxHTTPStore) seed(owner, rel, conv int64, eventID, intent string, body *string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := int64(len(s.events) + 1)
	s.events[inboxKey(owner, eventID)] = inboxRec{owner: owner, row: postgres.InboxEvent{
		ID: id, EventID: eventID, RelationshipID: rel, ConversationID: conv,
		Intent: intent, Body: body, LinkStatus: "present", Persisted: true,
	}}
	return eventID
}

func (s *inboxHTTPStore) claimLease(owner int64, eventID string, seconds int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec := s.events[inboxKey(owner, eventID)]
	rec.lease = "lease-" + eventID
	rec.until = time.Now().Add(time.Duration(seconds) * time.Second)
	s.events[inboxKey(owner, eventID)] = rec
}

func (s *inboxHTTPStore) lease(owner int64, eventID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.events[inboxKey(owner, eventID)].lease
}

func (s *inboxHTTPStore) ListInboxEvents(_ context.Context, owner int64) ([]postgres.InboxEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []postgres.InboxEvent{}
	for _, rec := range s.events {
		if rec.owner == owner {
			out = append(out, rec.row)
		}
	}
	return out, nil
}

func (s *inboxHTTPStore) ClaimInboxEvent(_ context.Context, owner int64, eventID string, leaseSeconds int) (postgres.InboxClaim, error) {
	if leaseSeconds < 1 || leaseSeconds > 120 {
		return postgres.InboxClaim{}, postgres.ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.events[inboxKey(owner, eventID)]
	if !ok || rec.owner != owner {
		return postgres.InboxClaim{}, postgres.ErrNotFound
	}
	if rec.lease != "" && rec.until.After(time.Now()) {
		return postgres.InboxClaim{}, postgres.ErrInboxLeaseHeld
	}
	rec.lease = "lease-" + eventID + "-" + strconv.FormatInt(time.Now().UnixNano(), 10)
	rec.until = time.Now().Add(time.Duration(leaseSeconds) * time.Second)
	s.events[inboxKey(owner, eventID)] = rec
	return postgres.InboxClaim{LeaseToken: rec.lease, LeaseExpiresAt: rec.until}, nil
}

func (s *inboxHTTPStore) AckInboxEvent(_ context.Context, owner int64, eventID, leaseToken, messageID string, messageRevision int64) (postgres.InboxEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.events[inboxKey(owner, eventID)]
	if !ok || rec.owner != owner {
		return postgres.InboxEvent{}, postgres.ErrNotFound
	}
	if rec.row.Intent == "WAITING_HOST" {
		return postgres.InboxEvent{}, postgres.ErrInvalid
	}
	if rec.lease == "" || !rec.until.After(time.Now()) || rec.lease != leaseToken {
		return postgres.InboxEvent{}, postgres.ErrInboxLeaseRejected
	}
	rec.row.STDelivered = true
	rec.row.MessageID = &messageID
	rec.row.MessageRevision = &messageRevision
	rec.lease = ""
	rec.until = time.Time{}
	s.events[inboxKey(owner, eventID)] = rec
	return rec.row, nil
}

func (s *inboxHTTPStore) MarkInboxRead(_ context.Context, owner int64, eventID string) (postgres.InboxEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.events[inboxKey(owner, eventID)]
	if !ok || rec.owner != owner {
		return postgres.InboxEvent{}, postgres.ErrNotFound
	}
	if rec.row.ReadAt == nil {
		now := time.Now().UTC()
		rec.row.ReadAt = &now
	}
	s.events[inboxKey(owner, eventID)] = rec
	return rec.row, nil
}
