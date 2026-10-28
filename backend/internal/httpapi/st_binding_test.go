package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type memSTInstance struct {
	owner        int64
	characterRef string
}

func (m *memStore) ResolveSTBinding(_ context.Context, owner int64, input postgres.STBindingInput) (postgres.STBinding, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.stBindings == nil {
		m.stBindings = map[string]postgres.STBinding{}
		m.stInstances = map[int64]memSTInstance{}
	}
	key := strconv.FormatInt(owner, 10) + ":" + input.ChatIdentity
	if existing, ok := m.stBindings[key]; ok {
		if existing.CharacterRef != input.CharacterRef || existing.Mode != input.Mode ||
			(input.RelationshipID != nil && existing.RelationshipID != *input.RelationshipID) {
			return postgres.STBinding{}, postgres.ErrConflict
		}
		return existing, nil
	}
	var relationshipID int64
	if input.RelationshipID != nil {
		instance, ok := m.stInstances[*input.RelationshipID]
		if !ok || instance.owner != owner {
			return postgres.STBinding{}, postgres.ErrNotFound
		}
		if instance.characterRef != input.CharacterRef {
			return postgres.STBinding{}, postgres.ErrConflict
		}
		relationshipID = *input.RelationshipID
	} else {
		relationshipID = m.next
		m.next++
		m.stInstances[relationshipID] = memSTInstance{owner, input.CharacterRef}
		m.rels[relationshipID] = postgres.Relationship{ID: relationshipID, PersonaRef: "st-character", Active: true}
	}
	conversationID := m.next
	m.next++
	m.convs[conversationID] = postgres.Conversation{ID: conversationID, RelationshipID: relationshipID, CreatedAt: time.Unix(1, 0).UTC()}
	binding := postgres.STBinding{RelationshipID: relationshipID, ConversationID: conversationID,
		ChatIdentity: input.ChatIdentity, CharacterRef: input.CharacterRef, Mode: input.Mode}
	m.stBindings[key] = binding
	return binding, nil
}

func readSTBinding(t *testing.T, rec *httptest.ResponseRecorder) stBindingJSON {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("binding status %d", rec.Code)
	}
	var binding stBindingJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &binding); err != nil {
		t.Fatal(err)
	}
	return binding
}

func TestSTBindingHTTPIdempotencyBranchesAndStringIDs(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	store.next = 9007199254740993 // outside JavaScript's exact-number range
	s := newCoreServer(t, "full", store)
	body := `{"chatIdentity":"chat-one","characterRef":"card-one","mode":"COMPANION","relationshipId":null,"displayName":"澄夏"}`
	first := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 1))
	if id, err := strconv.ParseInt(first.RelationshipID, 10, 64); err != nil || id <= 9007199254740992 {
		t.Fatal("relationship id must preserve the full decimal string")
	}
	if id, err := strconv.ParseInt(first.ConversationID, 10, 64); err != nil || id <= 9007199254740992 {
		t.Fatal("conversation id must preserve the full decimal string")
	}
	if repeated := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 1)); repeated != first {
		t.Fatal("same chat changed its binding")
	}
	branchBody := `{"chatIdentity":"branch-one","characterRef":"card-one","mode":"COMPANION","relationshipId":"` + first.RelationshipID + `"}`
	branch := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", branchBody, 1))
	if branch.RelationshipID != first.RelationshipID || branch.ConversationID == first.ConversationID {
		t.Fatal("explicit branch must reuse only the instance")
	}
	separate := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", strings.Replace(body, "chat-one", "chat-two", 1), 1))
	if separate.RelationshipID == first.RelationshipID {
		t.Fatal("same card must not merge independent instances")
	}
	for _, changed := range []string{
		strings.Replace(body, "card-one", "other-card", 1),
		strings.Replace(body, "COMPANION", "STORY", 1),
		strings.Replace(branchBody, "branch-one", "chat-two", 1),
	} {
		rec := doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", changed, 1)
		if rec.Code != http.StatusConflict {
			t.Fatalf("overwrite status %d", rec.Code)
		}
		assertEnvelope(t, rec, "REVISION_CONFLICT")
	}
	if after := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 1)); after != first {
		t.Fatal("rejected overwrite mutated the original binding")
	}
}

func TestSTBindingHTTPOwnerComesOnlyFromSession(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	body := `{"chatIdentity":"same-chat","characterRef":"same-card","mode":"COMPANION","ownerId":2}`
	first := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 1))
	second := readSTBinding(t, doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 2))
	if first.RelationshipID == second.RelationshipID || first.ConversationID == second.ConversationID {
		t.Fatal("request field overrode the authenticated owner")
	}
	foreign := `{"chatIdentity":"foreign-branch","characterRef":"same-card","mode":"COMPANION","relationshipId":"` + first.RelationshipID + `"}`
	rec := doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", foreign, 2)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-owner relationship status %d", rec.Code)
	}
	assertEnvelope(t, rec, "NOT_FOUND_OR_FORBIDDEN")
}

func TestSTBindingHTTPRejectsInvalidShape(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	s := newCoreServer(t, "full", store)
	for _, body := range []string{
		`{"chatIdentity":"x","characterRef":"c","mode":"UNKNOWN"}`,
		`{"chatIdentity":" ","characterRef":"c","mode":"COMPANION"}`,
		`{"chatIdentity":"x","characterRef":"c","mode":"COMPANION","relationshipId":42}`,
		`{"chatIdentity":"x","characterRef":"c","mode":"COMPANION","relationshipId":"9223372036854775808"}`,
	} {
		rec := doJSON(t, s, http.MethodPost, "/api/v1/st/bindings", body, 1)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("invalid shape status %d", rec.Code)
		}
		assertEnvelope(t, rec, "INVALID_REQUEST")
	}
	if len(store.stBindings) != 0 {
		t.Fatal("invalid input reached binding persistence")
	}
}

func TestSTBindingHTTPRequiresCSRFAndIdentityContext(t *testing.T) {
	t.Parallel()
	for _, tc := range []struct {
		name   string
		change func(*http.Request)
		status int
		code   string
	}{
		{"csrf", func(r *http.Request) { r.Header.Del(csrfHeader) }, http.StatusForbidden, "ACCESS_DENIED"},
		{"account snapshot", func(r *http.Request) { r.Header.Del(expectedAccountHeader) }, http.StatusConflict, "ACCOUNT_CONTEXT_CHANGED"},
		{"stale session", func(r *http.Request) { r.Header.Set(expectedSessionHeader, "9223372036854775807") }, http.StatusConflict, "ACCOUNT_CONTEXT_CHANGED"},
		{"session cookie", func(r *http.Request) {
			r.Header.Del("Cookie")
			r.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
		}, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := newMemStore()
			s := newCoreServer(t, "full", store)
			req := httptest.NewRequest(http.MethodPost, "/api/v1/st/bindings", strings.NewReader(`{"chatIdentity":"x","characterRef":"c","mode":"COMPANION"}`))
			attachAuth(t, s, req, 1, true)
			tc.change(req)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != tc.status {
				t.Fatalf("status %d, want %d", rec.Code, tc.status)
			}
			assertEnvelope(t, rec, tc.code)
			if len(store.stBindings) != 0 {
				t.Fatal("rejected request changed binding state")
			}
		})
	}
}
