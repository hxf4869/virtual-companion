//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

const toolChat = "11111111-1111-4111-8111-111111111111"

func TestToolAssistantTextCreatesNoReminder(t *testing.T) {
	toolFixture(t)
	out := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "assistant-text-01", Assistant: true,
		Arguments: json.RawMessage(`{}`),
	})
	if out.ID == 0 || out.Status != "FAILED" || out.Tool != "assistant_text" || out.FailureCode == nil || *out.FailureCode != "ASSISTANT_TEXT" {
		t.Fatalf("%+v", out)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "0" {
		t.Fatal("assistant text created a reminder")
	}
	if strings.Contains(toolCount(t, `SELECT payload::text FROM vc.tool_execution WHERE id = `+strconv.FormatInt(out.ID, 10)), "utterance") {
		t.Fatal("payload kept a dialogue key")
	}
}

func TestToolCreateIsIdempotent(t *testing.T) {
	toolFixture(t)
	in := toolCreate("create-key-01", "buy milk", "2026-11-02T15:04:00Z")
	first := toolExec(t, 1, in)
	if first.ID == 0 || first.Status != "SUCCEEDED" || first.Tool != "manage_reminder" {
		t.Fatalf("first %+v", first)
	}
	second := toolExec(t, 1, in)
	if second.ID != first.ID || second.Status != "SUCCEEDED" {
		t.Fatalf("second %+v", second)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "1" || toolCount(t, `SELECT count(*) FROM vc.tool_execution`) != "1" {
		t.Fatalf("rows reminder=%s execution=%s", toolCount(t, `SELECT count(*) FROM vc.reminder`), toolCount(t, `SELECT count(*) FROM vc.tool_execution`))
	}
}

func TestToolCancelIsTerminal(t *testing.T) {
	toolFixture(t)
	created := toolExec(t, 1, toolCreate("cancel-create-01", "cancel me", "2026-11-02T15:04:00Z"))
	reminderID := toolResultID(t, created.Result, "reminderId")
	first := toolExec(t, 1, toolCancelReminder("cancel-key-01", reminderID))
	if first.Status != "SUCCEEDED" {
		t.Fatalf("cancel %+v", first)
	}
	stamp := toolCount(t, `SELECT cancelled_at::text FROM vc.reminder WHERE id = `+reminderID)
	if stamp == "" || toolCount(t, `SELECT status FROM vc.reminder WHERE id = `+reminderID) != "CANCELLED" {
		t.Fatalf("stamp %q", stamp)
	}
	second := toolExec(t, 1, toolCancelReminder("cancel-key-01", reminderID))
	if second.ID != first.ID {
		t.Fatalf("same key returned %+v", second)
	}
	third := toolExec(t, 1, toolCancelReminder("cancel-key-02", reminderID))
	if third.ID == first.ID || third.Status != "SUCCEEDED" {
		t.Fatalf("new key %+v", third)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "1" {
		t.Fatal("cancel deleted the reminder")
	}
	if toolCount(t, `SELECT cancelled_at::text FROM vc.reminder WHERE id = `+reminderID) != stamp {
		t.Fatal("cancelled_at changed")
	}
	if toolCount(t, `SELECT status FROM vc.reminder WHERE id = `+reminderID) != "CANCELLED" {
		t.Fatal("status is not CANCELLED")
	}
}

func TestToolDateOnlyAndMissingTimezoneCreateNoReminder(t *testing.T) {
	toolFixture(t)
	dateOnly := toolExec(t, 1, toolCreate("date-only-key-01", "only date", "2026-11-02"))
	if dateOnly.Status != "FAILED" || dateOnly.FailureCode == nil || *dateOnly.FailureCode != "DATE_ONLY" {
		t.Fatalf("date %+v", dateOnly)
	}
	missing := toolExec(t, 1, toolCreate("missing-zone-01", "no zone", "2026-11-02T15:04:00"))
	if missing.Status != "FAILED" || missing.FailureCode == nil || *missing.FailureCode != "MISSING_TIMEZONE" {
		t.Fatalf("zone %+v", missing)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "0" {
		t.Fatal("invalid instant created a reminder")
	}
}

func TestToolExplicitMidnightIsAccepted(t *testing.T) {
	toolFixture(t)
	out := toolExec(t, 1, toolCreate("midnight-key-01", "midnight", "2026-11-02T00:00:00Z"))
	if out.Status != "SUCCEEDED" {
		t.Fatalf("%+v", out)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder WHERE text = 'midnight' AND remind_at = '2026-11-02T00:00:00Z'`) != "1" {
		t.Fatal("explicit midnight was not stored at that instant")
	}
}

func TestToolRemindersDisabledFailsBeforeDateCheck(t *testing.T) {
	toolFixture(t)
	if _, err := psqlSuper(`UPDATE vc.relationship SET reminders_allowed = false WHERE owner_user_id = 1 AND id = 10`); err != nil {
		t.Fatal(err)
	}
	out := toolExec(t, 1, toolCreate("disabled-key-01", "nope", "2026-11-02"))
	if out.Status != "FAILED" || out.FailureCode == nil || *out.FailureCode != "REMINDERS_DISABLED" {
		t.Fatalf("%+v", out)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "0" {
		t.Fatal("disabled create inserted a reminder")
	}
	query := toolExec(t, 1, ToolRequest{ChatIdentity: toolChat, IdempotencyKey: "query-while-off-01", Tool: "query_scheduled_follow_ups", Arguments: json.RawMessage(`{}`)})
	bound := toolCount(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'evt-bound'`)
	var body struct {
		FollowUps []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"followUps"`
	}
	if query.Status != "SUCCEEDED" || json.Unmarshal(query.Result, &body) != nil || len(body.FollowUps) != 1 || body.FollowUps[0].ID != bound || body.FollowUps[0].Status != "SCHEDULED" {
		t.Fatalf("query while disabled %+v %s", query, query.Result)
	}
}

func TestToolQueryReturnsBoundScheduledOnly(t *testing.T) {
	toolFixture(t)
	out := toolExec(t, 1, ToolRequest{ChatIdentity: toolChat, IdempotencyKey: "query-key-01", Tool: "query_scheduled_follow_ups", Arguments: json.RawMessage(`{}`)})
	if out.Status != "SUCCEEDED" {
		t.Fatalf("%+v", out)
	}
	var body struct {
		FollowUps []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"followUps"`
	}
	if err := json.Unmarshal(out.Result, &body); err != nil {
		t.Fatal(err)
	}
	bound := toolCount(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'evt-bound'`)
	if len(body.FollowUps) != 1 || body.FollowUps[0].Status != "SCHEDULED" || body.FollowUps[0].ID != bound {
		t.Fatalf("followUps = %+v want %s", body.FollowUps, bound)
	}
}

func TestToolForbiddenRelationshipCreatesNoReminder(t *testing.T) {
	toolFixture(t)
	out := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "forbidden-key-01", Tool: "manage_reminder", Forbidden: true,
		Arguments: json.RawMessage(`{"action":"create","text":"x","remindAt":"2026-11-02T15:04:00Z","relationshipId":11}`),
	})
	if out.Status != "FAILED" || out.FailureCode == nil || *out.FailureCode != "FORBIDDEN_RELATIONSHIP" || out.Tool != "rejected" {
		t.Fatalf("%+v", out)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "0" {
		t.Fatal("forbidden relationship created a reminder")
	}
}

func TestToolOtherOwnerCannotSeeExecutions(t *testing.T) {
	toolFixture(t)
	_ = toolExec(t, 1, toolCreate("owner-key-01", "private", "2026-11-02T15:04:00Z"))
	var executions int
	var reminders int
	err := testEnv.store.WithOwner(context.Background(), 2, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.tool_execution`).Scan(&executions); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.list_reminders(2, NULL, 0, 50)`).Scan(&reminders)
	})
	if err != nil {
		t.Fatal(err)
	}
	if executions != 0 || reminders != 0 {
		t.Fatalf("other owner saw executions=%d reminders=%d", executions, reminders)
	}
	if err := testEnv.store.WithOwner(context.Background(), 2, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.reminder`).Scan(&n)
	}); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("reminder table read = %v", err)
	}
	var doc []byte
	err = testEnv.store.WithOwner(context.Background(), 2, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.export_v2_owner_metadata(2)`).Scan(&doc)
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(doc), "private") {
		t.Fatal("export leaked the other owner's reminder")
	}
}

func TestToolCancelFollowUpIsTerminal(t *testing.T) {
	toolFixture(t)
	bound := toolCount(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'evt-bound'`)
	other := toolCount(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'evt-other'`)
	miss := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "cancel-other-rel-01", Tool: "manage_reminder",
		Arguments: json.RawMessage(`{"action":"cancel","target":"follow_up","followUpId":"` + other + `"}`),
	})
	if miss.Status != "FAILED" || miss.FailureCode == nil || *miss.FailureCode != "NOT_FOUND" {
		t.Fatalf("other relationship %+v", miss)
	}
	if toolCount(t, `SELECT status FROM vc.follow_up WHERE event_id = 'evt-other'`) != "SCHEDULED" {
		t.Fatal("other relationship follow-up changed")
	}
	first := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "cancel-follow-01", Tool: "manage_reminder",
		Arguments: json.RawMessage(`{"action":"cancel","target":"follow_up","followUpId":"` + bound + `"}`),
	})
	if first.Status != "SUCCEEDED" {
		t.Fatalf("cancel %+v", first)
	}
	stamp := toolCount(t, `SELECT cancelled_at::text FROM vc.follow_up WHERE id = `+bound)
	second := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "cancel-follow-01", Tool: "manage_reminder",
		Arguments: json.RawMessage(`{"action":"cancel","target":"follow_up","followUpId":"` + bound + `"}`),
	})
	if second.ID != first.ID || toolCount(t, `SELECT cancelled_at::text FROM vc.follow_up WHERE id = `+bound) != stamp {
		t.Fatal("repeat follow-up cancel changed the execution or timestamp")
	}
	if toolCount(t, `SELECT status FROM vc.follow_up WHERE id = `+bound) != "CANCELLED" {
		t.Fatal("follow-up was not cancelled")
	}
}

func TestToolInvalidKeyCreatesNoExecution(t *testing.T) {
	toolFixture(t)
	_, err := testEnv.store.ExecuteTool(context.Background(), 1, ToolRequest{ChatIdentity: toolChat, IdempotencyKey: "short", Tool: "manage_reminder"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("%v", err)
	}
	if toolCount(t, `SELECT count(*) FROM vc.tool_execution`) != "0" {
		t.Fatal("invalid key inserted an execution")
	}
}

func TestToolMeterBoundsFailWithoutReminder(t *testing.T) {
	toolFixture(t)
	step := 0
	out := toolExec(t, 1, ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: "bounds-key-01", Tool: "manage_reminder", Step: &step,
		Arguments: json.RawMessage(`{"action":"create","text":"bounds","remindAt":"2026-11-02T15:04:00Z"}`),
	})
	if out.Status != "FAILED" || out.FailureCode == nil || *out.FailureCode != "INVALID_BOUNDS" || out.Step == nil || *out.Step != 0 {
		t.Fatalf("%+v", out)
	}
	if toolCount(t, `SELECT count(*) FROM vc.reminder`) != "0" {
		t.Fatal("out of bounds create inserted a reminder")
	}
}

func toolFixture(t *testing.T) {
	t.Helper()
	resetFixtures(t)
	if _, err := psqlSuper(`
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-b', true);
UPDATE vc.relationship SET reminders_allowed = true WHERE owner_user_id = 1 AND id = 10;
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito) VALUES
 (1, 501, 10, 'w11', '11111111-1111-4111-8111-111111111111', 'COMPANION', 'PRESENT', false),
 (1, 502, 11, 'w11b', '22222222-2222-4222-8222-222222222222', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.follow_up(owner_user_id, relationship_id, memory_item_id, source_ref, body, status, normalization_status, time_precision, reminder_rule_confirmed, event_date, event_time, event_timezone, trigger_at, event_id) VALUES
 (1, 10, 91001, 'st:synthetic', 'bound', 'SCHEDULED', 'explicit_date', 'minute', false, DATE '2026-11-02', '15:04', 'Asia/Shanghai', '2026-11-02 07:04:00+00', 'evt-bound'),
 (1, 10, 91002, 'st:synthetic', 'unclear', 'NEEDS_CLARIFICATION', 'needs_clarification', 'date', false, DATE '2026-11-02', NULL, NULL, NULL, 'evt-unclear'),
 (1, 11, 91003, 'st:synthetic', 'other', 'SCHEDULED', 'explicit_date', 'minute', false, DATE '2026-11-03', '09:00', 'Asia/Shanghai', '2026-11-03 01:00:00+00', 'evt-other'),
 (2, 20, 91004, 'st:synthetic', 'bob', 'SCHEDULED', 'explicit_date', 'minute', false, DATE '2026-11-04', '10:00', 'Asia/Shanghai', '2026-11-04 02:00:00+00', 'evt-bob');
`); err != nil {
		t.Fatal(err)
	}
}

func toolCreate(key, text, at string) ToolRequest {
	return ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: key, Tool: "manage_reminder",
		Arguments: json.RawMessage(`{"action":"create","text":"` + text + `","remindAt":"` + at + `"}`),
	}
}

func toolCancelReminder(key, reminderID string) ToolRequest {
	return ToolRequest{
		ChatIdentity: toolChat, IdempotencyKey: key, Tool: "manage_reminder",
		Arguments: json.RawMessage(`{"action":"cancel","target":"reminder","reminderId":"` + reminderID + `"}`),
	}
}

func toolExec(t *testing.T, owner int64, in ToolRequest) ToolExecution {
	t.Helper()
	out, err := testEnv.store.ExecuteTool(context.Background(), owner, in)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func toolCount(t *testing.T, sql string) string {
	t.Helper()
	out, err := psqlSuper(sql)
	if err != nil {
		t.Fatal(err)
	}
	return strings.TrimSpace(out)
}

func toolResultID(t *testing.T, raw json.RawMessage, key string) string {
	t.Helper()
	var body map[string]string
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body[key] == "" {
		t.Fatalf("missing %s in %s", key, raw)
	}
	return body[key]
}
