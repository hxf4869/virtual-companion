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
	testStoredWriteRequestID = "0c7a4c00-1b11-4444-8000-0d5020a70203"
	testStoredCandidateID    = "0c7a4c00-1b11-4444-8000-0d5020a70204"
	testStoredRunID          = "0c7a4c00-1b11-4444-8000-0d5020a70205"
	testStoredWriteEnvelope  = `"requestId":"` + testStoredWriteRequestID + `","authorityEpoch":"3"`
	testStoredCreateBody     = `{` + testStoredWriteEnvelope + `,"kind":"GROUP","groupRef":"g1"}`
	testStoredChatPath       = testStoredChatsPath + "/" + testStoredChatID
	testStoredGenerationPath = "/api/v1/service/chats/" + testStoredChatID + "/generation-runs"
	testStoredGenerationBody = `{` + testStoredWriteEnvelope + `,"ownerAccountId":"2","chatRevision":"7","generationRunId":"` +
		testStoredRunID + `","inputMessageId":"` + testStoredMessageID + `","inputCandidateId":"` + testStoredCandidateID + `"}`
)

type storedChatWriteCall struct {
	method, chatID, messageID string
	owner                     int64
	input                     any
}

type recordingStoredChatWriter struct {
	*memStore
	calls       []storedChatWriteCall
	err         error
	deletionErr error
}

func (s *recordingStoredChatWriter) DeletionIntentActive(ctx context.Context, owner int64) (bool, error) {
	if s.deletionErr != nil {
		return false, s.deletionErr
	}
	return s.memStore.DeletionIntentActive(ctx, owner)
}

func (s *recordingStoredChatWriter) CreateStoredChat(_ context.Context, owner int64, in postgres.ChatCreate) (postgres.StoredChat, error) {
	s.calls = append(s.calls, storedChatWriteCall{method: "create", owner: owner, input: in})
	return postgres.StoredChat{StoredChatSummary: postgres.StoredChatSummary{ChatID: testStoredChatID}}, s.err
}

func (s *recordingStoredChatWriter) DeleteStoredChat(_ context.Context, owner int64, id string, in postgres.ChatDeleteRequest) (postgres.ChatCommit, error) {
	return s.commit("delete", owner, id, "", in)
}

func (s *recordingStoredChatWriter) AppendStoredMessages(_ context.Context, owner int64, id string, in postgres.ChatAppendRequest) (postgres.ChatCommit, error) {
	return s.commit("append", owner, id, "", in)
}

func (s *recordingStoredChatWriter) EditStoredMessage(_ context.Context, owner int64, id, messageID string, in postgres.ChatMessageEditRequest) (postgres.ChatCommit, error) {
	return s.commit("edit", owner, id, messageID, in)
}

func (s *recordingStoredChatWriter) EditStoredChatMetadata(_ context.Context, owner int64, id string, in postgres.ChatMetadataEditRequest) (postgres.ChatCommit, error) {
	return s.commit("metadata", owner, id, "", in)
}

func (s *recordingStoredChatWriter) ApplyStoredChatOperations(_ context.Context, owner int64, id string, in postgres.ChatOperationsRequest) (postgres.ChatCommit, error) {
	return s.commit("operations", owner, id, "", in)
}

func (s *recordingStoredChatWriter) ForkStoredChat(_ context.Context, owner int64, id string, in postgres.ChatForkRequest) (postgres.ChatForkResult, error) {
	s.calls = append(s.calls, storedChatWriteCall{method: "fork", owner: owner, chatID: id, input: in})
	return postgres.ChatForkResult{RequestID: in.RequestID}, s.err
}

func (s *recordingStoredChatWriter) RegisterStoredChatGeneration(_ context.Context, owner int64, id string, in postgres.ChatGenerationRegistrationRequest) (postgres.ChatGenerationRegistration, error) {
	s.calls = append(s.calls, storedChatWriteCall{method: "register", owner: owner, chatID: id, input: in})
	return postgres.ChatGenerationRegistration{ChatID: id, RunID: in.RunID, Revision: in.Revision}, s.err
}

