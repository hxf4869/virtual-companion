package postgres

import (
	"testing"
	"time"
)

func TestDecideNotificationSendGates(t *testing.T) {
	now := time.Date(2026, 6, 15, 12, 0, 0, 0, time.UTC)
	start, end, zone := "00:00", "23:00", "UTC"
	row := NotificationDelivery{
		Status: "pending", ChannelEnabled: true, ConsentGranted: true,
		DailyLimit: 5, FollowStatus: "BODY_READY",
	}
	if DecideNotificationSend(now, row).Action != NotificationSend {
		t.Fatal("open delivery was not sendable")
	}
	quiet := row
	quiet.QuietHoursStart, quiet.QuietHoursEnd, quiet.QuietHoursTimezone = &start, &end, &zone
	decision := DecideNotificationSend(now, quiet)
	_, until := NotificationQuietUntil(now, &start, &end, &zone)
	if decision.Action != NotificationDefer || decision.AttemptCount != 0 || decision.NextAttempt == nil || !decision.NextAttempt.Equal(until) {
		t.Fatalf("quiet decision = %+v", decision)
	}
	capped := row
	capped.SentToday = 5
	capped.QuietHoursTimezone = &zone
	decision = DecideNotificationSend(now, capped)
	if decision.Action != NotificationDefer || decision.AttemptCount != 0 || decision.NextAttempt == nil || !decision.NextAttempt.Equal(NotificationNextMidnight(now, &zone)) {
		t.Fatalf("limit decision = %+v", decision)
	}
	off := row
	off.ChannelEnabled = false
	if DecideNotificationSend(now, off).Action != NotificationSkip {
		t.Fatal("disabled channel was not skipped")
	}
	withdrawn := row
	withdrawn.ConsentGranted = false
	decision = DecideNotificationSend(now, withdrawn)
	if decision.Action != NotificationStop || decision.StopReason != "consent_withdrawn" {
		t.Fatalf("consent decision = %+v", decision)
	}
	deleting := row
	deleting.DeletionActive = true
	if DecideNotificationSend(now, deleting).Action != NotificationSkip {
		t.Fatal("deletion was not left pending")
	}
	unlimited := row
	unlimited.DailyLimit = 0
	unlimited.SentToday = 0
	if DecideNotificationSend(now, unlimited).Action != NotificationSend {
		t.Fatal("a missing daily limit deferred the notification")
	}
}
