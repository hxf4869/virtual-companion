package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/restoregate"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type storedChatTransfers interface {
	BeginChatTransfer(context.Context, int64) (postgres.ChatTransferIntent, error)
	BindChatTransfer(context.Context, int64, string) error
	ReleaseChatTransfer(context.Context, int64, string) error
	SealChatImport(context.Context, int64, postgres.ChatImportRequest, string, chattransfer.Manifest, string) (postgres.ChatImportAccepted, error)
	GetChatImport(context.Context, int64, string) (postgres.ChatImportResult, error)
	CaptureStoredChatJSONL(context.Context, int64, string, *int64, io.Writer) (postgres.ChatExportSnapshot, error)
	DeliverStoredChatSnapshot(context.Context, int64, postgres.ChatExportSnapshot, func(context.Context) error) error
}

type nativeChatTransfers interface {
	storedChatTransfers
	ListNativeChats(context.Context, int64, postgres.NativeChatScope, string, int) (postgres.StoredChatPage, error)
	ResolveNativeChat(context.Context, int64, postgres.NativeChatScope, string, int64) (postgres.StoredChat, error)
	WriteNativeChat(context.Context, int64, string, postgres.NativeChatUpload, string, chattransfer.Manifest, string, chattransfer.Objects) (postgres.NativeChatWriteResult, error)
	RenameNativeChat(context.Context, int64, postgres.NativeChatMutation) (postgres.NativeChatMutationResult, error)
	DeleteNativeChat(context.Context, int64, postgres.NativeChatMutation) (postgres.NativeChatMutationResult, error)
}

func (s *Server) registerStoredChatTransfers() {
	s.mux.Handle("POST /api/v1/chats/imports", withChatTransferDeadline(s.handleChatImport))
	// A literal imports/{id} crosses {chatId}/messages (and /changes) in
	// ServeMux's specificity order. Use their shared two-segment fallback;
	// literal chat subresources keep their existing, more-specific handlers.
	s.mux.HandleFunc("GET /api/v1/chats/{chatId}/{chatSubresource}", func(w http.ResponseWriter, r *http.Request) {
		if r.PathValue("chatId") != "imports" {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("importId", r.PathValue("chatSubresource"))
		s.handleChatImportStatus(w, r)
	})
	s.mux.Handle("GET /api/v1/chats/{chatId}/export", withChatTransferDeadline(s.handleChatJSONLExport))
	for _, action := range []string{"list", "read", "create", "save", "fork", "rename", "delete"} {
		s.mux.Handle("POST /api/v1/service/chats/native/"+action, withChatTransferDeadline(func(w http.ResponseWriter, r *http.Request) {
			s.handleNativeChat(w, r, action)
		}))
	}
}

func (s *Server) chatTransferStore(w http.ResponseWriter) (storedChatTransfers, chattransfer.Objects) {
	store, ok := s.core.Store.(storedChatTransfers)
	objects, objectOK := s.core.Blobs.(chattransfer.Objects)
	if !ok || !objectOK || restoregate.Closed(s.cfg.RestoreGateFile) {
		s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
		return nil, nil
	}
	return store, objects
}

func (s *Server) handleChatImport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipalWithUnavailableCode(w, r, true, "SCHEMA_UNAVAILABLE")
	if p == nil {
		return
	}
	store, objects := s.chatTransferStore(w)
	if store == nil {
		return
	}
	intent, err := store.BeginChatTransfer(r.Context(), p.AccountID)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	accepted := false
	defer func() {
		if !accepted {
			releaseChatTransfer(store, p.AccountID, intent.ID)
		}
	}()
	upload, err := readChatMultipart(r.Context(), r, objects, intent.Prefix, chatImportMultipartFields)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	var in postgres.ChatImportRequest
	if err = decodeChatMultipartFields(upload.Fields, nil, publicChatWriteFields(chatImportWireFields), &in); err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	out, err := store.SealChatImport(r.Context(), p.AccountID, in, intent.ID, upload.Manifest, upload.SHA256)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	accepted = true // The durable import now owns input staging and cleanup.
	s.writeJSON(w, http.StatusAccepted, out)
}

