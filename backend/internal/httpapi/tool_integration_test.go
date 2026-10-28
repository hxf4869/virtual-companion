//go:build integration

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	toolHTTPChat = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
	toolHTTPBob  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2"
)

func TestToolHTTPAssistantTextCreatesNoReminder(t *testing.T) {
	srv := toolHTTPReady(t)
	toolBind(t, srv, 1, toolHTTPChat, "card-a")
	rec := postTool(t, srv, 1, toolBody(toolHTTPChat, "assistant-text-01", "", `"role":"assistant","content":"remind me tomorrow","utterance":"remind me tomorrow"`))
	out := toolOK(t, rec)
	if out.ExecutionID == "" || out.Status != "FAILED" || out.Tool != "assistant_text" || out.FailureCode == nil || *out.FailureCode != "ASSISTANT_TEXT" {
		t.Fatalf("%+v", out)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder`, 0)
	if postgresContains(t, `SELECT coalesce(string_agg(payload::text, ''), '') FROM vc.tool_execution`, "remind me tomorrow") {
		t.Fatal("assistant utterance was stored")
	}
}

func TestToolHTTPCreateAndIdempotentReplay(t *testing.T) {
	srv := toolHTTPReady(t)
	rel := toolBind(t, srv, 1, toolHTTPChat, "card-a")
	toolAllow(t, srv, 1, rel, true)
	body := toolBody(toolHTTPChat, "create-key-01", "manage_reminder", `"arguments":{"action":"create","text":"buy milk","remindAt":"2026-11-02T15:04:00Z"},"purpose":"tool","step":1`)
	first := toolOK(t, postTool(t, srv, 1, body))
	if first.ExecutionID == "" || first.Status != "SUCCEEDED" {
		t.Fatalf("first %+v", first)
	}
	second := toolOK(t, postTool(t, srv, 1, body))
	if second.ExecutionID != first.ExecutionID {
		t.Fatalf("second %+v", second)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder WHERE owner_user_id = 1`, 1)
	mustCount(t, `SELECT count(*) FROM vc.tool_execution WHERE owner_user_id = 1 AND idempotency_key = 'create-key-01'`, 1)
}

func TestToolHTTPCancelIsTerminal(t *testing.T) {
	srv := toolHTTPReady(t)
	rel := toolBind(t, srv, 1, toolHTTPChat, "card-a")
	toolAllow(t, srv, 1, rel, true)
	created := toolOK(t, postTool(t, srv, 1, toolBody(toolHTTPChat, "cancel-create-01", "manage_reminder", `"arguments":{"action":"create","text":"cancel me","remindAt":"2026-11-02T15:04:00Z"}`)))
	var result map[string]string
	if err := json.Unmarshal(created.Result, &result); err != nil || result["reminderId"] == "" {
		t.Fatalf("result %s %v", created.Result, err)
	}
	cancel := toolBody(toolHTTPChat, "cancel-key-01", "manage_reminder", `"arguments":{"action":"cancel","target":"reminder","reminderId":"`+result["reminderId"]+`"}`)
	first := toolOK(t, postTool(t, srv, 1, cancel))
	second := toolOK(t, postTool(t, srv, 1, cancel))
	if first.ExecutionID == "" || second.ExecutionID != first.ExecutionID || first.Status != "SUCCEEDED" {
		t.Fatalf("first %+v second %+v", first, second)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder WHERE owner_user_id = 1`, 1)
	mustText(t, `SELECT status FROM vc.reminder WHERE owner_user_id = 1`, "CANCELLED")
}

func TestToolHTTPDateOnlyCreatesNoReminder(t *testing.T) {
	srv := toolHTTPReady(t)
	rel := toolBind(t, srv, 1, toolHTTPChat, "card-a")
	toolAllow(t, srv, 1, rel, true)
	out := toolOK(t, postTool(t, srv, 1, toolBody(toolHTTPChat, "date-only-key-01", "manage_reminder", `"arguments":{"action":"create","text":"only date","remindAt":"2026-11-02"}`)))
	if out.Status != "FAILED" || out.FailureCode == nil || *out.FailureCode != "DATE_ONLY" {
		t.Fatalf("%+v", out)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder`, 0)
}