func (s *recordingStoredChatWriter) commit(method string, owner int64, id, messageID string, in any) (postgres.ChatCommit, error) {
	s.calls = append(s.calls, storedChatWriteCall{method: method, owner: owner, chatID: id, messageID: messageID, input: in})
	commit := postgres.ChatCommit{ChatID: id, Changed: []postgres.StoredMessage{{Data: postgres.ChatData{"mes": "synthetic-private-body"}}}}
	if owner != 1 {
		return commit, fmt.Errorf("synthetic-foreign-error: %w", postgres.ErrNotFound)
	}
	return commit, s.err
}

func TestStoredChatWriteIdentityAndAvailability(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	s.cfg.STPlugin.ServiceToken = "synthetic-service-token"
	tests := []struct {
		name   string
		change func(*http.Request)
		status int
		code   string
	}{
		{"missing Origin", func(r *http.Request) { r.Header.Del("Origin") }, 403, "ACCESS_DENIED"},
		{"wrong Origin", func(r *http.Request) { r.Header.Set("Origin", "https://vc.test.evil") }, 403, "ACCESS_DENIED"},
		{"missing CSRF", func(r *http.Request) { r.Header.Del(csrfHeader) }, 403, "ACCESS_DENIED"},
		{"Bearer without session", func(r *http.Request) {
			csrf := r.Header.Get(csrfHeader)
			r.Header.Del("Cookie")
			r.AddCookie(&http.Cookie{Name: auth.CSRFCookieName, Value: csrf})
			r.Header.Set("Authorization", "Bearer "+s.cfg.STPlugin.ServiceToken)
		}, 401, "AUTHENTICATION_REQUIRED"},
		{"missing expected account", func(r *http.Request) { r.Header.Del(expectedAccountHeader) }, 409, "ACCOUNT_CONTEXT_CHANGED"},
		{"wrong expected account", func(r *http.Request) { r.Header.Set(expectedAccountHeader, "2") }, 409, "ACCOUNT_CONTEXT_CHANGED"},
		{"missing expected session", func(r *http.Request) { r.Header.Del(expectedSessionHeader) }, 409, "ACCOUNT_CONTEXT_CHANGED"},
		{"wrong expected session", func(r *http.Request) { r.Header.Set(expectedSessionHeader, "999") }, 409, "ACCOUNT_CONTEXT_CHANGED"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, testStoredChatsPath, strings.NewReader(testStoredCreateBody))
			attachAuth(t, s, req, 1, true)
			tc.change(req)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			assertStoredChatError(t, rec, tc.status, tc.code)
		})
	}

	store.deletionErr = errors.New("synthetic-private-deletion-lookup")
	failed := doJSON(t, s, http.MethodPost, testStoredChatsPath, testStoredCreateBody, 1)
	assertStoredChatError(t, failed, 503, "SCHEMA_UNAVAILABLE")
	if strings.Contains(failed.Body.String(), "synthetic-") {
		t.Fatal("deletion lookup leaked storage detail")
	}
	legacy := doJSON(t, s, http.MethodPost, "/api/v1/conversations", "{}", 1)
	assertStoredChatError(t, legacy, 503, "INVALID_REQUEST")
	store.deletionErr = nil

	s.cfg.RestoreGateFile = filepath.Join(t.TempDir(), "restore-gate.json")
	if err := os.WriteFile(s.cfg.RestoreGateFile, []byte(`{"blocked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertStoredChatError(t, doJSON(t, s, http.MethodPost, testStoredChatsPath, testStoredCreateBody, 1), 503, "SCHEMA_UNAVAILABLE")
	if len(store.calls) != 0 {
		t.Fatalf("rejected writes reached the store: %d calls", len(store.calls))
	}

	withoutWriter := newCoreServer(t, "full", newMemStore())
	assertStoredChatError(t, doJSON(t, withoutWriter, http.MethodPost, testStoredChatsPath, testStoredCreateBody, 1), 503, "SCHEMA_UNAVAILABLE")
}

func TestStoredChatWriteDispatch(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	group := "g1"
	candidate := testStoredCandidateID
	commit := &postgres.ChatGenerationCommit{RunID: testStoredRunID, State: "aborted"}
	generation := `,"generation":{"generationRunId":"` + testStoredRunID + `","state":"aborted"}`
	changes := `[{"path":["extra","script"],"before":{"exists":true,"value":null},"after":{"exists":true,"value":9007199254740993}}]`
	expectedChanges := []postgres.ChatFieldChange{{
		Path: []string{"extra", "script"}, Before: postgres.ChatFieldValue{Exists: true},
		After: postgres.ChatFieldValue{Exists: true, Value: json.Number("9007199254740993")},
	}}
	op := `{"kind":"removeSwipe","target":{"messageId":"` + testStoredMessageID + `","candidateId":"` + candidate +
		`"},"preconditions":{"messageRevision":"7","selectedCandidateId":"` + candidate + `"},"payload":{"replacementCandidateId":null}}`
	path := testStoredChatsPath + "/" + strings.ToUpper(testStoredChatID)
	tests := []struct {
		method, path, body string
		call               storedChatWriteCall
		status             int
	}{
		{http.MethodPost, testStoredChatsPath, testStoredCreateBody, storedChatWriteCall{method: "create", owner: 1,
			input: postgres.ChatCreate{RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, Kind: "GROUP", GroupRef: &group}}, 201},
		{http.MethodDelete, path, `{` + testStoredWriteEnvelope + `,"chatRevision":"7"}`, storedChatWriteCall{method: "delete", owner: 1,
			chatID: testStoredChatID, input: postgres.ChatDeleteRequest{RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, Revision: 7}}, 200},
		{http.MethodPost, path + "/messages", `{` + testStoredWriteEnvelope + `,"messages":[{"clientMessageId":"` + testStoredMessageID +
			`","data":{"mes":" hi ","script":{"literal":9007199254740993,"nullable":null}}}]` + generation + `}`, storedChatWriteCall{method: "append", owner: 1,
			chatID: testStoredChatID, input: postgres.ChatAppendRequest{RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, Generation: commit,
				Messages: []postgres.ChatAppendMessage{{MessageID: testStoredMessageID,
					Data: postgres.ChatData{"mes": " hi ", "script": map[string]any{"literal": json.Number("9007199254740993"), "nullable": nil}}}}}}, 200},
		{http.MethodPatch, path + "/messages/" + strings.ToUpper(testStoredMessageID),
			`{` + testStoredWriteEnvelope + `,"baseRevision":"7","candidateId":"` + candidate + `","changes":` + changes + generation + `}`,
			storedChatWriteCall{method: "edit", owner: 1, chatID: testStoredChatID, messageID: testStoredMessageID, input: postgres.ChatMessageEditRequest{
				RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, BaseRevision: 7, CandidateID: &candidate, Changes: expectedChanges, Generation: commit}}, 200},
		{http.MethodPatch, path + "/metadata", `{` + testStoredWriteEnvelope + `,"baseRevision":"7","changes":` + changes + `}`,
			storedChatWriteCall{method: "metadata", owner: 1, chatID: testStoredChatID, input: postgres.ChatMetadataEditRequest{
				RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, BaseRevision: 7, Changes: expectedChanges}}, 200},
		{http.MethodPost, path + "/operations", `{` + testStoredWriteEnvelope + `,"operations":[` + op + `]}`,
			storedChatWriteCall{method: "operations", owner: 1, chatID: testStoredChatID, input: postgres.ChatOperationsRequest{
				RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, Operations: []postgres.ChatOperation{{
					Kind: "removeSwipe", Target: json.RawMessage(`{"messageId":"` + testStoredMessageID + `","candidateId":"` + candidate + `"}`),
					Preconditions: json.RawMessage(`{"messageRevision":"7","selectedCandidateId":"` + candidate + `"}`),
					Payload:       json.RawMessage(`{"replacementCandidateId":null}`),
				}}}}, 200},
		{http.MethodPost, path + "/forks", `{` + testStoredWriteEnvelope + `,"parentRevision":"7","throughMessageId":"` + testStoredMessageID + `"}`,
			storedChatWriteCall{method: "fork", owner: 1, chatID: testStoredChatID, input: postgres.ChatForkRequest{
				RequestID: testStoredWriteRequestID, AuthorityEpoch: 3, ParentRevision: 7, ThroughID: testStoredMessageID}}, 200},
	}
	for _, tc := range tests {
		t.Run(tc.call.method, func(t *testing.T) {
			store.calls = nil
			rec := doJSON(t, s, tc.method, tc.path, tc.body, 1)
			if rec.Code != tc.status {
				t.Fatalf("status=%d want=%d response=%s", rec.Code, tc.status, rec.Body.String())
			}
			decodeStoredChatResponse(t, rec)
			if !reflect.DeepEqual(store.calls, []storedChatWriteCall{tc.call}) {
				t.Fatalf("backend calls=%+v, want %+v", store.calls, tc.call)
			}
		})
	}
}

func TestStoredChatWriteBodyValidation(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	appendPath := testStoredChatPath + "/messages"
	metadataPath := testStoredChatPath + "/metadata"
	operationsPath := testStoredChatPath + "/operations"
	bodyPrefix := `{` + testStoredWriteEnvelope + `,`
	message := `{"clientMessageId":"` + testStoredMessageID + `","data":{"mes":"synthetic"}}`
	tests := []struct {
		name, method, path, body string
		status                   int
	}{
		{"absent request ID", http.MethodPost, testStoredChatsPath, `{"authorityEpoch":"3","kind":"GROUP","groupRef":"g"}`, 400},
		{"absent epoch", http.MethodPost, testStoredChatsPath, `{"requestId":"` + testStoredWriteRequestID + `","kind":"GROUP","groupRef":"g"}`, 428},
		{"null epoch", http.MethodPost, testStoredChatsPath, strings.Replace(testStoredCreateBody, `"3"`, "null", 1), 400},
		{"numeric epoch", http.MethodPost, testStoredChatsPath, strings.Replace(testStoredCreateBody, `"3"`, "3", 1), 400},
		{"epoch leading zero", http.MethodPost, testStoredChatsPath, strings.Replace(testStoredCreateBody, `"3"`, `"03"`, 1), 400},
		{"forbidden group mode", http.MethodPost, testStoredChatsPath, bodyPrefix + `"kind":"GROUP","groupRef":"g","mode":""}`, 400},
		{"null optional title", http.MethodPost, testStoredChatsPath, bodyPrefix + `"kind":"GROUP","groupRef":"g","title":null}`, 400},
		{"wrong key case", http.MethodPost, testStoredChatsPath, strings.Replace(testStoredCreateBody, "requestId", "RequestId", 1), 400},
		{"duplicate envelope key", http.MethodPost, testStoredChatsPath, bodyPrefix + `"kind":"SINGLE","kind":"GROUP","groupRef":"g"}`, 400},
		{"multiple JSON values", http.MethodPost, testStoredChatsPath, testStoredCreateBody + `{}`, 400},
		{"null body", http.MethodPost, testStoredChatsPath, `null`, 400},
		{"unknown top level field", http.MethodPost, appendPath, bodyPrefix + `"chatRevision":"7","messages":[` + message + `]}`, 400},
		{"unknown append field", http.MethodPost, appendPath, bodyPrefix + `"messages":[{"clientMessageId":"` + testStoredMessageID + `","data":{},"body":"x"}]}`, 400},
		{"null append data", http.MethodPost, appendPath, bodyPrefix + `"messages":[{"clientMessageId":"` + testStoredMessageID + `","data":null}]}`, 400},
		{"empty append array", http.MethodPost, appendPath, bodyPrefix + `"messages":[]}`, 400},
		{"null generation", http.MethodPost, appendPath, bodyPrefix + `"messages":[` + message + `],"generation":null}`, 400},
		{"invalid generation", http.MethodPost, appendPath, bodyPrefix + `"messages":[` + message + `],"generation":{"generationRunId":"` + testStoredRunID + `","state":"started"}}`, 400},
		{"absent delete revision", http.MethodDelete, testStoredChatPath, `{` + testStoredWriteEnvelope + `}`, 428},
		{"absent edit revision", http.MethodPatch, metadataPath, bodyPrefix + `"changes":[{"path":["title"],"before":{"exists":false},"after":{"exists":false}}]}`, 428},
		{"absent before", http.MethodPatch, metadataPath, bodyPrefix + `"baseRevision":"0","changes":[{"path":["title"],"after":{"exists":false}}]}`, 428},
		{"absent observed value", http.MethodPatch, metadataPath, bodyPrefix + `"baseRevision":"0","changes":[{"path":["title"],"before":{"exists":true},"after":{"exists":false}}]}`, 428},
		{"null before", http.MethodPatch, metadataPath, bodyPrefix + `"baseRevision":"0","changes":[{"path":["title"],"before":null,"after":{"exists":false}}]}`, 400},
		{"null path element", http.MethodPatch, metadataPath, bodyPrefix + `"baseRevision":"0","changes":[{"path":[null],"before":{"exists":false},"after":{"exists":false}}]}`, 400},
		{"absent observed selection", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"selectSwipe","target":{"messageId":"` +
			testStoredMessageID + `","candidateId":"` + testStoredCandidateID + `"},"preconditions":{"messageRevision":"7"},"payload":null}]}`, 428},
		{"unknown nested precondition", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"delete","target":{"messageId":"` +
			testStoredMessageID + `"},"preconditions":{"messageRevision":"7","baseRevision":"7"},"payload":null}]}`, 400},
		{"explicit null preconditions", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"delete","target":{"messageId":"` +
			testStoredMessageID + `"},"preconditions":null,"payload":null}]}`, 400},
		{"insert absent order revision", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"insert","target":{"beforeMessageId":"` + testStoredMessageID + `"},"preconditions":{},"payload":{"messages":[` + message + `]}}]}`, 428},
		{"insert invalid anchor", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"insert","target":{"beforeMessageId":"bad-id"},"preconditions":{"orderRevision":"7"},"payload":{"messages":[` + message + `]}}]}`, 400},
		{"unknown kind", http.MethodPost, operationsPath, bodyPrefix + `"operations":[{"kind":"merge","target":{},"preconditions":{},"payload":null}]}`, 400},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			code := "INVALID_REQUEST"
			if tc.status == 428 {
				code = "CHAT_PRECONDITION_REQUIRED"
			}
			assertStoredChatError(t, doJSON(t, s, tc.method, tc.path, tc.body, 1), tc.status, code)
		})
	}
	if len(store.calls) != 0 {
		t.Fatalf("invalid bodies reached the store: %d calls", len(store.calls))
	}
}

func TestStoredChatWriteOperationKinds(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	messageTarget := `{"messageId":"` + testStoredMessageID + `"}`
	candidateTarget := `{"messageId":"` + testStoredMessageID + `","candidateId":"` + testStoredCandidateID + `"}`
	messageRevision := `{"messageRevision":"7"}`
	baseRevision := `{"baseRevision":"7"}`
	selection := `{"messageRevision":"7","selectedCandidateId":"` + testStoredCandidateID + `"}`
	changes := `{"changes":[{"path":["script"],"before":{"exists":false},"after":{"exists":true,"value":null}}]}`
	tests := []struct {
		kind, target, preconditions, payload string
	}{
		{"edit", messageTarget, baseRevision, changes},
		{"metadata", `{}`, baseRevision, changes},
		{"append", `{}`, `{}`, `{"messages":[{"clientMessageId":"` + testStoredMessageID + `","data":{}}]}`},
		{"insert", `{"beforeMessageId":"` + testStoredMessageID + `"}`, `{"orderRevision":"7"}`, `{"messages":[{"clientMessageId":"` + testStoredMessageID + `","data":{}}]}`},
		{"delete", messageTarget, messageRevision, `null`},
		{"addSwipe", messageTarget, messageRevision, `{"candidate":{"candidateId":"` + testStoredCandidateID + `","data":{}}}`},
		{"selectSwipe", candidateTarget, selection, `null`},
		{"removeSwipe", candidateTarget, selection, `{"replacementCandidateId":null}`},
		{"reorder", `{"firstMessageId":"` + testStoredMessageID + `","lastMessageId":"` + testStoredMessageID + `"}`,
			`{"orderRevision":"7"}`, `{"messageIds":["` + testStoredMessageID + `"]}`},
	}
	for _, tc := range tests {
		t.Run(tc.kind, func(t *testing.T) {
			store.calls = nil
			body := fmt.Sprintf(`{%s,"operations":[{"kind":%q,"target":%s,"preconditions":%s,"payload":%s}]}`,
				testStoredWriteEnvelope, tc.kind, tc.target, tc.preconditions, tc.payload)
			rec := doJSON(t, s, http.MethodPost, testStoredChatPath+"/operations", body, 1)
			if rec.Code != 200 || len(store.calls) != 1 {
				t.Fatalf("operation status=%d, store calls=%d", rec.Code, len(store.calls))
			}
			got := store.calls[0].input.(postgres.ChatOperationsRequest).Operations
			want := []postgres.ChatOperation{{Kind: tc.kind, Target: json.RawMessage(tc.target),
				Preconditions: json.RawMessage(tc.preconditions), Payload: json.RawMessage(tc.payload)}}
			if !reflect.DeepEqual(got, want) {
				t.Fatal("operation wire values changed before storage")
			}
		})
	}
}

func TestStoredChatWriteBodyLimit(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	atLimit := testStoredCreateBody + strings.Repeat(" ", postgres.StoredChatMutationBytes-len(testStoredCreateBody))
	if rec := doJSON(t, s, http.MethodPost, testStoredChatsPath, atLimit, 1); rec.Code != 201 {
		t.Fatalf("valid body at limit returned %d", rec.Code)
	}
	oversize := atLimit + " "
	assertStoredChatError(t, doJSON(t, s, http.MethodPost, testStoredChatsPath, oversize, 1), 413, "CHAT_PAYLOAD_TOO_LARGE")
	req := httptest.NewRequest(http.MethodPost, testStoredChatsPath, strings.NewReader(oversize))
	req.ContentLength = -1
	attachAuth(t, s, req, 1, true)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	assertStoredChatError(t, rec, 413, "CHAT_PAYLOAD_TOO_LARGE")
	if len(store.calls) != 1 {
		t.Fatalf("oversize bodies reached the store: %d total calls", len(store.calls))
	}
}

func TestStoredChatWriteStoreErrors(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	body := `{` + testStoredWriteEnvelope + `,"chatRevision":"7"}`
	foreign := doJSON(t, s, http.MethodDelete, testStoredChatPath, body, 2)
	assertStoredChatError(t, foreign, 404, "NOT_FOUND_OR_FORBIDDEN")
	store.err = postgres.ErrNotFound
	missing := doJSON(t, s, http.MethodDelete, testStoredChatPath, body, 1)
	if foreign.Body.String() != missing.Body.String() {
		t.Fatal("foreign and missing chat envelopes differ")
	}
	for _, tc := range []struct {
		code   string
		status int
	}{
		{"CHAT_AUTHORITY_CHANGED", 409},
		{"REVISION_CONFLICT", 409},
		{"IDEMPOTENCY_KEY_REUSED", 409},
		{"CHAT_ID_REUSED", 409},
		{"CHAT_GENERATION_FENCED", 409},
		{"OPERATION_RESULT_EXPIRED", 410},
		{"CHAT_PAYLOAD_TOO_LARGE", 413},
		{"CHAT_INVALID_OPERATION", 422},
		{"CHAT_PRECONDITION_REQUIRED", 428},
		{"SCHEMA_UNAVAILABLE", 503},
	} {
		t.Run(tc.code, func(t *testing.T) {
			store.err = fmt.Errorf("synthetic-private-error: %w", &postgres.ChatError{Code: tc.code})
			if tc.status == 503 {
				store.err = errors.New("synthetic-private-storage-detail")
			}
			rec := doJSON(t, s, http.MethodDelete, testStoredChatPath, body, 1)
			assertStoredChatError(t, rec, tc.status, tc.code)
			if strings.Contains(rec.Body.String(), "synthetic-") {
				t.Fatal("response leaked store body or error detail")
			}
		})
	}
}

func TestStoredChatGenerationRegistration(t *testing.T) {
	t.Parallel()
	store := &recordingStoredChatWriter{memStore: newMemStore()}
	s := newCoreServer(t, "full", store)
	token := "synthetic-service-token"
	run := func(body, authorization string, edit func(*http.Request)) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, testStoredGenerationPath, strings.NewReader(body))
		if authorization != "" {
			req.Header.Set("Authorization", authorization)
		}
		if edit != nil {
			edit(req)
		}
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		return rec
	}

	assertStoredChatError(t, run(testStoredGenerationBody, "Bearer "+token, nil), 503, "INVALID_REQUEST")
	s.cfg.STPlugin.ServiceToken = token
	assertStoredChatError(t, run(testStoredGenerationBody, "", func(r *http.Request) { attachAuth(t, s, r, 1, false) }), 401, "AUTHENTICATION_REQUIRED")
	assertStoredChatError(t, run(testStoredGenerationBody, token, nil), 401, "AUTHENTICATION_REQUIRED")
	assertStoredChatError(t, run(testStoredGenerationBody, "Bearer wrong", nil), 401, "AUTHENTICATION_REQUIRED")
	assertStoredChatError(t, run(testStoredGenerationBody, "Bearer "+token, func(r *http.Request) {
		r.Header.Add("Authorization", "Bearer wrong")
	}), 401, "AUTHENTICATION_REQUIRED")
	for _, origin := range []string{"", "https://vc.test", "null"} {
		assertStoredChatError(t, run(testStoredGenerationBody, "Bearer "+token, func(r *http.Request) {
			r.Header.Set("Origin", origin)
		}), 403, "ACCESS_DENIED")
	}
	for _, body := range []string{
		strings.Replace(testStoredGenerationBody, `"authorityEpoch":"3",`, "", 1),
		strings.Replace(testStoredGenerationBody, `"chatRevision":"7"`, `"chatRevision":null`, 1),
		strings.Replace(testStoredGenerationBody, `"ownerAccountId":"2"`, `"ownerAccountId":"02"`, 1),
		strings.TrimSuffix(testStoredGenerationBody, "}") + `,"input":"synthetic-private-body"}`,
	} {
		assertStoredChatError(t, run(body, "Bearer "+token, nil), 400, "INVALID_REQUEST")
	}
	s.cfg.RestoreGateFile = filepath.Join(t.TempDir(), "restore-gate.json")
	if err := os.WriteFile(s.cfg.RestoreGateFile, []byte(`{"blocked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	assertStoredChatError(t, run(testStoredGenerationBody, "Bearer "+token, nil), 503, "SCHEMA_UNAVAILABLE")
	if len(store.calls) != 0 {
		t.Fatalf("rejected registration reached store: %d calls", len(store.calls))
	}
	if err := os.Remove(s.cfg.RestoreGateFile); err != nil {
		t.Fatal(err)
	}

	rec := run(testStoredGenerationBody, "Bearer "+token, func(r *http.Request) { attachAuth(t, s, r, 1, false) })
	if rec.Code != 201 {
		t.Fatalf("registration status=%d, want 201", rec.Code)
	}
	if got := string(decodeStoredChatResponse(t, rec)["chatRevision"]); got != `"7"` {
		t.Fatalf("registration baseline=%s, want 7", got)
	}
	want := []storedChatWriteCall{{method: "register", owner: 2, chatID: testStoredChatID,
		input: postgres.ChatGenerationRegistrationRequest{OwnerAccountID: "2", RequestID: testStoredWriteRequestID,
			AuthorityEpoch: 3, Revision: 7, RunID: testStoredRunID, InputMessageID: testStoredMessageID, InputCandidateID: testStoredCandidateID}}}
	if !reflect.DeepEqual(store.calls, want) {
		t.Fatalf("backend calls=%+v, want %+v", store.calls, want)
	}

	store.err = fmt.Errorf("synthetic-private-owner: %w", postgres.ErrServiceOwnerRejected)
	rejected := run(testStoredGenerationBody, "Bearer "+token, nil)
	assertStoredChatError(t, rejected, 403, "ACCESS_DENIED")
	if strings.Contains(rejected.Body.String(), "synthetic-") {
		t.Fatal("service registration response leaked owner data")
	}
}