func (s *Server) handleChatImportStatus(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipalWithUnavailableCode(w, r, false, "SCHEMA_UNAVAILABLE")
	if p == nil {
		return
	}
	store, ok := s.core.Store.(interface {
		GetChatImport(context.Context, int64, string) (postgres.ChatImportResult, error)
	})
	if !ok || restoregate.Closed(s.cfg.RestoreGateFile) {
		s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
		return
	}
	id := strings.ToLower(r.PathValue("importId"))
	if !stsource.ValidIdentity(id) || r.URL.RawQuery != "" {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	out, err := store.GetChatImport(r.Context(), p.AccountID, id)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleChatJSONLExport(w http.ResponseWriter, r *http.Request) {
	p := s.corePrincipalWithUnavailableCode(w, r, false, "SCHEMA_UNAVAILABLE")
	if p == nil {
		return
	}
	store, objects := s.chatTransferStore(w)
	if store == nil {
		return
	}
	id := strings.ToLower(r.PathValue("chatId"))
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) > 1 || !stsource.ValidIdentity(id) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	var revision *int64
	if len(query) != 0 {
		values, exists := query["revision"]
		if !exists || len(values) != 1 {
			s.writeStoreErr(w, postgres.ErrInvalid)
			return
		}
		n, ok := parseChatDecimal(values[0])
		if !ok {
			s.writeStoreErr(w, postgres.ErrInvalid)
			return
		}
		revision = &n
	}
	s.deliverChatJSONL(w, r, store, objects, p.AccountID, id, revision, 0)
}

func (s *Server) deliverChatJSONL(w http.ResponseWriter, r *http.Request, store storedChatTransfers, objects chattransfer.Objects, owner int64, id string, revision *int64, expectedEpoch int64) {
	intent, err := store.BeginChatTransfer(r.Context(), owner)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	defer releaseChatTransfer(store, owner, intent.ID)
	writer := chattransfer.NewWriter(r.Context(), objects, intent.Prefix, 0)
	snapshot, err := store.CaptureStoredChatJSONL(r.Context(), owner, id, revision, writer)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	manifest, err := writer.Seal()
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	if expectedEpoch != 0 && snapshot.AuthorityEpoch != expectedEpoch {
		s.writeChatTransferError(w, &postgres.ChatError{Code: "CHAT_AUTHORITY_CHANGED"})
		return
	}
	started := false
	err = store.DeliverStoredChatSnapshot(r.Context(), owner, snapshot, func(ctx context.Context) error {
		reader, err := chattransfer.NewReader(ctx, objects, manifest)
		if err != nil {
			return err
		}
		// Fetch the first encrypted chunk before committing success headers,
		// so an unavailable object still produces a typed, retryable response.
		prefix := make([]byte, 32<<10)
		count, err := reader.Read(prefix)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/x-ndjson")
		w.Header().Set("Content-Disposition", `attachment; filename="chat.jsonl"`)
		w.Header().Set("Content-Length", strconv.FormatInt(snapshot.Bytes, 10))
		w.Header().Set("X-Chat-Id", snapshot.ChatID)
		w.Header().Set("X-Chat-Revision", strconv.FormatInt(snapshot.Revision, 10))
		w.Header().Set("X-Chat-Authority-Epoch", strconv.FormatInt(snapshot.AuthorityEpoch, 10))
		started = true
		w.WriteHeader(http.StatusOK)
		n, err := io.CopyBuffer(w, io.MultiReader(bytes.NewReader(prefix[:count]), reader), make([]byte, 32<<10))
		if err == nil && n != snapshot.Bytes {
			err = io.ErrUnexpectedEOF
		}
		return err
	})
	if err != nil {
		if started {
			panic(http.ErrAbortHandler)
		} // Never append JSON to a partial successful file.
		s.writeChatTransferError(w, err)
	}
}

func releaseChatTransfer(store storedChatTransfers, owner int64, id string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// A failed release is still covered by the durable intent's expiry sweep.
	_ = store.ReleaseChatTransfer(ctx, owner, id)
}

func (s *Server) nativeChatService(w http.ResponseWriter, r *http.Request) bool {
	for name := range r.Header {
		if strings.EqualFold(name, "Origin") {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "browser origin rejected")
			return false
		}
	}
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "service authentication required")
		return false
	}
	return s.serviceCaller(w, r)
}

