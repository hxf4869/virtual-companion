//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const isoRestKey = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="

var isoPasswordHash string

func TestMain(m *testing.M) {
	hash, err := auth.Hash(testPassword)
	if err != nil {
		fmt.Fprintf(os.Stderr, "g8 isolation password hash: %v\n", err)
		os.Exit(1)
	}
	isoPasswordHash = hash
	if err := postgres.StartIsolation(); err != nil {
		fmt.Fprintf(os.Stderr, "g8 isolation harness: %v\n", err)
		os.Exit(1)
	}
	code := m.Run()
	postgres.StopIsolation()
	os.Exit(code)
}

func TestG7IsolationLifecycle(t *testing.T) {
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
		t.Fatalf("create %d %s", create.Code, create.Body.String())
	}
	var rel relationshipJSON
	if err := json.Unmarshal(create.Body.Bytes(), &rel); err != nil {
		t.Fatal(err)
	}
	if !rel.Active || rel.ReplyLength != "MEDIUM" || rel.Gender != "NEUTRAL" {
		t.Fatalf("defaults %+v", rel)
	}

	second := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if second.Code != http.StatusOK {
		t.Fatalf("second %d %s", second.Code, second.Body.String())
	}
	var rel2 relationshipJSON
	_ = json.Unmarshal(second.Body.Bytes(), &rel2)
	listed := doJSON(t, s, http.MethodGet, "/api/v1/relationships", "", 1)
	var rels []relationshipJSON
	if err := json.Unmarshal(listed.Body.Bytes(), &rels); err != nil {
		t.Fatal(err)
	}
	active := 0
	for _, row := range rels {
		if row.Active {
			active++
			if row.RelationshipID != rel2.RelationshipID {
				t.Fatal("newest must be the unique active companion")
			}
		}
	}
	if active != 1 {
		t.Fatalf("active count %d", active)
	}

	prefs := `{"companionName":"小周","userAddressAs":"老板","replyLength":"SHORT","initiative":"LOW","humor":"NONE","advicePref":"RARE","remindersAllowed":false,"memoryShareScope":"SESSION","avoidTopics":["WORK"],"gender":"NEUTRAL","avatarRef":"AVATAR_NEUTRAL_01"}`
	patched := doJSON(t, s, http.MethodPatch, "/api/v1/relationships/"+itoa(rel2.RelationshipID), prefs, 1)
	if patched.Code != http.StatusOK {
		t.Fatalf("prefs %d %s", patched.Code, patched.Body.String())
	}

	convRec := doJSON(t, s, http.MethodPost, "/api/v1/conversations", fmt.Sprintf(`{"relationshipId":%d}`, rel2.RelationshipID), 1)
	if convRec.Code != http.StatusOK {
		t.Fatalf("conversation %d %s", convRec.Code, convRec.Body.String())
	}
	var conv struct {
		ConversationID int64 `json:"conversationId"`
	}
	if err := json.Unmarshal(convRec.Body.Bytes(), &conv); err != nil {
		t.Fatal(err)
	}

	foreignConv := doJSON(t, s, http.MethodPost, "/api/v1/conversations", fmt.Sprintf(`{"relationshipId":%d}`, rel2.RelationshipID), 2)
	if foreignConv.Code != http.StatusNotFound {
		t.Fatalf("cross-owner create %d %s", foreignConv.Code, foreignConv.Body.String())
	}
	assertEnvelope(t, foreignConv, "NOT_FOUND_OR_FORBIDDEN")

	enc, err := ciph.Encrypt("fixture-user-line")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.message (owner_user_id, id, conversation_id, role, content)
		 VALUES (1, nextval('vc.message_id_seq'), $1, 'user', $2)`,
		conv.ConversationID, enc); err != nil {
		t.Fatal(err)
	}

	msgs := doJSON(t, s, http.MethodGet, "/api/v1/conversations/"+itoa(conv.ConversationID)+"/messages", "", 1)
	if msgs.Code != http.StatusOK {
		t.Fatalf("messages %d %s", msgs.Code, msgs.Body.String())
	}
	var history []messageJSON
	if err := json.Unmarshal(msgs.Body.Bytes(), &history); err != nil {
		t.Fatal(err)
	}
	if len(history) != 1 || history[0].Content != "fixture-user-line" || history[0].NoMemory {
		t.Fatalf("decrypt %+v", history)
	}
	if strings.Contains(msgs.Body.String(), "enc2:") {
		t.Fatal("ciphertext leaked")
	}

	convs := doJSON(t, s, http.MethodGet, "/api/v1/conversations", "", 1)
	var convList []conversationListJSON
	if err := json.Unmarshal(convs.Body.Bytes(), &convList); err != nil {
		t.Fatal(err)
	}
	if len(convList) != 1 || convList[0].LastMessagePreview == nil || *convList[0].LastMessagePreview != "fixture-user-line" {
		t.Fatalf("preview %+v", convList)
	}

	msgID := history[0].MessageID
	nm := doJSON(t, s, http.MethodPatch,
		"/api/v1/conversations/"+itoa(conv.ConversationID)+"/messages/"+itoa(msgID),
		`{"noMemory":true}`, 1)
	if nm.Code != http.StatusOK {
		t.Fatalf("no-memory %d %s", nm.Code, nm.Body.String())
	}
	var flagged messageJSON
	_ = json.Unmarshal(nm.Body.Bytes(), &flagged)
	if !flagged.NoMemory {
		t.Fatal("noMemory not set")
	}

	ren := doJSON(t, s, http.MethodPatch, "/api/v1/conversations/"+itoa(conv.ConversationID), `{"title":"周二的夜聊"}`, 1)
	if ren.Code != http.StatusOK {
		t.Fatalf("rename %d %s", ren.Code, ren.Body.String())
	}
	end := doJSON(t, s, http.MethodPost, "/api/v1/conversations/"+itoa(conv.ConversationID)+"/end", "", 1)
	if end.Code != http.StatusOK {
		t.Fatalf("end %d %s", end.Code, end.Body.String())
	}

	preview := doJSON(t, s, http.MethodGet, "/api/v1/conversations/wipe-preview", "", 1)
	if preview.Code != http.StatusOK {
		t.Fatalf("wipe preview %d %s", preview.Code, preview.Body.String())
	}
	wipe := doJSON(t, s, http.MethodPost, "/api/v1/conversations/wipe", "", 1)
	if wipe.Code != http.StatusOK {
		t.Fatalf("wipe %d %s", wipe.Code, wipe.Body.String())
	}
	afterWipe := doJSON(t, s, http.MethodGet, "/api/v1/conversations", "", 1)
	var empty []conversationListJSON
	_ = json.Unmarshal(afterWipe.Body.Bytes(), &empty)
	if len(empty) != 0 {
		t.Fatalf("wipe leftover %+v", empty)
	}

	bob := doJSON(t, s, http.MethodGet, "/api/v1/relationships", "", 2)
	var bobRels []relationshipJSON
	_ = json.Unmarshal(bob.Body.Bytes(), &bobRels)
	if len(bobRels) != 0 {
		t.Fatal("cross-owner list leaked")
	}

	del := doJSON(t, s, http.MethodDelete, "/api/v1/relationships/"+itoa(rel2.RelationshipID), "", 1)
	if del.Code != http.StatusOK {
		t.Fatalf("delete companion %d %s", del.Code, del.Body.String())
	}
	missing := doJSON(t, s, http.MethodDelete, "/api/v1/relationships/"+itoa(rel2.RelationshipID), "", 1)
	if missing.Code != http.StatusNotFound {
		t.Fatalf("repeat delete %d", missing.Code)
	}

	gen := doJSON(t, s, http.MethodPost, "/api/v1/conversations/1/generations", `{"idempotencyKey":"k"}`, 1)
	if gen.Code != http.StatusNotFound && gen.Code != http.StatusMethodNotAllowed {
		t.Fatalf("generation must stay unmapped, got %d", gen.Code)
	}

	st := store.Stats()
	if st.Acquired != 0 {
		t.Fatalf("transaction held after response acquired=%d", st.Acquired)
	}
}

func TestG7IsolationDoesNotServeWritesInAPIMigration(t *testing.T) {
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "api-migration"
		case "VC_VERSION":
			return "test"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	ver, err := auth.NewVerifier(testJWTSecret, testIssuer)
	if err != nil {
		t.Fatal(err)
	}
	s := New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{
		Store: postgres.IsolationStore(),
		JWT:   ver,
	})
	rec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration write %d", rec.Code)
	}
	for _, path := range []string{"/api/v1/consents", "/api/v1/reports", "/api/v1/exports", "/api/v1/auth/account"} {
		got := doJSON(t, s, http.MethodPost, path, `{}`, 1)
		if got.Code != http.StatusNotFound && got.Code != http.StatusMethodNotAllowed {
			t.Fatalf("api-migration %s %d", path, got.Code)
		}
	}
	if s.metrics.CoreWrites() != 0 {
		t.Fatalf("production write count %d", s.metrics.CoreWrites())
	}
}

func newIsoServer(t *testing.T, store *postgres.Store) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "full"
		case "VC_VERSION":
			return "test-version"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	ver, err := auth.NewVerifier(testJWTSecret, testIssuer)
	if err != nil {
		t.Fatal(err)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{Store: store, JWT: ver, Passwords: pw})
}

func resetIsolation(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if err := postgres.IsolationSuperExec(ctx, `TRUNCATE vc.account_deletion_intent, vc.relationship, vc.vc_user CASCADE`); err != nil {
		t.Fatal(err)
	}
	if err := postgres.IsolationSuperExec(ctx, `INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob')`); err != nil {
		t.Fatal(err)
	}
	if isoPasswordHash == "" {
		t.Fatal("isolation password hash missing")
	}
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
		 VALUES (1, 'alice', $1, 'USER', 'ACTIVE', 'alice'),
		        (2, 'bob', $1, 'USER', 'ACTIVE', 'bob')`, isoPasswordHash); err != nil {
		t.Fatal(err)
	}
}
