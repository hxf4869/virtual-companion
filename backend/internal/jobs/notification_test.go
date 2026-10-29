package jobs

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/notify"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	noteBody    = "w10 greeting text"
	noteAddress = "owner@example.test"
	noteWebhook = "https://hooks.example.test/secret-hook"
	noteSecret  = "demo-secret"
	blockedBody = "其实我是真人，我在乎你。"
)

func TestQuietHoursDoNotSendOrMoveTrigger(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	start, end, zone := "00:00", "23:00", "UTC"
	quiet, until := postgres.NotificationQuietUntil(now, &start, &end, &zone)
	if !quiet {
		t.Fatal("expected quiet hours")
	}
	store := &noteStore{row: readyDelivery()}
	store.row.QuietHoursStart = &start
	store.row.QuietHoursEnd = &end
	store.row.QuietHoursTimezone = &zone
	store.row.DailyLimit = 5
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 {
		t.Fatalf("sent %d times during quiet hours", sender.calls)
	}
	if store.row.AttemptCount != 0 || store.row.Status != "pending" || store.row.NextAttemptAt == nil || !store.row.NextAttemptAt.Equal(until) {
		t.Fatalf("delivery = %+v", store.row)
	}
	if store.triggerWrites != 0 || store.row.TriggerAt != nil || store.row.STDelivered {
		t.Fatal("quiet hours rewrote the follow-up trigger or the ST ack")
	}
	assertLogClean(t, store.log)
}

func TestChannelOffAndConsentStopSending(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	off := &noteStore{row: readyDelivery()}
	off.row.ChannelEnabled = false
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), off, sender, nil, now, off.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 || off.stops != 0 || off.row.Status != "pending" {
		t.Fatalf("disabled channel sent or stopped: calls=%d stops=%d status=%s", sender.calls, off.stops, off.row.Status)
	}

	withdrawn := &noteStore{row: readyDelivery()}
	withdrawn.row.ConsentGranted = false
	if err := RunNotificationDeliveries(context.Background(), withdrawn, sender, nil, now, withdrawn.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 || withdrawn.stops != 1 || withdrawn.stopReason != "consent_withdrawn" || withdrawn.row.Status != "stopped" {
		t.Fatalf("consent: calls=%d stops=%d reason=%s status=%s", sender.calls, withdrawn.stops, withdrawn.stopReason, withdrawn.row.Status)
	}
}

func TestDeletionDoesNotSendOrWrite(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	store.row.DeletionActive = true
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 || store.schedules != 0 || store.records != 0 || store.stops != 0 || store.row.Status != "pending" {
		t.Fatalf("deletion wrote the delivery: %+v calls=%d", store.row, sender.calls)
	}
}

func TestUnknownRetryIsBounded(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	sender := &noteSender{kind: notify.KindUnknown}
	logger := store.logger()
	for i := 0; i < MaxNotificationAttempts; i++ {
		if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, logger, MaxNotificationAttempts); err != nil {
			t.Fatal(err)
		}
		if store.row.NextAttemptAt != nil {
			now = *store.row.NextAttemptAt
		}
	}
	if sender.calls != MaxNotificationAttempts || store.row.Status != "unknown" || store.row.AttemptCount != MaxNotificationAttempts {
		t.Fatalf("calls=%d status=%s attempts=%d", sender.calls, store.row.Status, store.row.AttemptCount)
	}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, logger, MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != MaxNotificationAttempts {
		t.Fatalf("sixth run sent again: %d", sender.calls)
	}
	assertLogClean(t, store.log)
}

func TestTemporaryFailureBecomesFailedAtCap(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	sender := &noteSender{kind: notify.KindRetry, code: notify.CodeSMTPTemporary}
	for i := 0; i < MaxNotificationAttempts; i++ {
		if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, nil, MaxNotificationAttempts); err != nil {
			t.Fatal(err)
		}
		if store.row.NextAttemptAt != nil {
			now = *store.row.NextAttemptAt
		}
	}
	if store.row.Status != "failed" || store.failureCode != notify.CodeSMTPTemporary || sender.calls != MaxNotificationAttempts {
		t.Fatalf("status=%s code=%s calls=%d", store.row.Status, store.failureCode, sender.calls)
	}
}

func TestSafetyBlockDoesNotSend(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	store.row.Preview = true
	body := blockedBody
	store.row.Body = &body
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 || store.row.Status != "failed" || store.failureCode != notify.CodeSafetyBlocked {
		t.Fatalf("calls=%d status=%s code=%s", sender.calls, store.row.Status, store.failureCode)
	}
	if store.row.STDelivered {
		t.Fatal("safety block recorded an ST ack")
	}
	assertLogClean(t, store.log)
	if !strings.Contains(store.log.String(), notify.CodeSafetyBlocked) {
		t.Fatalf("log = %s", store.log.String())
	}
}

func TestAcceptedIsNotSTACK(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 1 || store.row.Status != "accepted" || store.row.STDelivered || store.row.TriggerAt != nil {
		t.Fatalf("delivery = %+v calls=%d", store.row, sender.calls)
	}
	if store.correlation == "" {
		t.Fatal("accepted delivery has no correlation id")
	}
	if sender.last.SMTPUsername != "mailer" || sender.last.SMTPPassword != "planted-pass" {
		t.Fatal("accepted send did not use the channel credential")
	}
	assertLogClean(t, store.log)
}