func (s *Server) handleNativeChat(w http.ResponseWriter, r *http.Request, action string) {
	if !s.nativeChatService(w, r) {
		return
	}
	store, objects := s.chatTransferStore(w)
	native, ok := store.(nativeChatTransfers)
	if store == nil {
		return
	}
	if !ok {
		s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
		return
	}
	if r.URL.RawQuery != "" {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	if action == "create" || action == "save" || action == "fork" {
		s.handleNativeChatUpload(w, r, native, objects, action)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, postgres.StoredChatMutationBytes)
	if action == "list" {
		var in struct {
			Owner  string                   `json:"ownerAccountId"`
			Scope  postgres.NativeChatScope `json:"scope"`
			Cursor string                   `json:"cursor"`
			Limit  int                      `json:"limit"`
		}
		in.Limit = 50
		if !s.decodeStoredChatWrite(w, r, &in, nativeChatListFields) {
			return
		}
		owner, _ := parseChatDecimal(in.Owner)
		out, err := native.ListNativeChats(r.Context(), owner, in.Scope, in.Cursor, in.Limit)
		if err != nil {
			s.writeChatTransferError(w, err)
			return
		}
		s.writeJSON(w, http.StatusOK, out)
		return
	}
	if action == "read" {
		var in struct {
			Owner    string                   `json:"ownerAccountId"`
			Scope    postgres.NativeChatScope `json:"scope"`
			FileName string                   `json:"fileName"`
			Epoch    int64                    `json:"authorityEpoch,string"`
		}
		if !s.decodeStoredChatWrite(w, r, &in, nativeChatReadFields) {
			return
		}
		owner, _ := parseChatDecimal(in.Owner)
		chat, err := native.ResolveNativeChat(r.Context(), owner, in.Scope, in.FileName, in.Epoch)
		if err != nil {
			s.writeChatTransferError(w, err)
			return
		}
		s.deliverChatJSONL(w, r, store, objects, owner, chat.ChatID, &chat.Revision, in.Epoch)
		return
	}
	var in struct {
		Owner string `json:"ownerAccountId"`
		postgres.NativeChatMutation
	}
	if !s.decodeStoredChatWrite(w, r, &in, nativeChatMutationFields(action)) {
		return
	}
	owner, _ := parseChatDecimal(in.Owner)
	var out postgres.NativeChatMutationResult
	var err error
	if action == "rename" {
		out, err = native.RenameNativeChat(r.Context(), owner, in.NativeChatMutation)
	} else {
		out, err = native.DeleteNativeChat(r.Context(), owner, in.NativeChatMutation)
	}
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleNativeChatUpload(w http.ResponseWriter, r *http.Request, store nativeChatTransfers, objects chattransfer.Objects, action string) {
	intent, err := store.BeginChatTransfer(r.Context(), 0) // Service-authenticated, owner not yet decoded.
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	owner := int64(0)
	defer func() { releaseChatTransfer(store, owner, intent.ID) }()
	allowed := map[string]bool{"ownerAccountId": true, "requestId": true, "authorityEpoch": true, "scope": true, "fileName": true, "chatId": true, "chatRevision": true}
	switch action {
	case "create":
		allowed["mode"] = true
	case "save":
		allowed["generation"] = true
	case "fork":
		allowed["parentChatId"], allowed["parentRevision"] = true, true
	}
	upload, err := readChatMultipart(r.Context(), r, objects, intent.Prefix, allowed)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	var in struct {
		Owner string `json:"ownerAccountId"`
		postgres.NativeChatUpload
	}
	if err = decodeChatMultipartFields(upload.Fields, map[string]bool{"scope": true, "generation": true}, nativeChatUploadFields(action), &in); err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	owner, _ = parseChatDecimal(in.Owner)
	if err = store.BindChatTransfer(r.Context(), owner, intent.ID); err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	out, err := store.WriteNativeChat(r.Context(), owner, action, in.NativeChatUpload, intent.ID, upload.Manifest, upload.SHA256, objects)
	if err != nil {
		s.writeChatTransferError(w, err)
		return
	}
	status := http.StatusOK
	if action == "create" || action == "fork" {
		status = http.StatusCreated
	}
	s.writeJSON(w, status, out)
}

func decodeChatMultipartFields(fields map[string]string, objects map[string]bool, rule chatWireRule, dst any) error {
	wire := map[string]json.RawMessage{}
	for key, value := range fields {
		if !utf8.ValidString(value) {
			return postgres.ErrInvalid
		}
		if objects[key] {
			wire[key] = json.RawMessage(value)
		} else {
			wire[key], _ = json.Marshal(value)
		}
	}
	raw, err := json.Marshal(wire)
	if err != nil {
		return postgres.ErrInvalid
	}
	if err = rule(raw); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if decoder.Decode(dst) != nil {
		return postgres.ErrInvalid
	}
	return nil
}

func (s *Server) writeChatTransferError(w http.ResponseWriter, err error) {
	if errors.Is(err, context.DeadlineExceeded) {
		err = &postgres.ChatError{Code: "CHAT_TRANSFER_TIMEOUT"}
	}
	if errors.Is(err, postgres.ErrServiceOwnerRejected) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "owner account rejected")
		return
	}
	s.writeStoredChatError(w, err)
}

