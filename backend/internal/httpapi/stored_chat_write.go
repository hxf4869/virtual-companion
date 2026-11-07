package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/restoregate"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type storedChatWriter interface {
	CreateStoredChat(context.Context, int64, postgres.ChatCreate) (postgres.StoredChat, error)
	DeleteStoredChat(context.Context, int64, string, postgres.ChatDeleteRequest) (postgres.ChatCommit, error)
	AppendStoredMessages(context.Context, int64, string, postgres.ChatAppendRequest) (postgres.ChatCommit, error)
	EditStoredMessage(context.Context, int64, string, string, postgres.ChatMessageEditRequest) (postgres.ChatCommit, error)
	EditStoredChatMetadata(context.Context, int64, string, postgres.ChatMetadataEditRequest) (postgres.ChatCommit, error)
	ApplyStoredChatOperations(context.Context, int64, string, postgres.ChatOperationsRequest) (postgres.ChatCommit, error)
	ForkStoredChat(context.Context, int64, string, postgres.ChatForkRequest) (postgres.ChatForkResult, error)
}

type storedChatGenerationRegistrar interface {
	RegisterStoredChatGeneration(context.Context, int64, string, postgres.ChatGenerationRegistrationRequest) (postgres.ChatGenerationRegistration, error)
}

var (
	_ storedChatWriter              = (*postgres.Store)(nil)
	_ storedChatGenerationRegistrar = (*postgres.Store)(nil)
)

// Selects the chat-specific request-body limit in Server.Handler.
type storedChatWriteHandler struct{ http.HandlerFunc }

func (s *Server) registerStoredChatWrites() {
	s.mux.Handle("POST /api/v1/chats", storedChatWriteRoute(s, http.StatusCreated, chatCreateFields,
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatCreate) (postgres.StoredChat, error) {
			return store.CreateStoredChat(r.Context(), owner, in)
		}))
	s.mux.Handle("DELETE /api/v1/chats/{chatId}", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatPrecondition("chatRevision", chatWireRevision)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatDeleteRequest) (postgres.ChatCommit, error) {
			return store.DeleteStoredChat(r.Context(), owner, r.PathValue("chatId"), in)
		}))
	s.mux.Handle("POST /api/v1/chats/{chatId}/messages", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatRequired("messages", chatWireMessages), chatOptional("generation", chatWireGeneration)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatAppendRequest) (postgres.ChatCommit, error) {
			return store.AppendStoredMessages(r.Context(), owner, r.PathValue("chatId"), in)
		}))
	s.mux.Handle("PATCH /api/v1/chats/{chatId}/messages/{messageId}", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatPrecondition("baseRevision", chatWireRevision), chatRequired("changes", chatWireChanges),
			chatOptional("candidateId", chatWireUUID), chatOptional("generation", chatWireGeneration)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatMessageEditRequest) (postgres.ChatCommit, error) {
			return store.EditStoredMessage(r.Context(), owner, r.PathValue("chatId"), r.PathValue("messageId"), in)
		}))
	s.mux.Handle("PATCH /api/v1/chats/{chatId}/metadata", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatPrecondition("baseRevision", chatWireRevision), chatRequired("changes", chatWireChanges)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatMetadataEditRequest) (postgres.ChatCommit, error) {
			return store.EditStoredChatMetadata(r.Context(), owner, r.PathValue("chatId"), in)
		}))
	s.mux.Handle("POST /api/v1/chats/{chatId}/operations", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatRequired("operations", chatWireArray(1, 100, chatOperationFields)), chatOptional("generation", chatWireGeneration)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatOperationsRequest) (postgres.ChatCommit, error) {
			return store.ApplyStoredChatOperations(r.Context(), owner, r.PathValue("chatId"), in)
		}))
	s.mux.Handle("POST /api/v1/chats/{chatId}/forks", storedChatWriteRoute(s, http.StatusOK,
		chatWriteObject(chatPrecondition("parentRevision", chatWireRevision), chatRequired("throughMessageId", chatWireUUID)),
		func(store storedChatWriter, r *http.Request, owner int64, in postgres.ChatForkRequest) (postgres.ChatForkResult, error) {
			return store.ForkStoredChat(r.Context(), owner, r.PathValue("chatId"), in)
		}))
	s.mux.Handle("POST /api/v1/service/chats/{chatId}/generation-runs", storedChatWriteHandler{s.handleRegisterStoredChatGeneration})
}

