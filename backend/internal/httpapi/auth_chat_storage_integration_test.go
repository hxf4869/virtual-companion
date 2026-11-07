//go:build integration

package httpapi

import (
	"context"
	"net/http"
	"reflect"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestAuthSessionChatStorageIsolation(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	s := newIsoServer(t, store)
	ctx := t.Context()
	get := authSessionRequests(t, s, 1)
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.chat_authority(owner_user_id, authority, epoch) VALUES (2, 'GO', 9007199254740993)
	`); err != nil {
		t.Fatal(err)
	}

	// The other owner's persisted authority cannot replace the missing row.
	defaultState := map[string]any{"mode": "ST", "authorityEpoch": "1"}
	goState := map[string]any{"mode": "GO", "authorityEpoch": "9007199254740993"}
	assertChatStorageSession(t, get(authSessionStoragePath), defaultState)
	assertChatStorageSession(t, doJSON(t, s, http.MethodGet, authSessionStoragePath, "", 2), goState)

	// An owner-scoped authority row remains readable during account deletion.
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.chat_authority(owner_user_id, authority, epoch) VALUES (1, 'FROZEN', 2);
		INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
		VALUES (1, '0000000000000000000000000000000000000000000000000000000000000d01', 'REQUESTED')
	`); err != nil {
		t.Fatal(err)
	}
	ordinary := assertChatStorageSession(t, get(authSessionPath), nil)
	withHint := assertChatStorageSession(t, get(authSessionStoragePath),
		map[string]any{"mode": "FROZEN", "authorityEpoch": "2"})
	if withHint["deletionPending"] != true {
		t.Fatal("session did not expose the active deletion intent")
	}
	delete(withHint, "chatStorage")
	if !reflect.DeepEqual(ordinary, withHint) {
		t.Fatal("included hint changed existing session fields")
	}

	// A denied authority read differs from a missing authority row.
	if err := postgres.IsolationSuperExec(ctx, `REVOKE SELECT ON vc.chat_authority FROM vc_api, vc_worker`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := postgres.IsolationSuperExec(context.Background(), `GRANT SELECT ON vc.chat_authority TO vc_api, vc_worker`); err != nil {
			t.Error(err)
		}
	})
	failed := get(authSessionStoragePath)
	if failed.Code != http.StatusServiceUnavailable {
		t.Fatalf("authority read denial status %d, want 503", failed.Code)
	}
	assertEnvelope(t, failed, "SCHEMA_UNAVAILABLE")
	after := assertChatStorageSession(t, get(authSessionPath), nil)
	if !reflect.DeepEqual(ordinary, after) {
		t.Fatal("ordinary session changed after a denied authority read")
	}
}
