package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/jobs"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestMemoryCandidateLifecycle(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	rel := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	var created relationshipJSON
	_ = json.Unmarshal(rel.Body.Bytes(), &created)
	base := "/api/v1/relationships/" + itoa(created.RelationshipID) + "/memories"
	rec := doJSON(t, s, http.MethodPost, base+"/candidates", `{"scope":"RELATIONSHIP","summary":"fixture-fact"}`, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("create %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "enc2:") {
		t.Fatal("ciphertext leaked")
	}
	var mem memoryJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &mem); err != nil {
		t.Fatal(err)
	}
	if mem.Status != "PENDING_CONFIRMATION" || mem.AutoSaved || mem.Summary != "fixture-fact" {
		t.Fatalf("%+v", mem)
	}
	replay := httptest.NewRequest(http.MethodPost, base+"/candidates", strings.NewReader(`{"scope":"RELATIONSHIP","summary":"fixture-fact"}`))
	replay.Header.Set("Content-Type", "application/json")
	replay.Header.Set("Idempotency-Key", "k1")
	attachAuth(t, s, replay, 1, true)
	first := httptest.NewRecorder()
	s.Handler().ServeHTTP(first, replay)
	if first.Code != http.StatusOK {
		t.Fatalf("idempotent first %d %s", first.Code, first.Body.String())
	}
	secondReq := httptest.NewRequest(http.MethodPost, base+"/candidates", strings.NewReader(`{"scope":"RELATIONSHIP","summary":"other"}`))
	secondReq.Header.Set("Content-Type", "application/json")
	secondReq.Header.Set("Idempotency-Key", "k1")
	attachAuth(t, s, secondReq, 1, true)
	second := httptest.NewRecorder()
	s.Handler().ServeHTTP(second, secondReq)
	if first.Body.String() != second.Body.String() {
		t.Fatalf("idempotent mismatch %s vs %s", first.Body.String(), second.Body.String())
	}

	confirm := doJSON(t, s, http.MethodPost, "/api/v1/memories/"+mem.MemoryID+"/confirm", "", 1)
	if confirm.Code != http.StatusOK {
		t.Fatalf("confirm %d %s", confirm.Code, confirm.Body.String())
	}
	var canonical memoryJSON
	_ = json.Unmarshal(confirm.Body.Bytes(), &canonical)
	if canonical.Status != "ACCEPTED" {
		t.Fatalf("confirm %+v", canonical)
	}
	edit := doJSON(t, s, http.MethodPatch, "/api/v1/memories/"+mem.MemoryID, `{"summary":"fixture-fact-edited"}`, 1)
	if edit.Code != http.StatusOK {
		t.Fatalf("edit %d %s", edit.Code, edit.Body.String())
	}
	ev := doJSON(t, s, http.MethodGet, "/api/v1/memories/"+mem.MemoryID+"/evidence", "", 1)
	if ev.Code != http.StatusOK {
		t.Fatalf("evidence %d %s", ev.Code, ev.Body.String())
	}
	del := doJSON(t, s, http.MethodDelete, "/api/v1/memories/"+mem.MemoryID, "", 1)
	if del.Code != http.StatusOK {
		t.Fatalf("delete %d %s", del.Code, del.Body.String())
	}
	missing := doJSON(t, s, http.MethodGet, "/api/v1/memories/"+mem.MemoryID, "", 1)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("deleted get %d", missing.Code)
	}
	assertEnvelope(t, missing, "NOT_FOUND_OR_FORBIDDEN")

	cand := doJSON(t, s, http.MethodPost, base+"/candidates", `{"scope":"RELATIONSHIP","summary":"reject-me"}`, 1)
	var pending memoryJSON
	_ = json.Unmarshal(cand.Body.Bytes(), &pending)
	rej := doJSON(t, s, http.MethodPost, "/api/v1/memories/"+pending.MemoryID+"/reject", "", 1)
	if rej.Code != http.StatusOK {
		t.Fatalf("reject %d %s", rej.Code, rej.Body.String())
	}
	foreign := doJSON(t, s, http.MethodPost, "/api/v1/relationships/99/memories/candidates", `{"scope":"RELATIONSHIP","summary":"x"}`, 1)
	if foreign.Code != http.StatusNotFound {
		t.Fatalf("foreign %d", foreign.Code)
	}
	assertEnvelope(t, foreign, "NOT_FOUND_OR_FORBIDDEN")
}