func TestToolHTTPRemindersDisabledFails(t *testing.T) {
	srv := toolHTTPReady(t)
	toolBind(t, srv, 1, toolHTTPChat, "card-a")
	out := toolOK(t, postTool(t, srv, 1, toolBody(toolHTTPChat, "disabled-key-01", "manage_reminder", `"arguments":{"action":"create","text":"nope","remindAt":"2026-11-02T15:04:00Z"}`)))
	if out.Status != "FAILED" || out.FailureCode == nil || *out.FailureCode != "REMINDERS_DISABLED" {
		t.Fatalf("%+v", out)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder`, 0)
}

func TestToolHTTPOtherOwnerCannotSeeReminder(t *testing.T) {
	srv := toolHTTPReady(t)
	rel := toolBind(t, srv, 1, toolHTTPChat, "card-a")
	toolAllow(t, srv, 1, rel, true)
	toolBind(t, srv, 2, toolHTTPBob, "card-b")
	created := toolOK(t, postTool(t, srv, 1, toolBody(toolHTTPChat, "owner-key-01", "manage_reminder", `"arguments":{"action":"create","text":"alice only","remindAt":"2026-11-02T15:04:00Z"}`)))
	if created.Status != "SUCCEEDED" {
		t.Fatalf("create %+v", created)
	}
	bob := toolOK(t, postTool(t, srv, 2, toolBody(toolHTTPChat, "bob-peek-01", "query_scheduled_follow_ups", `"arguments":{}`)))
	if bob.Status != "FAILED" || bob.FailureCode == nil || *bob.FailureCode != "UNBOUND_CHAT" || jsonContains(bob.Result, "alice only") {
		t.Fatalf("bob %+v %s", bob, bob.Result)
	}
	mustCount(t, `SELECT count(*) FROM vc.reminder WHERE owner_user_id = 2`, 0)
	mustCount(t, `SELECT count(*) FROM vc.reminder WHERE owner_user_id = 1 AND text = 'alice only'`, 1)
	mustCount(t, `SELECT count(*) FROM vc.tool_execution WHERE owner_user_id = 2 AND result::text LIKE '%alice only%'`, 0)
}

func toolHTTPReady(t *testing.T) *Server {
	t.Helper()
	resetIsolation(t)
	return newIsoServer(t, postgres.IsolationStore())
}

func toolBind(t *testing.T, srv *Server, account int64, chat, card string) string {
	t.Helper()
	rec := doJSON(t, srv, http.MethodPost, "/api/v1/st/bindings", fmt.Sprintf(`{"chatIdentity":%q,"characterRef":%q,"mode":"COMPANION","displayName":"小周"}`, chat, card), account)
	if rec.Code != http.StatusOK {
		t.Fatalf("bind %d %s", rec.Code, rec.Body.String())
	}
	var body struct {
		RelationshipID string `json:"relationshipId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.RelationshipID == "" {
		t.Fatalf("binding %s %v", rec.Body.String(), err)
	}
	return body.RelationshipID
}

func toolAllow(t *testing.T, srv *Server, account int64, relationshipID string, allowed bool) {
	t.Helper()
	flag := "false"
	if allowed {
		flag = "true"
	}
	body := `{"companionName":"小周","userAddressAs":"老板","replyLength":"SHORT","initiative":"LOW","humor":"NONE","advicePref":"RARE","remindersAllowed":` + flag + `,"memoryShareScope":"SESSION","avoidTopics":["WORK"],"gender":"NEUTRAL","avatarRef":"AVATAR_NEUTRAL_01"}`
	rec := doJSON(t, srv, http.MethodPatch, "/api/v1/relationships/"+relationshipID, body, account)
	if rec.Code != http.StatusOK {
		t.Fatalf("prefs %d %s", rec.Code, rec.Body.String())
	}
}

func postTool(t *testing.T, srv *Server, account int64, body string) *http.Response {
	t.Helper()
	rec := doJSON(t, srv, http.MethodPost, toolExecutePath, body, account)
	return rec.Result()
}

func toolBody(chat, key, tool, extra string) string {
	toolField := ""
	if tool != "" {
		toolField = `,"tool":"` + tool + `"`
	}
	if extra != "" {
		extra = "," + extra
	}
	return `{"chatIdentity":"` + chat + `","idempotencyKey":"` + key + `"` + toolField + extra + `}`
}

func toolOK(t *testing.T, res *http.Response) toolExecuteJSON {
	t.Helper()
	defer res.Body.Close()
	var out toolExecuteJSON
	if res.StatusCode != http.StatusOK {
		var buf map[string]any
		_ = json.NewDecoder(res.Body).Decode(&buf)
		t.Fatalf("status %d %v", res.StatusCode, buf)
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}

func mustCount(t *testing.T, query string, want int) {
	t.Helper()
	stmt := fmt.Sprintf(`DO $do$ DECLARE n bigint; BEGIN n := (%s); IF n <> %d THEN RAISE EXCEPTION 'count %%', n; END IF; END $do$`, query, want)
	if err := postgres.IsolationSuperExec(context.Background(), stmt); err != nil {
		t.Fatal(err)
	}
}

func mustText(t *testing.T, query, want string) {
	t.Helper()
	stmt := fmt.Sprintf(`DO $do$ DECLARE got text; BEGIN got := (%s); IF got IS DISTINCT FROM $want$%s$want$ THEN RAISE EXCEPTION 'got %%', got; END IF; END $do$`, query, want)
	if err := postgres.IsolationSuperExec(context.Background(), stmt); err != nil {
		t.Fatal(err)
	}
}

func postgresContains(t *testing.T, query, needle string) bool {
	t.Helper()
	stmt := fmt.Sprintf(`DO $do$ BEGIN IF position($needle$%s$needle$ in (%s)) = 0 THEN RAISE EXCEPTION 'missing'; END IF; END $do$`, needle, query)
	return postgres.IsolationSuperExec(context.Background(), stmt) == nil
}

func jsonContains(raw json.RawMessage, needle string) bool {
	return strings.Contains(string(raw), needle)
}
