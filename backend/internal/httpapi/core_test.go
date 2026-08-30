package httpapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
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
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	testJWTSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	testIssuer    = "virtual-companion"
	testPassword  = "test-pass-1"
)

type memStore struct {
	mu         sync.Mutex
	next       int64
	rels       map[int64]postgres.Relationship
	convs      map[int64]postgres.Conversation
	msgs       map[int64]postgres.Message
	active     map[int64]int64
	memories   map[int64]postgres.Memory
	evidence   map[int64][]postgres.MemoryEvidence
	idem       map[string]int64
	consents   map[string]postgres.Consent
	incognito  bool
	reports    map[int64]postgres.Report
	exports    map[int64]postgres.Export
	exportBody map[int64]string
	exportTok  map[int64]string
	identities map[string]postgres.Identity
	deleting   bool
	deleted    bool
}

func newMemStore() *memStore {
	hash, _ := auth.Hash(testPassword)
	return &memStore{
		next:       1,
		rels:       map[int64]postgres.Relationship{},
		convs:      map[int64]postgres.Conversation{},
		msgs:       map[int64]postgres.Message{},
		active:     map[int64]int64{},
		memories:   map[int64]postgres.Memory{},
		evidence:   map[int64][]postgres.MemoryEvidence{},
		idem:       map[string]int64{},
		consents:   map[string]postgres.Consent{},
		reports:    map[int64]postgres.Report{},
		exports:    map[int64]postgres.Export{},
		exportBody: map[int64]string{},
		exportTok:  map[int64]string{},
		identities: map[string]postgres.Identity{
			"alice": {AccountID: 1, Role: "USER", Status: "ACTIVE", PasswordHash: hash},
			"bob":   {AccountID: 2, Role: "USER", Status: "ACTIVE", PasswordHash: hash},
		},
	}
}

func (m *memStore) CreateRelationship(_ context.Context, owner int64, personaRef string) (postgres.Relationship, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id := m.next
	m.next++
	if prev, ok := m.active[owner]; ok {
		rel := m.rels[prev]
		rel.Active = false
		m.rels[prev] = rel
	}
	rel := postgres.Relationship{
		ID: id, PersonaRef: personaRef, Active: true, CreatedAt: time.Unix(1, 0).UTC(),
		ReplyLength: "MEDIUM", Initiative: "LOW", Humor: "LIGHT", AdvicePref: "ASK_FIRST",
		MemoryShareScope: "RELATIONSHIP", AvoidTopics: []string{}, Gender: "NEUTRAL",
		AvatarRef: "AVATAR_NEUTRAL_01",
	}
	m.rels[id] = rel
	m.active[owner] = id
	return rel, nil
}

func (m *memStore) ListRelationships(_ context.Context, _ int64) ([]postgres.Relationship, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]postgres.Relationship, 0, len(m.rels))
	for _, r := range m.rels {
		out = append(out, r)
	}
	return out, nil
}

func (m *memStore) ActivateRelationship(_ context.Context, owner, id int64) (postgres.Relationship, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rel, ok := m.rels[id]
	if !ok {
		return postgres.Relationship{}, postgres.ErrNotFound
	}
	if prev, ok := m.active[owner]; ok && prev != id {
		old := m.rels[prev]
		old.Active = false
		m.rels[prev] = old
	}
	rel.Active = true
	m.rels[id] = rel
	m.active[owner] = id
	return rel, nil
}

func (m *memStore) DeactivateRelationship(_ context.Context, _, id int64) (postgres.Relationship, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rel, ok := m.rels[id]
	if !ok {
		return postgres.Relationship{}, postgres.ErrNotFound
	}
	rel.Active = false
	m.rels[id] = rel
	return rel, nil
}

func (m *memStore) UpdateRelationshipPrefs(_ context.Context, _, id int64, prefs postgres.RelationshipPrefs) (postgres.Relationship, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rel, ok := m.rels[id]
	if !ok {
		return postgres.Relationship{}, postgres.ErrNotFound
	}
	rel.CompanionName = prefs.CompanionName
	rel.UserAddressAs = prefs.UserAddressAs
	rel.ReplyLength = prefs.ReplyLength
	rel.Initiative = prefs.Initiative
	rel.Humor = prefs.Humor
	rel.AdvicePref = prefs.AdvicePref
	rel.RemindersAllowed = prefs.RemindersAllowed
	rel.MemoryShareScope = prefs.MemoryShareScope
	rel.AvoidTopics = prefs.AvoidTopics
	rel.Gender = prefs.Gender
	rel.AvatarRef = prefs.AvatarRef
	m.rels[id] = rel
	return rel, nil
}

func (m *memStore) DeleteRelationship(_ context.Context, _, id int64, _ bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rels[id]; !ok {
		return postgres.ErrNotFound
	}
	delete(m.rels, id)
	return nil
}