var chatImportMultipartFields = map[string]bool{"requestId": true, "authorityEpoch": true, "kind": true, "characterRef": true, "groupRef": true, "mode": true}

func chatImportWireFields(fields map[string]json.RawMessage) error {
	// The public create scope is identical, except imports have no title field.
	if _, exists := fields["title"]; exists {
		return postgres.ErrInvalid
	}
	return chatCreateFields(fields)
}

var nativeChatScopeFields = chatObjectRule(func(fields map[string]json.RawMessage) error {
	var kind string
	if json.Unmarshal(fields["kind"], &kind) != nil {
		return postgres.ErrInvalid
	}
	delete(fields, "kind")
	if kind == "SINGLE" {
		return checkChatWireFields(fields, chatRequired("characterRef", chatWireNonempty))
	}
	if kind == "GROUP" {
		return checkChatWireFields(fields, chatRequired("groupRef", chatWireNonempty))
	}
	return postgres.ErrInvalid
})

var nativeChatOwnerField = chatRequired("ownerAccountId", chatWireStringIf(func(value string) bool { n, ok := parseChatDecimal(value); return ok && n > 0 }))

var nativeChatFileName = chatWireStringIf(func(value string) bool {
	return strings.HasSuffix(value, ".jsonl") && value != ".jsonl" && value != "..jsonl" && !strings.ContainsAny(value, "/\\\x00")
})

var nativeChatListFields = chatWireObject(nativeChatOwnerField, chatRequired("scope", nativeChatScopeFields),
	chatOptional("cursor", chatWireNonempty), chatOptional("limit", func(raw json.RawMessage) error {
		var n int
		if json.Unmarshal(raw, &n) != nil || n < 1 || n > 100 {
			return postgres.ErrInvalid
		}
		return nil
	}))

var nativeChatReadFields = chatWireObject(nativeChatOwnerField, chatRequired("scope", nativeChatScopeFields),
	chatRequired("fileName", nativeChatFileName), chatPrecondition("authorityEpoch", chatWireRevision))

func nativeChatMutationFields(action string) chatWireRule {
	fields := []chatWireField{nativeChatOwnerField, chatRequired("requestId", chatWireUUID), chatPrecondition("authorityEpoch", chatWireRevision), chatRequired("scope", nativeChatScopeFields),
		chatRequired("target", chatWireObject(chatRequired("fileName", nativeChatFileName), chatRequired("chatId", chatWireUUID), chatPrecondition("chatRevision", chatWireRevision)))}
	if action == "rename" {
		fields = append(fields, chatRequired("toFileName", nativeChatFileName))
	}
	return chatWireObject(fields...)
}

func nativeChatUploadFields(action string) chatWireRule {
	return chatObjectRule(func(fields map[string]json.RawMessage) error {
		var scope postgres.NativeChatScope
		if json.Unmarshal(fields["scope"], &scope) != nil {
			return postgres.ErrInvalid
		}
		revision := chatPrecondition("chatRevision", chatWireRevision)
		name := chatRequired("fileName", nativeChatFileName)
		checks := []chatWireField{nativeChatOwnerField, chatRequired("requestId", chatWireUUID), chatPrecondition("authorityEpoch", chatWireRevision), chatRequired("scope", nativeChatScopeFields), chatRequired("chatId", chatWireUUID)}
		if action != "save" {
			revision = chatPrecondition("chatRevision", chatWireStringIf(func(v string) bool { return v == "0" }))
			name = chatOptional("fileName", nativeChatFileName)
		}
		checks = append(checks, revision, name)
		switch action {
		case "create":
			if scope.Kind == "SINGLE" {
				checks = append(checks, chatRequired("mode", chatWireMode))
			}
		case "save":
			checks = append(checks, chatOptional("generation", chatWireGeneration))
		case "fork":
			checks = append(checks, chatRequired("parentChatId", chatWireUUID), chatPrecondition("parentRevision", chatWireRevision))
		}
		return checkChatWireFields(fields, checks...)
	})
}
