package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestRelationshipClearancePreviewAndReset(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	server := newCoreServer(t, "full", store)

	created := doJSON(t, server, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if created.Code != http.StatusOK {
		t.Fatalf("create %d %s", created.Code, created.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(created.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	store.convs[100] = postgres.Conversation{ID: 100, RelationshipID: rel.RelationshipID}
	store.msgs[101] = postgres.Message{ID: 101, ConversationID: 100}
	store.memories[102] = postgres.Memory{ID: 102, RelationshipID: rel.RelationshipID}

	preview := doJSON(t, server, http.MethodGet,
		"/api/v1/relationships/"+itoa(rel.RelationshipID)+"/clearance-preview", "", 1)
	if preview.Code != http.StatusOK {
		t.Fatalf("preview %d %s", preview.Code, preview.Body.String())
	}
	var scope postgres.RelationshipClearancePreview
	if err := json.Unmarshal(preview.Body.Bytes(), &scope); err != nil {
		t.Fatal(err)
	}
	if scope.RelationshipID != rel.RelationshipID || scope.ConversationCount != 1 || scope.MemoryCount != 1 || scope.ReminderCount != 0 {
		t.Fatalf("preview %+v", scope)
	}

	reset := doJSON(t, server, http.MethodPost,
		"/api/v1/relationships/"+itoa(rel.RelationshipID)+"/reset?retainImportable=true", "", 1)
	if reset.Code != http.StatusOK {
		t.Fatalf("reset %d %s", reset.Code, reset.Body.String())
	}
	var retained relationshipJSON
	if err := json.Unmarshal(reset.Body.Bytes(), &retained); err != nil {
		t.Fatal(err)
	}
	if retained.RelationshipID != rel.RelationshipID || retained.PersonaRef != rel.PersonaRef || retained.ReplyLength != rel.ReplyLength {
		t.Fatalf("retained relationship changed: before=%+v after=%+v", rel, retained)
	}
	if len(store.convs) != 0 || len(store.msgs) != 0 || len(store.memories) != 0 {
		t.Fatalf("relationship domain not cleared: convs=%d messages=%d memories=%d", len(store.convs), len(store.msgs), len(store.memories))
	}
}

func TestRelationshipClearanceHidesMissingAndForeignIDs(t *testing.T) {
	t.Parallel()
	server := newCoreServer(t, "full", newMemStore())
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/relationships/999/clearance-preview"},
		{http.MethodPost, "/api/v1/relationships/999/reset"},
	} {
		rec := doJSON(t, server, tc.method, tc.path, "", 2)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
		assertEnvelope(t, rec, "NOT_FOUND_OR_FORBIDDEN")
		if strings.Contains(rec.Body.String(), "999") {
			t.Fatalf("%s %s leaked identifier", tc.method, tc.path)
		}
	}
}

func TestResetRelationshipValidatesQueryAndWriteGuards(t *testing.T) {
	t.Parallel()
	server := newCoreServer(t, "full", newMemStore())

	invalid := doJSON(t, server, http.MethodPost, "/api/v1/relationships/1/reset?retainImportable=maybe", "", 1)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("invalid query %d %s", invalid.Code, invalid.Body.String())
	}
	assertEnvelope(t, invalid, "INVALID_REQUEST")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/relationships/1/reset", nil)
	attachAuth(t, server, req, 1, false)
	req.Header.Set("Origin", "https://vc.test")
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing csrf %d %s", rec.Code, rec.Body.String())
	}
	assertEnvelope(t, rec, "ACCESS_DENIED")
}