func TestMissingCredentialFailsClosed(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery(), omitCredential: true}
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 0 || store.row.Status != "failed" || store.failureCode != notify.CodeCredentialMissing {
		t.Fatalf("status=%s code=%s calls=%d", store.row.Status, store.failureCode, sender.calls)
	}
	assertLogClean(t, store.log)
}

func TestDeliveryTextLinksTheConversationWithoutPreview(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	store.row.ConversationID = 9
	store.row.Preview = false
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, store.logger(), MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	if sender.calls != 1 || !strings.Contains(sender.last.Text, "/api/v1/conversations/9") || strings.Contains(sender.last.Text, noteBody) {
		t.Fatal("sent text omitted the conversation link or included the greeting")
	}
}

func TestDailyLimitDefersWithoutSpendingAttempt(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	store := &noteStore{row: readyDelivery()}
	store.row.SentToday = 2
	store.row.DailyLimit = 2
	zone := "UTC"
	store.row.QuietHoursTimezone = &zone
	sender := &noteSender{kind: notify.KindAccepted}
	if err := RunNotificationDeliveries(context.Background(), store, sender, nil, now, nil, MaxNotificationAttempts); err != nil {
		t.Fatal(err)
	}
	want := postgres.NotificationNextMidnight(now, &zone)
	if sender.calls != 0 || store.row.AttemptCount != 0 || store.row.NextAttemptAt == nil || !store.row.NextAttemptAt.Equal(want) {
		t.Fatalf("delivery = %+v calls=%d", store.row, sender.calls)
	}
}

func readyDelivery() postgres.NotificationDelivery {
	body := noteBody
	return postgres.NotificationDelivery{
		OwnerID:          1,
		ID:               41,
		EventID:          "w10-t3",
		Channel:          "EMAIL",
		ConfiguredTarget: noteAddress,
		Status:           "pending",
		Intent:           "BODY",
		Body:             &body,
		ChannelEnabled:   true,
		PolicyEnabled:    true,
		DailyLimit:       5,
		ConsentGranted:   true,
		FollowStatus:     "BODY_READY",
	}
}

type noteStore struct {
	row            postgres.NotificationDelivery
	log            bytes.Buffer
	schedules      int
	records        int
	stops          int
	stopReason     string
	failureCode    string
	correlation    string
	triggerWrites  int
	omitCredential bool
}

func (s *noteStore) logger() *slog.Logger {
	return slog.New(slog.NewTextHandler(&s.log, nil))
}

func (s *noteStore) ListDueNotificationDeliveries(_ context.Context, now time.Time) ([]postgres.NotificationDue, error) {
	if s.row.Status != "pending" {
		return nil, nil
	}
	if s.row.NextAttemptAt != nil && s.row.NextAttemptAt.After(now) {
		return nil, nil
	}
	return []postgres.NotificationDue{{OwnerID: s.row.OwnerID, ID: s.row.ID}}, nil
}

func (s *noteStore) LoadNotificationDelivery(context.Context, int64, int64, time.Time) (postgres.NotificationDelivery, error) {
	return s.row, nil
}

func (s *noteStore) ClaimNotificationSend(_ context.Context, _, _ int64, now time.Time) (postgres.NotificationDecision, error) {
	decision := postgres.DecideNotificationSend(now, s.row)
	if decision.Action != postgres.NotificationSend {
		return decision, nil
	}
	s.row.Status = "sending"
	return decision, nil
}

func (s *noteStore) LoadNotificationCredential(context.Context, int64, string, string) (string, error) {
	if s.omitCredential {
		return "", nil
	}
	return "mailer\nplanted-pass", nil
}

func (s *noteStore) RecordNotificationOutcome(_ context.Context, _, _ int64, outcome, failureCode, correlation string) (string, error) {
	s.records++
	s.row.Status = outcome
	s.failureCode = failureCode
	s.correlation = correlation
	s.row.AttemptCount++
	s.row.NextAttemptAt = nil
	return outcome, nil
}

func (s *noteStore) ScheduleNotificationDelivery(_ context.Context, _, _ int64, attempt int, next time.Time) error {
	s.schedules++
	s.row.AttemptCount = attempt
	s.row.NextAttemptAt = &next
	s.row.Status = "pending"
	return nil
}

func (s *noteStore) StopNotificationDeliveries(_ context.Context, _ int64, _ *string, reason string) (int, error) {
	s.stops++
	s.stopReason = reason
	s.row.Status = "stopped"
	s.row.NextAttemptAt = nil
	return 1, nil
}

type noteSender struct {
	kind  string
	code  string
	calls int
	err   error
	last  notify.Request
}

func (s *noteSender) Send(_ context.Context, req notify.Request) (notify.Result, error) {
	s.calls++
	s.last = req
	if s.err != nil {
		return notify.Result{}, s.err
	}
	return notify.Result{Kind: s.kind, FailureCode: s.code}, nil
}

func assertLogClean(t *testing.T, buf bytes.Buffer) {
	t.Helper()
	text := buf.String()
	for _, secret := range []string{noteBody, noteAddress, noteWebhook, noteSecret, blockedBody} {
		if strings.Contains(text, secret) {
			t.Fatalf("log contains %q: %s", secret, text)
		}
	}
}