func storedChatWriteRoute[In, Out any](s *Server, status int, shape chatWireObjectRule, run func(storedChatWriter, *http.Request, int64, In) (Out, error)) storedChatWriteHandler {
	wire := publicChatWriteFields(shape)
	return storedChatWriteHandler{func(w http.ResponseWriter, r *http.Request) {
		p := s.corePrincipalWithUnavailableCode(w, r, true, "SCHEMA_UNAVAILABLE")
		if p == nil {
			return
		}
		store, ok := s.core.Store.(storedChatWriter)
		if !ok || restoregate.Closed(s.cfg.RestoreGateFile) {
			s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
			return
		}
		for _, name := range []string{"chatId", "messageId"} {
			if id := r.PathValue(name); id != "" {
				id = strings.ToLower(id)
				if !stsource.ValidIdentity(id) {
					s.writeStoreErr(w, postgres.ErrInvalid)
					return
				}
				r.SetPathValue(name, id)
			}
		}
		var in In
		if !s.decodeStoredChatWrite(w, r, &in, wire) {
			return
		}
		out, err := run(store, r, p.AccountID, in)
		if err != nil {
			s.writeStoredChatError(w, err)
			return
		}
		s.writeJSON(w, status, out)
	}}
}

func (s *Server) handleRegisterStoredChatGeneration(w http.ResponseWriter, r *http.Request) {
	if s.cfg.STPlugin.ServiceToken == "" || s.core == nil {
		s.writeAPIError(w, http.StatusServiceUnavailable, "INVALID_REQUEST", "service channel not configured")
		return
	}
	for name := range r.Header {
		if strings.EqualFold(name, "Origin") {
			s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "browser origin rejected")
			return
		}
	}
	authHeaders := r.Header.Values("Authorization")
	if len(authHeaders) != 1 || !strings.HasPrefix(authHeaders[0], "Bearer ") {
		s.writeAPIError(w, http.StatusUnauthorized, "AUTHENTICATION_REQUIRED", "service authentication required")
		return
	}
	if !s.serviceCaller(w, r) {
		return
	}
	store, ok := s.core.Store.(storedChatGenerationRegistrar)
	if !ok || restoregate.Closed(s.cfg.RestoreGateFile) {
		s.writeAPIError(w, http.StatusServiceUnavailable, "SCHEMA_UNAVAILABLE", "temporarily unavailable")
		return
	}
	chatID := strings.ToLower(r.PathValue("chatId"))
	if !stsource.ValidIdentity(chatID) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return
	}
	var in postgres.ChatGenerationRegistrationRequest
	if !s.decodeStoredChatWrite(w, r, &in, chatWireGenerationRegistration) {
		return
	}
	owner, _ := parseChatDecimal(in.OwnerAccountID)
	out, err := store.RegisterStoredChatGeneration(r.Context(), owner, chatID, in)
	if errors.Is(err, postgres.ErrServiceOwnerRejected) {
		s.writeAPIError(w, http.StatusForbidden, "ACCESS_DENIED", "owner account rejected")
		return
	}
	if err != nil {
		s.writeStoredChatError(w, err)
		return
	}
	s.writeJSON(w, http.StatusCreated, out)
}

func (s *Server) decodeStoredChatWrite(w http.ResponseWriter, r *http.Request, dst any, shape chatWireRule) bool {
	if r.ContentLength > postgres.StoredChatMutationBytes {
		s.writeStoredChatError(w, &postgres.ChatError{Code: "CHAT_PAYLOAD_TOO_LARGE"})
		return false
	}
	raw, err := io.ReadAll(r.Body)
	var overLimit *http.MaxBytesError
	if errors.As(err, &overLimit) {
		s.writeStoredChatError(w, &postgres.ChatError{Code: "CHAT_PAYLOAD_TOO_LARGE"})
		return false
	}
	if err != nil || !utf8.Valid(raw) {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return false
	}
	if err := shape(bytes.TrimSpace(raw)); err != nil {
		s.writeStoredChatError(w, err)
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(dst); err != nil {
		s.writeStoreErr(w, postgres.ErrInvalid)
		return false
	}
	return true
}

// Validate closed wire objects and presence before decoding into store structs.
// Go's JSON decoder by itself treats explicit null like omission for scalar
// fields, and accepts case-insensitive field names.
type chatWireRule func(json.RawMessage) error

type chatWireField struct {
	name    string
	check   chatWireRule
	missing error
}

func chatRequired(name string, check chatWireRule) chatWireField {
	return chatWireField{name, check, postgres.ErrInvalid}
}

func chatPrecondition(name string, check chatWireRule) chatWireField {
	return chatWireField{name, check, &postgres.ChatError{Code: "CHAT_PRECONDITION_REQUIRED"}}
}

func chatOptional(name string, check chatWireRule) chatWireField {
	return chatWireField{name, check, nil}
}

type chatWireObjectRule func(map[string]json.RawMessage) error

func chatWireObject(fields ...chatWireField) chatWireRule {
	return chatObjectRule(chatWriteObject(fields...))
}

func chatWriteObject(fields ...chatWireField) chatWireObjectRule {
	return func(obj map[string]json.RawMessage) error {
		return checkChatWireFields(obj, fields...)
	}
}

func chatObjectRule(check chatWireObjectRule) chatWireRule {
	return func(raw json.RawMessage) error {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		start, err := decoder.Token()
		if err != nil || start != json.Delim('{') {
			return postgres.ErrInvalid
		}
		fields := make(map[string]json.RawMessage)
		for decoder.More() {
			key, err := decoder.Token()
			if err != nil {
				return postgres.ErrInvalid
			}
			name := key.(string)
			if _, duplicate := fields[name]; duplicate {
				return postgres.ErrInvalid
			}
			var value json.RawMessage
			if decoder.Decode(&value) != nil {
				return postgres.ErrInvalid
			}
			fields[name] = value
		}
		if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
			return postgres.ErrInvalid
		}
		if err := decoder.Decode(new(json.RawMessage)); err != io.EOF {
			return postgres.ErrInvalid
		}
		return check(fields)
	}
}