func TestConsentWithdrawRequiresPassword(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	grant := doJSON(t, s, http.MethodPut, "/api/v1/consents", `{"consentType":"THIRD_PARTY_MODEL_PROCESSING","version":"2026-08","granted":true}`, 1)
	if grant.Code != http.StatusOK {
		t.Fatalf("grant %d %s", grant.Code, grant.Body.String())
	}
	noPass := doJSON(t, s, http.MethodPut, "/api/v1/consents", `{"consentType":"THIRD_PARTY_MODEL_PROCESSING","version":"2026-08","granted":false}`, 1)
	if noPass.Code != http.StatusBadRequest {
		t.Fatalf("withdraw without password %d", noPass.Code)
	}
	wrong := doJSON(t, s, http.MethodPut, "/api/v1/consents", `{"consentType":"THIRD_PARTY_MODEL_PROCESSING","version":"2026-08","granted":false,"currentPassword":"nope"}`, 1)
	if wrong.Code != http.StatusNotFound {
		t.Fatalf("wrong password %d %s", wrong.Code, wrong.Body.String())
	}
	assertEnvelope(t, wrong, "NOT_FOUND_OR_FORBIDDEN")
	if strings.Contains(wrong.Body.String(), "nope") || strings.Contains(wrong.Body.String(), testPassword) {
		t.Fatal("password leaked")
	}
	ok := doJSON(t, s, http.MethodPut, "/api/v1/consents", `{"consentType":"THIRD_PARTY_MODEL_PROCESSING","version":"2026-08","granted":false,"currentPassword":"`+testPassword+`"}`, 1)
	if ok.Code != http.StatusOK {
		t.Fatalf("withdraw %d %s", ok.Code, ok.Body.String())
	}
}

func TestIncognitoPrefAndReportAndExport(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	got := doJSON(t, s, http.MethodGet, "/api/v1/incognito-pref", "", 1)
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"defaultIncognito":false`) {
		t.Fatalf("pref %s", got.Body.String())
	}
	put := doJSON(t, s, http.MethodPut, "/api/v1/incognito-pref", `{"defaultIncognito":true}`, 1)
	if put.Code != http.StatusOK || !strings.Contains(put.Body.String(), `"defaultIncognito":true`) {
		t.Fatalf("update pref %s", put.Body.String())
	}
	rep := doJSON(t, s, http.MethodPost, "/api/v1/reports", `{"reason":"PRIVACY_OR_DATA","note":"fixture-note"}`, 1)
	if rep.Code != http.StatusOK {
		t.Fatalf("report %d %s", rep.Code, rep.Body.String())
	}
	listed := doJSON(t, s, http.MethodGet, "/api/v1/reports", "", 1)
	if listed.Code != http.StatusOK || !strings.Contains(listed.Body.String(), "PRIVACY_OR_DATA") {
		t.Fatalf("list reports %s", listed.Body.String())
	}

	created := doJSON(t, s, http.MethodPost, "/api/v1/exports", `{"currentPassword":"`+testPassword+`"}`, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("export create %d %s", created.Code, created.Body.String())
	}
	var exp exportJSON
	if err := json.Unmarshal(created.Body.Bytes(), &exp); err != nil {
		t.Fatal(err)
	}
	if exp.DownloadToken == nil || *exp.DownloadToken == "" || exp.Status != "PENDING" {
		t.Fatalf("%+v", exp)
	}
	status := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+exp.ExportID, "", 1)
	if strings.Contains(status.Body.String(), "downloadToken") {
		t.Fatal("status leaked token")
	}
	id := mustParseID(t, exp.ExportID)
	if err := store.CompleteExport(nil, 1, id, `{"exportId":"1","conversations":[]}`, time.Unix(8, 0).UTC()); err != nil {
		t.Fatal(err)
	}
	dl := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+exp.ExportID+"/download?token="+*exp.DownloadToken, "", 1)
	if dl.Code != http.StatusOK {
		t.Fatalf("download %d %s", dl.Code, dl.Body.String())
	}
	again := doJSON(t, s, http.MethodGet, "/api/v1/exports/"+exp.ExportID+"/download?token="+*exp.DownloadToken, "", 1)
	if again.Code != http.StatusNotFound {
		t.Fatalf("second download %d", again.Code)
	}
	assertEnvelope(t, again, "NOT_FOUND_OR_FORBIDDEN")
}

type deletionTrackingStore struct {
	*memStore
	mu             sync.Mutex
	events         []string
	cancelSignals  []int
	recordErr      error
	deleteFailures int
	deleteCalls    int
}

func (s *deletionTrackingStore) RequestAccountDeletion(ctx context.Context, owner int64) error {
	s.mu.Lock()
	s.events = append(s.events, "intent")
	s.mu.Unlock()
	return s.memStore.RequestAccountDeletion(ctx, owner)
}

func (s *deletionTrackingStore) RecordAccountDeletionCancelSignals(_ context.Context, _ int64, count int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, "record")
	s.cancelSignals = append(s.cancelSignals, count)
	return s.recordErr
}

func (s *deletionTrackingStore) event(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, name)
}

func (s *deletionTrackingStore) DeleteAccount(ctx context.Context, owner int64) error {
	s.mu.Lock()
	s.deleteCalls++
	if s.deleteFailures > 0 {
		s.deleteFailures--
		s.mu.Unlock()
		return postgres.ErrInvalid
	}
	s.mu.Unlock()
	return s.memStore.DeleteAccount(ctx, owner)
}

func TestAccountDeletePersistsIntentThenCancelsOwner(t *testing.T) {
	t.Parallel()
	store := &deletionTrackingStore{memStore: newMemStore(), deleteFailures: 1}
	s := newCoreServer(t, "full", store)
	cancels := jobs.NewCancels()
	ownerA1, cancelA1 := context.WithCancel(context.Background())
	ownerA2, cancelA2 := context.WithCancel(context.Background())
	ownerB, cancelB := context.WithCancel(context.Background())
	cancels.Register(1, 11, func() { store.event("cancel-a1"); cancelA1() })
	cancels.Register(1, 12, func() { store.event("cancel-a2"); cancelA2() })
	cancels.Register(2, 21, cancelB)
	s.core.Cancels = cancels

	wrong := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"wrong"}`, 1)
	if wrong.Code != http.StatusNotFound {
		t.Fatalf("wrong %d", wrong.Code)
	}
	first := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if first.Code != http.StatusBadRequest {
		t.Fatalf("first delete %d %s", first.Code, first.Body.String())
	}
	ok := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if ok.Code != http.StatusOK {
		t.Fatalf("retried delete %d %s", ok.Code, ok.Body.String())
	}
	for name, ctx := range map[string]context.Context{"owner A generation 1": ownerA1, "owner A generation 2": ownerA2} {
		select {
		case <-ctx.Done():
		default:
			t.Fatalf("%s was not cancelled", name)
		}
	}
	select {
	case <-ownerB.Done():
		t.Fatal("owner B was cancelled")
	default:
	}
	store.mu.Lock()
	events := append([]string(nil), store.events...)
	counts := append([]int(nil), store.cancelSignals...)
	store.mu.Unlock()
	if len(events) != 6 || events[0] != "intent" || events[3] != "record" || events[4] != "intent" || events[5] != "record" {
		t.Fatalf("deletion order %v", events)
	}
	if len(counts) != 2 || counts[0] != 2 || counts[1] != 0 {
		t.Fatalf("recorded cancel signals %v want [2 0]", counts)
	}
	if got := cancels.CancelOwner(1); got != 0 {
		t.Fatalf("repeated owner A cancels %d want 0", got)
	}
	if got := cancels.CancelOwner(2); got != 1 {
		t.Fatalf("owner B cancels %d want 1", got)
	}
}

