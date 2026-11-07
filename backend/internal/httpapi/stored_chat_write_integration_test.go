//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/jackc/pgx/v5"
)

func TestStoredChatWriteIsolationLifecycle(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	cipher, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(cipher)
	t.Cleanup(func() { store.UseCipher(nil) })
	if err := postgres.IsolationSuperExec(t.Context(), `INSERT INTO vc.chat_authority(owner_user_id,authority,epoch) VALUES(1,'GO',2),(2,'GO',2)`); err != nil {
		t.Fatal(err)
	}
	s := newIsoServer(t, store)
	s.cfg.STPlugin.ServiceToken = strings.Repeat("synthetic-", 4)
	requestID := func(n int) string { return fmt.Sprintf("40000000-0000-4000-8000-%012d", n) }
	marshal := func(value any) string {
		t.Helper()
		body, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		return string(body)
	}
	decode := func(rec *httptest.ResponseRecorder, status int, dst any) {
		t.Helper()
		if rec.Code != status {
			// Response bodies can contain chat documents; report only status/code.
			var envelope struct{ Code string }
			_ = json.Unmarshal(rec.Body.Bytes(), &envelope)
			t.Fatalf("status=%d code=%s, want=%d", rec.Code, envelope.Code, status)
		}
		if err := json.Unmarshal(rec.Body.Bytes(), dst); err != nil {
			t.Fatal(err)
		}
	}
	var chat postgres.StoredChat
	decode(doJSON(t, s, http.MethodPost, "/api/v1/chats", marshal(map[string]any{
		"requestId": requestID(1), "authorityEpoch": "2", "kind": "GROUP", "groupRef": "synthetic-http", "title": "synthetic",
	}), 1), 201, &chat)
	path := "/api/v1/chats/" + chat.ChatID
	inputRequest := postgres.ChatAppendRequest{RequestID: requestID(2), AuthorityEpoch: 2, Messages: []postgres.ChatAppendMessage{
		{MessageID: requestID(20), Data: postgres.ChatData{"mes": "synthetic input", "is_user": true}},
	}}
	var input postgres.ChatCommit
	decode(doJSON(t, s, http.MethodPost, path+"/messages", marshal(inputRequest), 1), 201, &input)
	var tail postgres.ChatCommit
	decode(doJSON(t, s, http.MethodPost, path+"/messages", marshal(postgres.ChatAppendRequest{RequestID: requestID(3), AuthorityEpoch: 2,
		Messages: []postgres.ChatAppendMessage{{MessageID: requestID(21), Data: postgres.ChatData{"mes": "synthetic background"}}}}), 1), 201, &tail)
	register := postgres.ChatGenerationRegistrationRequest{OwnerAccountID: "1", RequestID: requestID(4), AuthorityEpoch: 2,
		RunID: requestID(30), Revision: input.Revision, InputMessageID: input.Changed[0].MessageID, InputCandidateID: input.Changed[0].SelectedCandidateID}
	private := func(body postgres.ChatGenerationRegistrationRequest) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/service/chats/"+chat.ChatID+"/generation-runs", strings.NewReader(marshal(body)))
		r.Header.Set("Authorization", "Bearer "+s.cfg.STPlugin.ServiceToken)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		return w
	}
	var registration postgres.ChatGenerationRegistration
	decode(private(register), 201, &registration)
	if registration.Revision != input.Revision || registration.InputCandidateID != register.InputCandidateID || registration.ChatID != chat.ChatID {
		t.Fatal("HTTP registration changed the accepted input baseline")
	}
	terminal := postgres.ChatAppendRequest{RequestID: requestID(5), AuthorityEpoch: 2,
		Messages:   []postgres.ChatAppendMessage{{MessageID: requestID(22), Data: postgres.ChatData{"mes": "synthetic output"}}},
		Generation: &postgres.ChatGenerationCommit{RunID: register.RunID, State: "settled"}}
	var first, replay postgres.ChatCommit
	decode(doJSON(t, s, http.MethodPost, path+"/messages", marshal(terminal), 1), 201, &first)
	decode(doJSON(t, s, http.MethodPost, path+"/messages", marshal(terminal), 1), 201, &replay)
	if !reflect.DeepEqual(first, replay) || len(first.Changed) != 1 {
		t.Fatal("HTTP terminal replay changed the canonical receipt")
	}
	assertStoredChatError(t, doJSON(t, s, http.MethodGet, path+"/messages", "", 2), 404, "NOT_FOUND_OR_FORBIDDEN")
	register.RequestID, register.RunID, register.Revision = requestID(6), requestID(31), first.Revision
	decode(private(register), 201, &registration)
	selected := input.Changed[0].SelectedCandidateID
	var edit postgres.ChatCommit
	decode(doJSON(t, s, http.MethodPatch, path+"/messages/"+input.Changed[0].MessageID, marshal(postgres.ChatMessageEditRequest{
		RequestID: requestID(7), AuthorityEpoch: 2, BaseRevision: 1, CandidateID: &selected,
		Changes: []postgres.ChatFieldChange{{Path: []string{"mes"}, Before: postgres.ChatFieldValue{Exists: true, Value: "synthetic input"},
			After: postgres.ChatFieldValue{Exists: true, Value: "synthetic edited input"}}},
	}), 1), 200, &edit)
	terminal.RequestID, terminal.Generation.RunID = requestID(8), register.RunID
	assertStoredChatError(t, doJSON(t, s, http.MethodPost, path+"/messages", marshal(terminal), 1), 409, "CHAT_GENERATION_FENCED")
	forkRequest := postgres.ChatForkRequest{RequestID: requestID(11), AuthorityEpoch: 2,
		ParentRevision: edit.Revision, ThroughID: input.Changed[0].MessageID}
	var fork, forkReplay postgres.ChatForkResult
	decode(doJSON(t, s, http.MethodPost, path+"/forks", marshal(forkRequest), 1), 201, &fork)
	decode(doJSON(t, s, http.MethodPost, path+"/forks", marshal(forkRequest), 1), 201, &forkReplay)
	if !reflect.DeepEqual(fork, forkReplay) || fork.Chat.ChatID == chat.ChatID || len(fork.Mapping) != 1 {
		t.Fatal("HTTP fork replay changed the canonical receipt")
	}
	for _, request := range []string{inputRequest.RequestID, forkRequest.RequestID} {
		var status int
		err := store.WithOwner(t.Context(), 1, func(ctx context.Context, tx pgx.Tx) error {
			return tx.QueryRow(ctx, "SELECT status FROM vc.chat_receipt WHERE owner_user_id=1 AND request_id=$1", request).Scan(&status)
		})
		if err != nil || status != http.StatusCreated {
			t.Fatalf("persisted receipt status=%d, want %d (err=%v)", status, http.StatusCreated, err)
		}
	}
	// Receipts written before the success-status correction keep their original status.
	if err := postgres.IsolationSuperExec(t.Context(), "UPDATE vc.chat_receipt SET status=200 WHERE owner_user_id=1 AND request_id IN ($1,$2)", inputRequest.RequestID, forkRequest.RequestID); err != nil {
		t.Fatal(err)
	}
	decode(doJSON(t, s, http.MethodPost, path+"/messages", marshal(inputRequest), 1), 200, &replay)
	if !reflect.DeepEqual(input, replay) {
		t.Fatal("old HTTP append replay changed the canonical receipt")
	}
	decode(doJSON(t, s, http.MethodPost, path+"/forks", marshal(forkRequest), 1), 200, &forkReplay)
	if !reflect.DeepEqual(fork, forkReplay) {
		t.Fatal("old HTTP fork replay changed the canonical receipt")
	}
	deleted := postgres.ChatDeleteRequest{RequestID: requestID(9), AuthorityEpoch: 2, Revision: edit.Revision}
	var tombstone postgres.ChatCommit
	decode(doJSON(t, s, http.MethodDelete, path, marshal(deleted), 1), 200, &tombstone)
	if !tombstone.Deleted || len(tombstone.Changed) != 0 || tombstone.Chat != nil {
		t.Fatal("chat deletion returned old documents")
	}
	decode(doJSON(t, s, http.MethodDelete, path, marshal(deleted), 1), 200, &replay)
	if !reflect.DeepEqual(tombstone, replay) {
		t.Fatal("delete retry lost its body-free tombstone")
	}
	assertStoredChatError(t, doJSON(t, s, http.MethodPost, path+"/messages", marshal(inputRequest), 1), 404, "NOT_FOUND_OR_FORBIDDEN")
	assertStoredChatError(t, private(register), 404, "NOT_FOUND_OR_FORBIDDEN")
	if err := postgres.IsolationSuperExec(t.Context(), `UPDATE vc.identity_account SET status='DISABLED' WHERE id=2`); err != nil {
		t.Fatal(err)
	}
	register.OwnerAccountID, register.RequestID = "2", requestID(10)
	assertStoredChatError(t, private(register), 403, "ACCESS_DENIED")
}
