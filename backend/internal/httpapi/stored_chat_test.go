package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	testStoredChatID    = "0c7a4c00-1b11-4444-8000-0d5020a70201"
	testStoredMessageID = "0c7a4c00-1b11-4444-8000-0d5020a70202"
	testStoredChatsPath = "/api/v1/chats"
)

type storedChatReadCall struct {
	method        string
	owner         int64
	chatID        string
	messageID     string
	list          postgres.ChatListQuery
	messages      postgres.ChatMessageQuery
	afterRevision int64
	limit         int
}

type recordingStoredChatReader struct {
	*memStore
	calls []storedChatReadCall
	err   error
}

func (s *recordingStoredChatReader) ListStoredChats(_ context.Context, owner int64, query postgres.ChatListQuery) (postgres.StoredChatPage, error) {
	s.calls = append(s.calls, storedChatReadCall{method: "list", owner: owner, list: query})
	return postgres.StoredChatPage{AuthorityEpoch: 3}, s.err
}

func (s *recordingStoredChatReader) GetStoredChat(_ context.Context, owner int64, chatID string) (postgres.StoredChat, error) {
	s.calls = append(s.calls, storedChatReadCall{method: "chat", owner: owner, chatID: chatID})
	return postgres.StoredChat{StoredChatSummary: postgres.StoredChatSummary{ChatID: chatID}}, s.err
}

func (s *recordingStoredChatReader) ListStoredMessages(_ context.Context, owner int64, chatID string, query postgres.ChatMessageQuery) (postgres.StoredMessagePage, error) {
	s.calls = append(s.calls, storedChatReadCall{method: "messages", owner: owner, chatID: chatID, messages: query})
	page := postgres.StoredMessagePage{ChatID: chatID, Revision: 4}
	if query.IncludeChat {
		page.Chat = &postgres.StoredChat{StoredChatSummary: postgres.StoredChatSummary{ChatID: chatID}}
	}
	return page, s.err
}

func (s *recordingStoredChatReader) GetStoredMessage(_ context.Context, owner int64, chatID, messageID string) (postgres.StoredMessage, error) {
	s.calls = append(s.calls, storedChatReadCall{method: "message", owner: owner, chatID: chatID, messageID: messageID})
	message := postgres.StoredMessage{MessageID: messageID, View: "full", Data: postgres.ChatData{"mes": "synthetic-stored-chat-text"}}
	if owner != 1 {
		return message, fmt.Errorf("synthetic-private-error-detail: %w", postgres.ErrNotFound)
	}
	return message, s.err
}

func (s *recordingStoredChatReader) ListStoredChatChanges(_ context.Context, owner int64, chatID string, afterRevision int64, limit int) (postgres.ChatChangesPage, error) {
	s.calls = append(s.calls, storedChatReadCall{method: "changes", owner: owner, chatID: chatID, afterRevision: afterRevision, limit: limit})
	return postgres.ChatChangesPage{ChatID: chatID, ThroughRevision: afterRevision}, s.err
}