func (field chatWireField) take(obj map[string]json.RawMessage) error {
	raw, exists := obj[field.name]
	delete(obj, field.name)
	if !exists {
		return field.missing
	}
	return field.check(raw)
}

func checkChatWireFields(obj map[string]json.RawMessage, fields ...chatWireField) error {
	var missing error
	for _, field := range fields {
		err := field.take(obj)
		if errors.Is(err, postgres.ErrInvalid) {
			return err
		}
		if err != nil {
			missing = err
		}
	}
	if len(obj) != 0 {
		return postgres.ErrInvalid
	}
	return missing
}

func publicChatWriteFields(shape chatWireObjectRule) chatWireRule {
	requestID := chatRequired("requestId", chatWireUUID)
	epoch := chatPrecondition("authorityEpoch", chatWireRevision)
	return chatObjectRule(func(obj map[string]json.RawMessage) error {
		if err := requestID.take(obj); err != nil {
			return err
		}
		err := epoch.take(obj)
		if errors.Is(err, postgres.ErrInvalid) {
			return err
		}
		if shapeErr := shape(obj); shapeErr != nil {
			return shapeErr
		}
		return err
	})
}

func chatWireString(raw json.RawMessage) error {
	if len(raw) == 0 || raw[0] != '"' {
		return postgres.ErrInvalid
	}
	return nil
}

func chatWireCompatData(raw json.RawMessage) error {
	if len(raw) == 0 || raw[0] != '{' {
		return postgres.ErrInvalid
	}
	return nil
}

func chatWireNull(raw json.RawMessage) error {
	if string(raw) != "null" {
		return postgres.ErrInvalid
	}
	return nil
}

func chatWireStringIf(check func(string) bool) chatWireRule {
	return func(raw json.RawMessage) error {
		var value string
		if chatWireString(raw) != nil || json.Unmarshal(raw, &value) != nil || !check(value) {
			return postgres.ErrInvalid
		}
		return nil
	}
}

func chatWireArray(min, max int, check chatWireRule) chatWireRule {
	return func(raw json.RawMessage) error {
		var items []json.RawMessage
		if json.Unmarshal(raw, &items) != nil || len(items) < min || (max > 0 && len(items) > max) {
			return postgres.ErrInvalid
		}
		var missing error
		for _, item := range items {
			err := check(item)
			if errors.Is(err, postgres.ErrInvalid) {
				return err
			}
			if err != nil {
				missing = err
			}
		}
		return missing
	}
}

var (
	chatWireUUID     = chatWireStringIf(func(s string) bool { return stsource.ValidIdentity(strings.ToLower(s)) })
	chatWireRevision = chatWireStringIf(func(s string) bool {
		_, ok := parseChatDecimal(s)
		return ok
	})
	chatWireNonempty = chatWireStringIf(func(s string) bool { return s != "" })
	chatWireMode     = chatWireStringIf(func(s string) bool { return s == "COMPANION" || s == "STORY" })
	chatWireMessages = chatWireArray(1, 100, chatWireObject(
		chatRequired("clientMessageId", chatWireUUID), chatRequired("data", chatWireCompatData)))
	chatWireChanges = chatWireArray(1, 0, chatWireObject(
		chatRequired("path", chatWireArray(1, 0, chatWireString)),
		chatPrecondition("before", chatWireBeforeValue), chatRequired("after", chatWireAfterValue)))
	chatWireGeneration = chatWireObject(chatRequired("generationRunId", chatWireUUID),
		chatRequired("state", chatWireStringIf(func(s string) bool { return s == "settled" || s == "aborted" })))
	chatWireGenerationRegistration = chatWireObject(
		chatRequired("ownerAccountId", chatWireStringIf(func(s string) bool {
			n, ok := parseChatDecimal(s)
			return ok && n > 0
		})),
		chatRequired("requestId", chatWireUUID), chatRequired("authorityEpoch", chatWireRevision),
		chatRequired("generationRunId", chatWireUUID), chatRequired("chatRevision", chatWireRevision),
		chatRequired("inputMessageId", chatWireUUID), chatRequired("inputCandidateId", chatWireUUID))
)

