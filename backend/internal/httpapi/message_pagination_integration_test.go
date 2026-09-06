//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

// seedPageMessages inserts count encrypted user messages into conv and
// returns their ids in ascending order.
func seedPageMessages(t *testing.T, ciph *postgres.FieldCipher, conv int64, count int) []int64 {
	t.Helper()
	for i := 1; i <= count; i++ {
		enc, err := ciph.Encrypt(fmt.Sprintf("page-%04d", i))
		if err != nil {
			t.Fatal(err)
		}
		if err := postgres.IsolationSuperExec(context.Background(),
			`INSERT INTO vc.message (owner_user_id, id, conversation_id, role, content)
			 VALUES (1, nextval('vc.message_id_seq'), $1, 'user', $2)`,
			conv, enc); err != nil {
			t.Fatal(err)
		}
	}
	// Collect via the recent-window read with an explicit limit: the
	// forward ListMessages path caps at the default page size, which would
	// truncate the ids of larger seed sets.
	msgs, err := postgres.IsolationStore().ListRecentMessages(context.Background(), 1, conv, nil, count)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]int64, 0, len(msgs))
	for _, m := range msgs {
		ids = append(ids, m.ID)
	}
	return ids
}

func TestG7ListMessagesBeforePagination(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)

	create := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if create.Code != http.StatusOK {
		t.Fatalf("relationship %d %s", create.Code, create.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(create.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	convRec := doJSON(t, s, http.MethodPost, "/api/v1/conversations", fmt.Sprintf(`{"relationshipId":%d}`, rel.RelationshipID), 1)
	if convRec.Code != http.StatusOK {
		t.Fatalf("conversation %d %s", convRec.Code, convRec.Body.String())
	}
	var conv struct {
		ConversationID int64 `json:"conversationId"`
	}
	if err := json.Unmarshal(convRec.Body.Bytes(), &conv); err != nil {
		t.Fatal(err)
	}
	ids := seedPageMessages(t, ciph, conv.ConversationID, 5)
	base := fmt.Sprintf("/api/v1/conversations/%d/messages", conv.ConversationID)

	expectRows := func(rec *httptest.ResponseRecorder, wantIDs []int64) {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d %s", rec.Code, rec.Body.String())
		}
		var rows []messageJSON
		if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
			t.Fatal(err)
		}
		if len(rows) != len(wantIDs) {
			t.Fatalf("rows %d, want %d (%s)", len(rows), len(wantIDs), rec.Body.String())
		}
		for i, row := range rows {
			if row.MessageID != wantIDs[i] {
				t.Fatalf("row %d id %d, want %d", i, row.MessageID, wantIDs[i])
			}
		}
	}

	// No params: recent-window read. For a conversation shorter than the
	// page that is still the full ascending history.
	expectRows(doJSON(t, s, http.MethodGet, base, "", 1), ids)

	// after: unchanged forward semantics.
	expectRows(doJSON(t, s, http.MethodGet, base+"?after="+itoa(ids[2]), "", 1), ids[3:])

	// before + limit: newest rows strictly below the cursor, ascending.
	expectRows(doJSON(t, s, http.MethodGet, base+"?before="+itoa(ids[4])+"&limit=2", "", 1), ids[2:4])

	// before without limit still returns the full remaining tail.
	expectRows(doJSON(t, s, http.MethodGet, base+"?before="+itoa(ids[3]), "", 1), ids[:3])

	// before at the oldest row: empty list, response shape intact.
	empty := doJSON(t, s, http.MethodGet, base+"?before="+itoa(ids[0]), "", 1)
	if empty.Code != http.StatusOK || strings.TrimSpace(empty.Body.String()) != "[]" {
		t.Fatalf("before-oldest %d %s", empty.Code, empty.Body.String())
	}

	// after and before are mutually exclusive.
	both := doJSON(t, s, http.MethodGet, base+"?after="+itoa(ids[2])+"&before="+itoa(ids[2]), "", 1)
	if both.Code != http.StatusBadRequest {
		t.Fatalf("after+before %d %s", both.Code, both.Body.String())
	}
	assertEnvelope(t, both, "INVALID_REQUEST")

	// Cross-owner reads stay empty on both paths.
	foreign := doJSON(t, s, http.MethodGet, base, "", 2)
	if foreign.Code != http.StatusOK || strings.TrimSpace(foreign.Body.String()) != "[]" {
		t.Fatalf("cross-owner list %d %s", foreign.Code, foreign.Body.String())
	}
	foreign = doJSON(t, s, http.MethodGet, base+"?before="+itoa(ids[4]), "", 2)
	if foreign.Code != http.StatusOK || strings.TrimSpace(foreign.Body.String()) != "[]" {
		t.Fatalf("cross-owner before %d %s", foreign.Code, foreign.Body.String())
	}
}

// TestG7ListMessagesFirstLoadReturnsLatestWindow pins the first-load contract:
// a no-after request on a conversation longer than one page returns the LAST
// limit rows in ascending order (the newest page), not the oldest rows.
func TestG7ListMessagesFirstLoadReturnsLatestWindow(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)

	create := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if create.Code != http.StatusOK {
		t.Fatalf("relationship %d %s", create.Code, create.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(create.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	convRec := doJSON(t, s, http.MethodPost, "/api/v1/conversations", fmt.Sprintf(`{"relationshipId":%d}`, rel.RelationshipID), 1)
	if convRec.Code != http.StatusOK {
		t.Fatalf("conversation %d %s", convRec.Code, convRec.Body.String())
	}
	var conv struct {
		ConversationID int64 `json:"conversationId"`
	}
	if err := json.Unmarshal(convRec.Body.Bytes(), &conv); err != nil {
		t.Fatal(err)
	}
	const total, page = 60, 50
	ids := seedPageMessages(t, ciph, conv.ConversationID, total)
	base := fmt.Sprintf("/api/v1/conversations/%d/messages", conv.ConversationID)

	expectRows := func(rec *httptest.ResponseRecorder, wantIDs []int64) {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("status %d %s", rec.Code, rec.Body.String())
		}
		var rows []messageJSON
		if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
			t.Fatal(err)
		}
		if len(rows) != len(wantIDs) {
			t.Fatalf("rows %d, want %d (%s)", len(rows), len(wantIDs), rec.Body.String())
		}
		for i, row := range rows {
			if row.MessageID != wantIDs[i] {
				t.Fatalf("row %d id %d, want %d", i, row.MessageID, wantIDs[i])
			}
		}
	}

	// First load (limit only, no cursors): the latest page, ascending.
	expectRows(doJSON(t, s, http.MethodGet, base+"?limit=50", "", 1), ids[total-page:])

	// "Load earlier" from the oldest visible row returns the preceding page.
	oldestVisible := ids[total-page]
	expectRows(doJSON(t, s, http.MethodGet, base+"?before="+itoa(oldestVisible)+"&limit=50", "", 1), ids[:total-page])
}