func (m *memStore) CreateConversation(_ context.Context, _, relationshipID int64, incognito bool) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.rels[relationshipID]; !ok {
		return 0, postgres.ErrNotFound
	}
	id := m.next
	m.next++
	m.convs[id] = postgres.Conversation{ID: id, RelationshipID: relationshipID, CreatedAt: time.Unix(1, 0).UTC(), Incognito: incognito}
	return id, nil
}

func (m *memStore) ListConversations(_ context.Context, _ int64, _, _ *int64, _ *int) ([]postgres.Conversation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]postgres.Conversation, 0, len(m.convs))
	for _, c := range m.convs {
		out = append(out, c)
	}
	return out, nil
}

func (m *memStore) DeleteConversation(_ context.Context, _, id int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.convs[id]; !ok {
		return postgres.ErrNotFound
	}
	delete(m.convs, id)
	return nil
}

func (m *memStore) RenameConversation(_ context.Context, _, id int64, title string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.convs[id]
	if !ok {
		return postgres.ErrNotFound
	}
	c.Title = &title
	m.convs[id] = c
	return nil
}

func (m *memStore) EndConversation(_ context.Context, _, id int64) (postgres.ConversationEnd, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.convs[id]
	if !ok {
		return postgres.ConversationEnd{}, postgres.ErrNotFound
	}
	return postgres.ConversationEnd{OK: true, IncognitoCleared: c.Incognito}, nil
}

func (m *memStore) PreviewChatWipe(context.Context, int64) (postgres.ChatWipePreview, error) {
	return postgres.ChatWipePreview{ConversationCount: int64(len(m.convs)), MessageCount: int64(len(m.msgs))}, nil
}

func (m *memStore) WipeAllChats(context.Context, int64) (postgres.ChatWipeResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := int64(len(m.convs))
	m.convs = map[int64]postgres.Conversation{}
	m.msgs = map[int64]postgres.Message{}
	return postgres.ChatWipeResult{ConversationsDeleted: n}, nil
}

func (m *memStore) ListMessages(_ context.Context, _, conversationID int64, _ *int64, _ *int) ([]postgres.Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []postgres.Message
	for _, msg := range m.msgs {
		if msg.ConversationID == conversationID {
			out = append(out, msg)
		}
	}
	if out == nil {
		out = []postgres.Message{}
	}
	return out, nil
}

func (m *memStore) DeleteMessage(_ context.Context, _, _, messageID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.msgs[messageID]; !ok {
		return postgres.ErrNotFound
	}
	delete(m.msgs, messageID)
	return nil
}

func (m *memStore) SetMessageNoMemory(_ context.Context, _, _, messageID int64, noMemory bool) (postgres.Message, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	msg, ok := m.msgs[messageID]
	if !ok {
		return postgres.Message{}, postgres.ErrNotFound
	}
	msg.NoMemory = noMemory
	m.msgs[messageID] = msg
	return msg, nil
}

func TestAPIMigrationDoesNotRegisterCoreRoutesEvenWithCore(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "api-migration", newMemStore())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/relationships", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration write %d body %s", rec.Code, rec.Body.String())
	}
	if s.metrics.CoreWrites() != 0 {
		t.Fatalf("write count %d", s.metrics.CoreWrites())
	}
}

func TestCoreRequiresBearer(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/relationships", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("code %d", rec.Code)
	}
	assertEnvelope(t, rec, "AUTHENTICATION_REQUIRED")
}