func chatCreateFields(fields map[string]json.RawMessage) error {
	var kind string
	if json.Unmarshal(fields["kind"], &kind) != nil {
		return postgres.ErrInvalid
	}
	delete(fields, "kind")
	title := chatOptional("title", chatWireString)
	switch kind {
	case "SINGLE":
		return checkChatWireFields(fields, title, chatRequired("characterRef", chatWireNonempty), chatRequired("mode", chatWireMode))
	case "GROUP":
		return checkChatWireFields(fields, title, chatRequired("groupRef", chatWireNonempty))
	default:
		return postgres.ErrInvalid
	}
}

var (
	chatWireBeforeValue = chatWireFieldValue(chatPrecondition("value", chatWireAny))
	chatWireAfterValue  = chatWireFieldValue(chatRequired("value", chatWireAny))
)

func chatWireAny(json.RawMessage) error { return nil }

func chatWireFieldValue(value chatWireField) chatWireRule {
	return chatObjectRule(func(fields map[string]json.RawMessage) error {
		exists := string(fields["exists"])
		delete(fields, "exists")
		switch exists {
		case "true":
			return checkChatWireFields(fields, value)
		case "false":
			return checkChatWireFields(fields)
		default:
			return postgres.ErrInvalid
		}
	})
}

var chatOperationFields = chatObjectRule(checkChatOperationFields)

func checkChatOperationFields(fields map[string]json.RawMessage) error {
	var kind string
	if json.Unmarshal(fields["kind"], &kind) != nil {
		return postgres.ErrInvalid
	}
	delete(fields, "kind")

	messageID := chatRequired("messageId", chatWireUUID)
	candidateID := chatRequired("candidateId", chatWireUUID)
	messageRevision := chatPrecondition("messageRevision", chatWireRevision)
	selection := chatPrecondition("selectedCandidateId", chatWireUUID)
	var target, preconditions, payload chatWireRule
	switch kind {
	case "edit", "metadata":
		target = chatWireObject()
		if kind == "edit" {
			target = chatWireObject(messageID, chatOptional("candidateId", chatWireUUID))
		}
		preconditions = chatWireObject(chatPrecondition("baseRevision", chatWireRevision))
		payload = chatWireObject(chatRequired("changes", chatWireChanges))
	case "append":
		target, preconditions = chatWireObject(), chatWireObject()
		payload = chatWireObject(chatRequired("messages", chatWireMessages))
	case "insert":
		target = chatWireObject(chatRequired("beforeMessageId", chatWireUUID))
		preconditions = chatWireObject(chatPrecondition("orderRevision", chatWireRevision))
		payload = chatWireObject(chatRequired("messages", chatWireMessages))
	case "delete", "addSwipe":
		target, preconditions = chatWireObject(messageID), chatWireObject(messageRevision)
		payload = chatWireNull
		if kind == "addSwipe" {
			payload = chatWireObject(chatRequired("candidate", chatWireObject(candidateID, chatRequired("data", chatWireCompatData))))
		}
	case "selectSwipe", "removeSwipe":
		target, preconditions = chatWireObject(messageID, candidateID), chatWireObject(messageRevision, selection)
		payload = chatWireNull
		if kind == "removeSwipe" {
			payload = chatWireObject(chatRequired("replacementCandidateId", func(raw json.RawMessage) error {
				if chatWireNull(raw) == nil {
					return nil
				}
				return chatWireUUID(raw)
			}))
		}
	case "reorder":
		target = chatWireObject(chatRequired("firstMessageId", chatWireUUID), chatRequired("lastMessageId", chatWireUUID))
		preconditions = chatWireObject(chatPrecondition("orderRevision", chatWireRevision))
		payload = chatWireObject(chatRequired("messageIds", chatWireArray(1, 0, chatWireUUID)))
	default:
		return postgres.ErrInvalid
	}
	presence := chatPrecondition
	if kind == "append" {
		presence = chatRequired
	}
	return checkChatWireFields(fields, chatRequired("target", target), presence("preconditions", preconditions), chatRequired("payload", payload))
}
