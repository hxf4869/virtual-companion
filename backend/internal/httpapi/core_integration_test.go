//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/auth"
	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/pquerna/otp/totp"
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
	if gen.Code != http.StatusForbidden {
		t.Fatalf("generation admission %d %s", gen.Code, gen.Body.String())
	}
	assertEnvelope(t, gen, "AGE_VERIFICATION_REQUIRED")

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
	s := New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{
		Store:    postgres.IsolationStore(),
		Sessions: postgres.IsolationStore(),
	})
	rec := doJSON(t, s, http.MethodPost, "/api/v1/relationships", `{"personaRef":"gentle-listener"}`, 1)
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("api-migration write %d", rec.Code)
	}
	for _, path := range []string{"/api/v1/consents", "/api/v1/reports", "/api/v1/exports", "/api/v1/auth/account", "/api/v1/auth/login"} {
		got := doJSON(t, s, http.MethodPost, path, `{}`, 1)
		if got.Code != http.StatusNotFound && got.Code != http.StatusMethodNotAllowed {
			t.Fatalf("api-migration %s %d", path, got.Code)
		}
	}
	if s.metrics.CoreWrites() != 0 {
		t.Fatalf("production write count %d", s.metrics.CoreWrites())
	}
}

func TestG9IsolationOpaqueAuth(t *testing.T) {
	resetIsolation(t)
	store := postgres.IsolationStore()
	ciph, err := postgres.NewDefaultFieldCipher(isoRestKey)
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(ciph)
	s := newIsoServer(t, store)

	passwordStep := loginJSON(t, s, "alice", testPassword)
	if passwordStep.Code != http.StatusAccepted {
		t.Fatalf("password step %d %s", passwordStep.Code, passwordStep.Body.String())
	}
	var next authNextStepJSON
	if err := json.Unmarshal(passwordStep.Body.Bytes(), &next); err != nil {
		t.Fatal(err)
	}
	setupRec := doJSONCookies(t, s, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/authenticator-setup", "", nil)
	if setupRec.Code != http.StatusOK {
		t.Fatalf("setup %d %s", setupRec.Code, setupRec.Body.String())
	}
	var setup auth.TOTPProvisioning
	if err := json.Unmarshal(setupRec.Body.Bytes(), &setup); err != nil {
		t.Fatal(err)
	}
	code, err := totp.GenerateCode(setup.ManualKey, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	rec := doJSONCookies(t, s, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/authenticator-confirm",
		`{"code":"`+code+`","trustDevice":true,"deviceName":"integration"}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm %d %s", rec.Code, rec.Body.String())
	}
	var ident map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &ident); err != nil {
		t.Fatal(err)
	}
	if ident["accessToken"] != nil || ident["accountId"] != "1" {
		t.Fatalf("login body %+v", ident)
	}
	var completed authCompleteJSON
	if err := json.Unmarshal(rec.Body.Bytes(), &completed); err != nil {
		t.Fatal(err)
	}
	if len(completed.RecoveryCodes) != auth.RecoveryCodeCount {
		t.Fatalf("recovery codes %d", len(completed.RecoveryCodes))
	}
	jar := responseCookieJar(rec)
	if jar[auth.SessionCookieName] == "" || jar[auth.TrustedDeviceCookieName] == "" {
		t.Fatal("session and trusted-device cookies are required")
	}
	devices, err := store.ListTrustedDevices(t.Context(), 1)
	if err != nil || len(devices) != 1 {
		t.Fatalf("trusted devices %v %v", devices, err)
	}
	fixedExpiry := devices[0].ExpiresAt

	listed := doJSONCookies(t, s, http.MethodGet, "/api/v1/relationships", "", jar)
	if listed.Code != http.StatusOK {
		t.Fatalf("cookie session %d %s", listed.Code, listed.Body.String())
	}

	reauth := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/reauth", `{"password":"`+testPassword+`"}`, jar)
	if reauth.Code != http.StatusOK {
		t.Fatalf("reauth %d %s", reauth.Code, reauth.Body.String())
	}

	csrfMiss := httptest.NewRequest(http.MethodPost, "/api/v1/relationships", strings.NewReader(`{"personaRef":"gentle-listener"}`))
	csrfMiss.Header.Set("Content-Type", "application/json")
	csrfMiss.Header.Set("Origin", "https://vc.test")
	csrfMiss.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: jar[auth.SessionCookieName]})
	csrfRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(csrfRec, csrfMiss)
	if csrfRec.Code != http.StatusForbidden {
		t.Fatalf("csrf %d", csrfRec.Code)
	}
	assertEnvelope(t, csrfRec, "ACCESS_DENIED")

	logout := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/logout", "", jar)
	if logout.Code != http.StatusOK {
		t.Fatalf("logout %d %s", logout.Code, logout.Body.String())
	}
	after := doJSONCookies(t, s, http.MethodGet, "/api/v1/relationships", "", jar)
	if after.Code != http.StatusUnauthorized {
		t.Fatalf("after logout %d %s", after.Code, after.Body.String())
	}
	assertEnvelope(t, after, "AUTHENTICATION_REQUIRED")
	delete(jar, auth.SessionCookieName)
	delete(jar, auth.CSRFCookieName)

	trustedLogin := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"`+testPassword+`"}`, jar)
	if trustedLogin.Code != http.StatusOK || sessionCookie(trustedLogin) == "" {
		t.Fatalf("trusted login %d %s", trustedLogin.Code, trustedLogin.Body.String())
	}
	for name, value := range responseCookieJar(trustedLogin) {
		jar[name] = value
	}
	devices, err = store.ListTrustedDevices(t.Context(), 1)
	if err != nil || len(devices) != 1 || !devices[0].ExpiresAt.Equal(fixedExpiry) {
		t.Fatalf("trusted-device fixed expiry %v %v", devices, err)
	}
	revoke := doJSONCookies(t, s, http.MethodDelete,
		"/api/v1/auth/trusted-devices/"+strconv.FormatInt(devices[0].ID, 10), "", jar)
	if revoke.Code != http.StatusOK {
		t.Fatalf("revoke trusted device %d %s", revoke.Code, revoke.Body.String())
	}
	logout = doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/logout", "", jar)
	if logout.Code != http.StatusOK {
		t.Fatalf("second logout %d %s", logout.Code, logout.Body.String())
	}
	delete(jar, auth.SessionCookieName)
	delete(jar, auth.CSRFCookieName)
	afterRevoke := doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/login",
		`{"account":"alice@example.com","password":"`+testPassword+`"}`, jar)
	if afterRevoke.Code != http.StatusAccepted {
		t.Fatalf("after revoke %d %s", afterRevoke.Code, afterRevoke.Body.String())
	}
	if err := json.Unmarshal(afterRevoke.Body.Bytes(), &next); err != nil || next.NextStep != "TOTP_REQUIRED" {
		t.Fatalf("after revoke next step %v %+v", err, next)
	}
	recovery := doJSONCookies(t, s, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/recovery-code",
		`{"code":"`+completed.RecoveryCodes[0]+`","trustDevice":false}`, nil)
	if recovery.Code != http.StatusOK {
		t.Fatalf("recovery login %d %s", recovery.Code, recovery.Body.String())
	}
	recoveryJar := responseCookieJar(recovery)
	logout = doJSONCookies(t, s, http.MethodPost, "/api/v1/auth/logout", "", recoveryJar)
	if logout.Code != http.StatusOK {
		t.Fatalf("recovery logout %d %s", logout.Code, logout.Body.String())
	}
	delete(jar, auth.TrustedDeviceCookieName)
	retryStep := loginJSON(t, s, "alice", testPassword)
	if err := json.Unmarshal(retryStep.Body.Bytes(), &next); err != nil || next.NextStep != "TOTP_REQUIRED" {
		t.Fatalf("recovery retry step %v %+v", err, next)
	}
	reused := doJSONCookies(t, s, http.MethodPost,
		"/api/v1/auth/challenges/"+next.ChallengeID+"/recovery-code",
		`{"code":"`+completed.RecoveryCodes[0]+`","trustDevice":false}`, nil)
	if reused.Code != http.StatusNotFound {
		t.Fatalf("reused recovery code %d %s", reused.Code, reused.Body.String())
	}

	bob := loginJSON(t, s, "bob", "wrong-password")
	if bob.Code != http.StatusNotFound {
		t.Fatalf("bob wrong %d", bob.Code)
	}
	assertEnvelope(t, bob, "NOT_FOUND_OR_FORBIDDEN")
}

func newIsoServer(t *testing.T, store *postgres.Store) *Server {
	t.Helper()
	cfg, err := config.LoadEnv(func(k string) string {
		switch k {
		case "VC_MODE":
			return "full"
		case "VC_VERSION":
			return "test-version"
		case "VC_HTTP_ORIGINS":
			return "https://vc.test"
		case "VC_SESSION_COOKIE_SECURE":
			return "false"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	pw, err := auth.NewPassword()
	if err != nil {
		t.Fatal(err)
	}
	return New(cfg, observability.NewLogger("error", io.Discard), staticProbes{live: true, ready: true}, observability.NewRegistry(), nil, &Core{
		Store: store, Sessions: store, Passwords: pw, Limiter: auth.NewLimiter(), Turns: store, AuthFlow: store,
	})
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
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
		 VALUES ('openai-compatible', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
		 ON CONFLICT (provider_id) DO UPDATE
		 SET protocol = EXCLUDED.protocol, admission_state = EXCLUDED.admission_state`); err != nil {
		t.Fatal(err)
	}
	if isoPasswordHash == "" {
		t.Fatal("isolation password hash missing")
	}
	if err := postgres.IsolationSuperExec(ctx,
		`INSERT INTO vc.identity_account(id, username, email, email_verified_at, reviewed_at, password_hash, role, status, display_name)
		 VALUES (1, 'alice', 'alice@example.com', now(), now(), $1, 'USER', 'ACTIVE', 'alice'),
		        (2, 'bob', 'bob@example.com', now(), now(), $1, 'USER', 'ACTIVE', 'bob')`, isoPasswordHash); err != nil {
		t.Fatal(err)
	}
}