func TestCreateRelationshipUnknownPersona(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	rec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"evil-villain"}`, 1)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code %d body %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "INVALID_REQUEST")
	if strings.Contains(rec.Body.String(), "evil-villain") {
		t.Fatal("must not echo rejected persona")
	}
}

func TestCreateListActivateDeactivateDelete(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	rec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if rec.Code != http.StatusOK {
		t.Fatalf("create %d %s", rec.Code, rec.Body.String())
	}
	var created relationshipJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.PersonaRef != "gentle-listener" || !created.Active {
		t.Fatalf("%+v", created)
	}
	list := doJSON(t, s, http.MethodGet, "/api/v1/relationships", "", 1)
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "gentle-listener") {
		t.Fatalf("list %s", list.Body.String())
	}
	id := created.RelationshipID
	act := doJSON(t, s, http.MethodPost, "/api/v1/relationships/"+itoa(id), "", 1)
	if act.Code != http.StatusOK {
		t.Fatalf("activate %d %s", act.Code, act.Body.String())
	}
	deact := doJSON(t, s, http.MethodPost, "/api/v1/relationships/"+itoa(id)+"/deactivate", "", 1)
	if deact.Code != http.StatusOK {
		t.Fatalf("deactivate %d %s", deact.Code, deact.Body.String())
	}
	del := doJSON(t, s, http.MethodDelete, "/api/v1/relationships/"+itoa(id), "", 1)
	if del.Code != http.StatusOK {
		t.Fatalf("delete %d %s", del.Code, del.Body.String())
	}
	missing := doJSON(t, s, http.MethodDelete, "/api/v1/relationships/999", "", 1)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("missing %d", missing.Code)
	}
	assertEnvelope(t, missing, "NOT_FOUND_OR_FORBIDDEN")
	if strings.Contains(missing.Body.String(), "999") {
		t.Fatal("must not echo id")
	}
	if s.metrics.CoreWrites() == 0 {
		t.Fatal("writer invocations must be counted in full mode")
	}
}

func TestRetiredAndGenerationRoutesStayUnmapped(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	token := mintAccessToken(t, 1)
	for _, path := range []string{
		"/api/v1/relationships/1",
		"/api/v1/relationships/1/reset",
		"/api/v1/relationships/1/clearance-preview",
		"/api/v1/conversations/1/generations",
		"/api/v1/conversations/1/summary",
		"/api/v1/memories/auto-save",
		"/api/v1/reports/1",
	} {
		method := http.MethodGet
		if strings.HasSuffix(path, "/reset") || strings.HasSuffix(path, "/generations") {
			method = http.MethodPost
		}
		req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s -> %d", method, path, rec.Code)
		}
	}
}

func TestForeignConversationAndMessage(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	create := doJSON(t, s, http.MethodPost, "/api/v1/conversations", `{"relationshipId":99}`, 1)
	if create.Code != http.StatusNotFound {
		t.Fatalf("create foreign %d %s", create.Code, create.Body.String())
	}
	assertEnvelope(t, create, "NOT_FOUND_OR_FORBIDDEN")
	end := doJSON(t, s, http.MethodPost, "/api/v1/conversations/99/end", "", 1)
	if end.Code != http.StatusNotFound {
		t.Fatalf("end %d", end.Code)
	}
	assertEnvelope(t, end, "NOT_FOUND_OR_FORBIDDEN")
}

func TestOriginRejectedOnWrite(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/relationships", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	req.Header.Set("Authorization", "Bearer "+mintAccessToken(t, 1))
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code %d", rec.Code)
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
}

func TestCSRFRequiredWhenCookiePresent(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	req := httptest.NewRequest(http.MethodPost, "/api/v1/relationships", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	req.Header.Set("Authorization", "Bearer "+mintAccessToken(t, 1))
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("code %d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodPost, "/api/v1/relationships", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	req.Header.Set("Authorization", "Bearer "+mintAccessToken(t, 1))
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	req.Header.Set(csrfHeader, "csrf-token")
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("csrf ok %d %s", rec.Code, rec.Body.String())
	}
}

func TestPrefsRejectUnknownCatalog(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	created := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	var rel relationshipJSON
	_ = json.Unmarshal(created.Body.Bytes(), &rel)
	body := `{"replyLength":"HUGE","initiative":"LOW","humor":"LIGHT","advicePref":"ASK_FIRST","remindersAllowed":false,"memoryShareScope":"RELATIONSHIP","avoidTopics":[],"gender":"NEUTRAL","avatarRef":"AVATAR_NEUTRAL_01"}`
	rec := doJSON(t, s, http.MethodPatch, "/api/v1/relationships/"+itoa(rel.RelationshipID), body, 1)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("code %d %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "INVALID_REQUEST")
}

func TestErrorEnvelopeHasNoDetails(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	rec := doJSON(t, s, http.MethodDelete, "/api/v1/conversations/42", "", 1)
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if _, ok := env["details"]; ok {
		t.Fatalf("details present: %v", env)
	}
	if env["code"] != "NOT_FOUND_OR_FORBIDDEN" {
		t.Fatalf("%v", env)
	}
}

func newCoreServer(t *testing.T, mode string, store CompanionStore) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return mode
		case "VC_VERSION":
			return "test-version"
		case "VC_HTTP_ORIGINS":
			return "https://vc.test"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	ver, err := auth.NewVerifier(testJWTSecret, testIssuer)
	if err != nil {
		t.Fatal(err)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{Store: store, JWT: ver, Passwords: pw})
}

func doJSON(t *testing.T, s *Server, method, path, body string, account int64) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != "" {
		rdr = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Authorization", "Bearer "+mintAccessTokenNamed(t, account, usernameFor(account)))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func usernameFor(account int64) string {
	if account == 2 {
		return "bob"
	}
	return "alice"
}

func assertEnvelope(t *testing.T, rec *httptest.ResponseRecorder, code string) {
	t.Helper()
	var env struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("envelope %s", rec.Body.String())
	}
	if env.Code != code {
		t.Fatalf("code %q want %q body %s", env.Code, code, rec.Body.String())
	}
	if env.Message == "" {
		t.Fatal("empty message")
	}
}

func mintAccessToken(t *testing.T, account int64) string {
	t.Helper()
	return mintAccessTokenNamed(t, account, "alice")
}

func mintAccessTokenNamed(t *testing.T, account int64, username string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256"}`))
	payload, err := json.Marshal(map[string]any{
		"iss":      testIssuer,
		"sub":      itoa(account),
		"role":     "USER",
		"username": username,
		"se":       1,
		"exp":      time.Now().Add(time.Hour).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	signing := header + "." + body
	mac := hmac.New(sha256.New, []byte(testJWTSecret))
	_, _ = mac.Write([]byte(signing))
	return signing + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
