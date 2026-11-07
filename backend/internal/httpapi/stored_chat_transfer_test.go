package httpapi

import (
	"bytes"
	"context"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type transferHTTPObjects struct {
	uploadTestObjects
	readErr error
}

func (o *transferHTTPObjects) GetLimited(ctx context.Context, key string, limit int64) ([]byte, error) {
	if o.readErr != nil {
		return nil, o.readErr
	}
	return o.uploadTestObjects.GetLimited(ctx, key, limit)
}

func (o *transferHTTPObjects) Get(ctx context.Context, key string) ([]byte, error) {
	return o.GetLimited(ctx, key, 0)
}

type transferHTTPStore struct {
	*memStore
	began, bound, released []int64
	imports                []postgres.ChatImportRequest
	native                 []postgres.NativeChatUpload
	actions                []string
	content                string
	captureErr, deliverErr error
	lastRevision           *int64
	lastEpoch              int64
}

func (s *transferHTTPStore) BeginChatTransfer(ctx context.Context, owner int64) (postgres.ChatTransferIntent, error) {
	s.began = append(s.began, owner)
	if end, ok := ctx.Deadline(); !ok || time.Until(end) < 140*time.Second {
		return postgres.ChatTransferIntent{}, errors.New("transfer HTTP budget absent")
	}
	return postgres.ChatTransferIntent{ID: testStoredWriteRequestID, Prefix: "synthetic-transfer/"}, nil
}
func (s *transferHTTPStore) BindChatTransfer(_ context.Context, owner int64, _ string) error {
	s.bound = append(s.bound, owner)
	return nil
}
func (s *transferHTTPStore) ReleaseChatTransfer(_ context.Context, owner int64, _ string) error {
	s.released = append(s.released, owner)
	return nil
}
func (s *transferHTTPStore) SealChatImport(_ context.Context, _ int64, in postgres.ChatImportRequest, _ string, _ chattransfer.Manifest, _ string) (postgres.ChatImportAccepted, error) {
	s.imports = append(s.imports, in)
	return postgres.ChatImportAccepted{RequestID: in.RequestID, ImportID: testStoredChatID, Status: "PENDING", StatusURL: "/api/v1/chats/imports/" + testStoredChatID}, nil
}
func (*transferHTTPStore) GetChatImport(context.Context, int64, string) (postgres.ChatImportResult, error) {
	return postgres.ChatImportResult{ImportID: testStoredChatID, Status: "PENDING"}, nil
}
func (s *transferHTTPStore) CaptureStoredChatJSONL(_ context.Context, _ int64, id string, revision *int64, writer io.Writer) (postgres.ChatExportSnapshot, error) {
	s.lastRevision = revision
	if s.captureErr != nil {
		return postgres.ChatExportSnapshot{}, s.captureErr
	}
	n, err := io.WriteString(writer, s.content)
	return postgres.ChatExportSnapshot{ChatID: id, Revision: 7, AuthorityEpoch: 3, Bytes: int64(n)}, err
}
func (s *transferHTTPStore) DeliverStoredChatSnapshot(ctx context.Context, _ int64, _ postgres.ChatExportSnapshot, send func(context.Context) error) error {
	if s.deliverErr != nil {
		return s.deliverErr
	}
	return send(ctx)
}
func (s *transferHTTPStore) ListNativeChats(context.Context, int64, postgres.NativeChatScope, string, int) (postgres.StoredChatPage, error) {
	s.actions = append(s.actions, "list")
	return postgres.StoredChatPage{Items: []postgres.StoredChatSummary{}, AuthorityEpoch: 3}, nil
}
func (s *transferHTTPStore) ResolveNativeChat(_ context.Context, _ int64, _ postgres.NativeChatScope, _ string, epoch int64) (postgres.StoredChat, error) {
	s.lastEpoch = epoch
	return postgres.StoredChat{StoredChatSummary: postgres.StoredChatSummary{ChatID: testStoredChatID, Revision: 7, AuthorityEpoch: 3}}, nil
}
func (s *transferHTTPStore) WriteNativeChat(_ context.Context, _ int64, action string, in postgres.NativeChatUpload, _ string, _ chattransfer.Manifest, _ string, _ chattransfer.Objects) (postgres.NativeChatWriteResult, error) {
	s.actions = append(s.actions, action)
	s.native = append(s.native, in)
	return postgres.NativeChatWriteResult{RequestID: in.RequestID, Chat: postgres.StoredChatSummary{ChatID: in.ChatID, Revision: in.ChatRevision + 1}}, nil
}
func (s *transferHTTPStore) RenameNativeChat(_ context.Context, _ int64, in postgres.NativeChatMutation) (postgres.NativeChatMutationResult, error) {
	s.actions = append(s.actions, "rename")
	return postgres.NativeChatMutationResult{RequestID: in.RequestID}, nil
}
func (s *transferHTTPStore) DeleteNativeChat(_ context.Context, _ int64, in postgres.NativeChatMutation) (postgres.NativeChatMutationResult, error) {
	s.actions = append(s.actions, "delete")
	return postgres.NativeChatMutationResult{RequestID: in.RequestID}, nil
}

func transferHTTPFixture(t *testing.T) (*Server, *transferHTTPStore, *transferHTTPObjects) {
	t.Helper()
	store := &transferHTTPStore{memStore: newMemStore(), content: "{\"chat_metadata\":{}}\n{\"mes\":\"synthetic\"}\n"}
	s := newCoreServer(t, "full", store)
	s.cfg.STPlugin.ServiceToken = "synthetic-transfer-service-token"
	objects := &transferHTTPObjects{}
	s.core.Blobs = objects
	return s, store, objects
}

func transferMultipartRequest(t *testing.T, target, content string, fields map[string]string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", "ignored.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.WriteString(file, content)
	for key, value := range fields {
		if err = form.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, target, &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	return r
}

func TestChatTransferPublicAuthenticationBeforeIntentOrObjects(t *testing.T) {
	for _, invalid := range []string{"session", "origin", "csrf", "account", "expected-session"} {
		t.Run(invalid, func(t *testing.T) {
			s, store, objects := transferHTTPFixture(t)
			r := transferMultipartRequest(t, "/api/v1/chats/imports", "{}\n", map[string]string{"requestId": testStoredWriteRequestID, "authorityEpoch": "3", "kind": "GROUP", "groupRef": "g1"})
			attachAuth(t, s, r, 1, true)
			switch invalid {
			case "session":
				r.Header.Del("Cookie")
			case "origin":
				r.Header.Del("Origin")
			case "csrf":
				r.Header.Del(csrfHeader)
			case "account":
				r.Header.Del(expectedAccountHeader)
			case "expected-session":
				r.Header.Del(expectedSessionHeader)
			}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			if w.Code < 400 || len(store.began) != 0 || len(objects.data) != 0 {
				t.Fatal("rejected import performed staging")
			}
		})
	}
}

func TestChatTransferPublicMultipartBypassesOrdinaryEightMiBBound(t *testing.T) {
	s, store, objects := transferHTTPFixture(t)
	content := strings.Repeat("x", 9<<20)
	r := transferMultipartRequest(t, "/api/v1/chats/imports", content, map[string]string{"requestId": testStoredWriteRequestID, "authorityEpoch": "3", "kind": "GROUP", "groupRef": "g1"})
	attachAuth(t, s, r, 1, true)
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != 202 || len(store.imports) != 1 || len(objects.data) != 9 || len(store.released) != 0 {
		t.Fatalf("import acceptance status=%d", w.Code)
	}
	if store.imports[0].RequestID != testStoredWriteRequestID || store.imports[0].AuthorityEpoch != 3 {
		t.Fatal("multipart preconditions changed")
	}
}

func TestNativeChatOriginAndTokenBeforeOwnerlessStaging(t *testing.T) {
	for _, invalid := range []string{"empty-origin", "origin", "no-token", "duplicate-token"} {
		t.Run(invalid, func(t *testing.T) {
			s, store, objects := transferHTTPFixture(t)
			r := transferMultipartRequest(t, "/api/v1/service/chats/native/create", "{}\n", nil)
			r.Header.Set("Authorization", "Bearer "+s.cfg.STPlugin.ServiceToken)
			switch invalid {
			case "empty-origin":
				r.Header["origin"] = []string{""}
			case "origin":
				r.Header.Set("Origin", "null")
			case "no-token":
				r.Header.Del("Authorization")
				attachAuth(t, s, r, 1, false)
			case "duplicate-token":
				r.Header.Add("Authorization", "Bearer "+s.cfg.STPlugin.ServiceToken)
			}
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			if w.Code != 401 && w.Code != 403 {
				t.Fatalf("status=%d", w.Code)
			}
			if len(store.began) != 0 || len(objects.data) != 0 {
				t.Fatal("unauthorized service created an intent/object")
			}
		})
	}
}

func TestNativeChatMultipartFixedTypedOwnerAndCreateZeroRevision(t *testing.T) {
	for _, action := range []string{"create", "save", "fork"} {
		t.Run(action, func(t *testing.T) {
			s, store, _ := transferHTTPFixture(t)
			fields := map[string]string{"ownerAccountId": "9007199254740993", "requestId": testStoredWriteRequestID, "authorityEpoch": "3", "scope": `{"kind":"GROUP","groupRef":"g1"}`, "chatId": testStoredChatID, "chatRevision": "0"}
			if action == "save" {
				fields["chatRevision"], fields["fileName"] = "7", "synthetic.jsonl"
			}
			if action == "fork" {
				fields["parentChatId"], fields["parentRevision"] = testStoredMessageID, "8"
			}
			r := transferMultipartRequest(t, "/api/v1/service/chats/native/"+action, "{}\n", fields)
			r.Header.Set("Authorization", "Bearer "+s.cfg.STPlugin.ServiceToken)
			w := httptest.NewRecorder()
			s.Handler().ServeHTTP(w, r)
			status := 201
			if action == "save" {
				status = 200
			}
			if w.Code != status || len(store.native) != 1 || len(store.began) != 1 || store.began[0] != 0 || len(store.bound) != 1 || store.bound[0] != 9007199254740993 {
				t.Fatalf("native status=%d body=%s", w.Code, w.Body.String())
			}
			if len(store.released) != 1 || store.released[0] != 9007199254740993 {
				t.Fatal("native staging lifecycle was not released")
			}
		})
	}
}

func TestChatJSONLExportPreparesAndFencesBeforeSuccessHeaders(t *testing.T) {
	s, store, _ := transferHTTPFixture(t)
	path := "/api/v1/chats/" + testStoredChatID + "/export?revision=7"
	w := doJSON(t, s, "GET", path, "", 1)
	if w.Code != 200 || w.Body.String() != store.content || w.Header().Get("Content-Length") != strconv.Itoa(len(store.content)) || w.Header().Get("X-Chat-Revision") != "7" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("complete JSONL response or headers mismatch")
	}
	if store.lastRevision == nil || *store.lastRevision != 7 {
		t.Fatal("requested revision was discarded")
	}
	for _, stage := range []string{"capture", "delivery"} {
		store.captureErr, store.deliverErr = nil, nil
		if stage == "capture" {
			store.captureErr = &postgres.ChatError{Code: "CHAT_TRANSFER_TIMEOUT"}
		} else {
			store.deliverErr = &postgres.ChatError{Code: "REVISION_CONFLICT"}
		}
		w = doJSON(t, s, "GET", path, "", 1)
		if w.Code < 400 || w.Header().Get("Content-Length") != "" || strings.Contains(w.Body.String(), "synthetic") {
			t.Fatalf("%s sent success/body before fence", stage)
		}
		if stage == "capture" && (w.Code != 503 || w.Header().Get("Retry-After") != "1") {
			t.Fatal("timeout lost retryable classification")
		}
	}
}

func TestChatJSONLExportFirstObjectFailureIsTyped(t *testing.T) {
	s, _, objects := transferHTTPFixture(t)
	objects.readErr = errors.New("synthetic object unavailable")
	defer func() {
		if recover() != nil {
			t.Fatal("first object failure aborted after sending success headers")
		}
	}()
	w := doJSON(t, s, "GET", "/api/v1/chats/"+testStoredChatID+"/export", "", 1)
	if w.Code != 503 || w.Header().Get("Content-Length") != "" || w.Header().Get("X-Chat-Revision") != "" || !strings.Contains(w.Body.String(), `"code":"SCHEMA_UNAVAILABLE"`) {
		t.Fatal("first object failure must return a typed unavailable response")
	}
}