func TestAccountDeleteRecordFailureKeepsDurableIntent(t *testing.T) {
	t.Parallel()
	store := &deletionTrackingStore{memStore: newMemStore(), recordErr: postgres.ErrInvalid}
	s := newCoreServer(t, "full", store)
	cancels := jobs.NewCancels()
	providerCtx, cancelProvider := context.WithCancel(context.Background())
	cancels.Register(1, 11, cancelProvider)
	s.core.Cancels = cancels

	rec := doJSON(t, s, http.MethodDelete, "/api/v1/auth/account", `{"currentPassword":"`+testPassword+`"}`, 1)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("delete %d %s", rec.Code, rec.Body.String())
	}
	active, err := store.DeletionIntentActive(context.Background(), 1)
	if err != nil || !active {
		t.Fatalf("durable intent active=%v err=%v", active, err)
	}
	select {
	case <-providerCtx.Done():
	default:
		t.Fatal("provider was not cancelled before recording")
	}
	store.mu.Lock()
	counts := append([]int(nil), store.cancelSignals...)
	deleteCalls := store.deleteCalls
	store.mu.Unlock()
	if len(counts) != 1 || counts[0] != 1 {
		t.Fatalf("record attempts %v want [1]", counts)
	}
	if deleteCalls != 0 || store.deleted {
		t.Fatalf("account delete advanced after record failure: calls=%d deleted=%v", deleteCalls, store.deleted)
	}
}

func TestG8APIMigrationDoesNotRegisterWrites(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "api-migration", newMemStore())
	for _, path := range []string{
		"/api/v1/consents",
		"/api/v1/reports",
		"/api/v1/exports",
		"/api/v1/auth/account",
		"/api/v1/relationships/1/memories/candidates",
	} {
		rec := doJSON(t, s, http.MethodPost, path, `{}`, 1)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %d", path, rec.Code)
		}
	}
	if s.metrics.CoreWrites() != 0 {
		t.Fatalf("write count %d", s.metrics.CoreWrites())
	}
}

func mustParseID(t *testing.T, raw string) int64 {
	t.Helper()
	n, ok := parsePathID(raw)
	if !ok {
		t.Fatalf("id %q", raw)
	}
	return n
}