func TestStoredChatReadIdentityAndAvailability(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatReader{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	session, sessionID := issueSessionWithID(t, s, 1)

	rejected := []struct {
		name, account, sessionID string
		cookie                   *http.Cookie
		status                   int
		code                     string
	}{
		{"expected headers without cookie", "1", sessionID, nil, 401, "AUTHENTICATION_REQUIRED"},
		{"stale account", "2", sessionID, session, 409, "ACCOUNT_CONTEXT_CHANGED"},
		{"stale session", "1", "0", session, 409, "ACCOUNT_CONTEXT_CHANGED"},
	}
	for _, tc := range rejected {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, testStoredChatsPath, nil)
			req.Header.Set(expectedAccountHeader, tc.account)
			req.Header.Set(expectedSessionHeader, tc.sessionID)
			if tc.cookie != nil {
				req.AddCookie(tc.cookie)
			}
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			assertStoredChatError(t, rec, tc.status, tc.code)
		})
	}

	s.cfg.RestoreGateFile = filepath.Join(t.TempDir(), "restore-gate.json")
	if err := os.WriteFile(s.cfg.RestoreGateFile, []byte(`{"blocked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertStoredChatError(t, doJSON(t, s, http.MethodGet, testStoredChatsPath, "", 1), 503, "SCHEMA_UNAVAILABLE")
	if len(store.calls) != 0 {
		t.Fatalf("rejected reads reached the store: %d calls", len(store.calls))
	}

	if err := os.Remove(s.cfg.RestoreGateFile); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, testStoredChatsPath, nil)
	req.AddCookie(session)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || len(store.calls) != 1 || store.calls[0].owner != 1 {
		t.Fatalf("cookie-only read status=%d calls=%d", rec.Code, len(store.calls))
	}

	withoutReader := newCoreServer(t, "full", newMemStore())
	assertStoredChatError(t, doJSON(t, withoutReader, http.MethodGet, testStoredChatsPath, "", 1), 503, "SCHEMA_UNAVAILABLE")
}

type failingStoredChatSessions struct{}

func (failingStoredChatSessions) Lookup(context.Context, string) (*auth.Principal, error) {
	return nil, errors.New("synthetic-private-session-detail")
}

func TestStoredChatReadSessionUnavailable(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatReader{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	s.core.Sessions = failingStoredChatSessions{}
	chatPath := testStoredChatsPath + "/" + testStoredChatID
	for _, path := range []string{
		testStoredChatsPath,
		chatPath,
		chatPath + "/messages",
		chatPath + "/messages/" + testStoredMessageID,
		chatPath + "/changes?afterRevision=0",
	} {
		t.Run(path, func(t *testing.T) {
			rec := doJSON(t, s, http.MethodGet, path, "", 1)
			assertStoredChatError(t, rec, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE")
			if strings.Contains(rec.Body.String(), "synthetic-private-session-detail") {
				t.Fatal("response leaked session store error detail")
			}
		})
	}
	if len(store.calls) != 0 {
		t.Fatalf("session lookup failure reached the chat store: %d calls", len(store.calls))
	}
	legacy := doJSON(t, s, http.MethodGet, "/api/v1/conversations", "", 1)
	assertStoredChatError(t, legacy, http.StatusServiceUnavailable, "INVALID_REQUEST")
}

func TestStoredChatReadValidQueriesAndEmptyPages(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatReader{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	chatPath := testStoredChatsPath + "/" + strings.ToUpper(testStoredChatID)
	messagePath := chatPath + "/messages"
	relationshipID := int64(19)
	tests := []struct {
		path string
		call storedChatReadCall
		wire map[string]string
	}{
		{
			path: testStoredChatsPath + "?cursor=opaque&characterRef=card-a&relationshipId=19&q=+Title+&limit=200",
			call: storedChatReadCall{method: "list", owner: 1, list: postgres.ChatListQuery{
				Cursor: "opaque", CharacterRef: "card-a", RelationshipID: &relationshipID, Q: "Title", Limit: 200,
			}},
			wire: map[string]string{"items": "[]", "nextCursor": "null", "authorityEpoch": `"3"`},
		},
		{
			path: chatPath,
			call: storedChatReadCall{method: "chat", owner: 1, chatID: testStoredChatID},
			wire: map[string]string{"chatId": `"` + testStoredChatID + `"`},
		},
		{
			path: messagePath + "?before=older&view=full&include=chat&q=+Mixed+Case+",
			call: storedChatReadCall{method: "messages", owner: 1, chatID: testStoredChatID, messages: postgres.ChatMessageQuery{
				Before: "older", View: "full", IncludeChat: true, Q: "Mixed Case", Limit: 50,
			}},
			wire: map[string]string{"items": "[]", "beforeCursor": "null", "afterCursor": "null", "hasOlder": "false", "hasNewer": "false", "chatRevision": `"4"`},
		},
		{
			path: messagePath + "?after=newer",
			call: storedChatReadCall{method: "messages", owner: 1, chatID: testStoredChatID, messages: postgres.ChatMessageQuery{
				After: "newer", View: "display", Limit: 50,
			}},
			wire: map[string]string{"chat": ""},
		},
		{
			path: messagePath + "?anchorMessageId=" + strings.ToUpper(testStoredMessageID) + "&limit=1",
			call: storedChatReadCall{method: "messages", owner: 1, chatID: testStoredChatID, messages: postgres.ChatMessageQuery{
				AnchorMessageID: testStoredMessageID, View: "display", Limit: 1,
			}},
		},
		{
			path: messagePath + "/" + strings.ToUpper(testStoredMessageID),
			call: storedChatReadCall{method: "message", owner: 1, chatID: testStoredChatID, messageID: testStoredMessageID},
			wire: map[string]string{"messageId": `"` + testStoredMessageID + `"`, "view": `"full"`},
		},
		{
			path: chatPath + "/changes?afterRevision=0",
			call: storedChatReadCall{method: "changes", owner: 1, chatID: testStoredChatID, limit: 50},
			wire: map[string]string{"items": "[]", "throughRevision": `"0"`},
		},
	}
	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			store.calls = nil
			rec := doJSON(t, s, http.MethodGet, tc.path, "", 1)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d", rec.Code)
			}
			if !reflect.DeepEqual(store.calls, []storedChatReadCall{tc.call}) {
				t.Fatalf("backend calls=%+v, want %+v", store.calls, tc.call)
			}
			fields := decodeStoredChatResponse(t, rec)
			for key, want := range tc.wire {
				if got := string(fields[key]); got != want {
					t.Errorf("field %s does not match %q", key, want)
				}
			}
			if tc.call.messages.IncludeChat && (fields["chat"] == nil || string(fields["chat"]) == "null") {
				t.Error("requested chat missing")
			}
		})
	}
}

func TestStoredChatReadRejectsInvalidQueries(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatReader{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	chatPath := testStoredChatsPath + "/" + testStoredChatID
	messages := chatPath + "/messages"
	changes := chatPath + "/changes"
	for _, path := range []string{
		testStoredChatsPath + "/invalid",
		testStoredChatsPath + "?cursor=",
		testStoredChatsPath + "?relationshipId=01",
		testStoredChatsPath + "?relationshipId=0",
		testStoredChatsPath + "?relationshipId=%2B1",
		testStoredChatsPath + "?limit=0",
		testStoredChatsPath + "?limit=201",
		testStoredChatsPath + "?limit=1&limit=2",
		messages + "/invalid",
		messages + "?before=older&after=newer",
		messages + "?before=older&anchorMessageId=" + testStoredMessageID,
		messages + "?after=newer&anchorMessageId=" + testStoredMessageID,
		messages + "?anchorMessageId=invalid",
		messages + "?view=other",
		messages + "?include=",
		messages + "?q=%xy",
		changes,
		changes + "?afterRevision=-1",
		changes + "?afterRevision=9223372036854775808",
	} {
		t.Run(path, func(t *testing.T) {
			assertStoredChatError(t, doJSON(t, s, http.MethodGet, path, "", 1), 400, "INVALID_REQUEST")
		})
	}
	if len(store.calls) != 0 {
		t.Fatalf("invalid requests reached the store: %d calls", len(store.calls))
	}
}

func TestStoredChatReadStoreErrors(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatReader{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	chatPath := testStoredChatsPath + "/" + testStoredChatID
	messagePath := chatPath + "/messages/" + testStoredMessageID
	foreign := doJSON(t, s, http.MethodGet, messagePath, "", 2)
	assertStoredChatError(t, foreign, 404, "NOT_FOUND_OR_FORBIDDEN")
	store.err = postgres.ErrNotFound
	missing := doJSON(t, s, http.MethodGet, messagePath, "", 1)
	assertStoredChatError(t, missing, 404, "NOT_FOUND_OR_FORBIDDEN")
	if foreign.Body.String() != missing.Body.String() {
		t.Fatal("foreign and missing message envelopes differ")
	}
	if strings.Contains(foreign.Body.String(), "synthetic-") {
		t.Fatal("foreign response leaked backend body or error detail")
	}

	for _, tc := range []struct {
		path   string
		err    error
		status int
		code   string
	}{
		{chatPath + "/messages?before=wrong-filter", postgres.ErrInvalid, 400, "INVALID_REQUEST"},
		{chatPath + "/messages?before=expired", &postgres.ChatError{Code: "CHAT_CURSOR_EXPIRED"}, 410, "CHAT_CURSOR_EXPIRED"},
		{chatPath + "/changes?afterRevision=0", &postgres.ChatError{Code: "CHAT_CHANGES_EXPIRED"}, 410, "CHAT_CHANGES_EXPIRED"},
		{messagePath, errors.New("synthetic-private-storage-detail"), 503, "SCHEMA_UNAVAILABLE"},
		{messagePath, &postgres.ChatError{Code: "synthetic-unknown-chat-code"}, 503, "SCHEMA_UNAVAILABLE"},
	} {
		store.err = tc.err
		rec := doJSON(t, s, http.MethodGet, tc.path, "", 1)
		assertStoredChatError(t, rec, tc.status, tc.code)
		if strings.Contains(rec.Body.String(), "synthetic-") {
			t.Fatal("response leaked backend body or error detail")
		}
	}
}

func assertStoredChatError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status=%d, want %d", rec.Code, status)
	}
	body := decodeStoredChatResponse(t, rec)
	if len(body) != 2 || string(body["code"]) != `"`+code+`"` || len(body["message"]) == 0 {
		t.Fatalf("expected a body-free %s envelope", code)
	}
}

func decodeStoredChatResponse(t *testing.T, rec *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	if rec.Header().Get("Content-Type") != "application/json" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("response must be noncacheable JSON")
	}
	var body map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not a JSON object: %v", err)
	}
	return body
}
