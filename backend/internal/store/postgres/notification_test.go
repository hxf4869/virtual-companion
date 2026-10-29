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
	windowStart, windowEnd := "22:00", "08:00"
	for _, name := range []string{"asia/shanghai", "UTC+8"} {
		bad := name
		quietNow, until := followUpQuietUntil(now, &windowStart, &windowEnd, &bad)
		if !quietNow || !until.Equal(now.Add(time.Hour)) {
			t.Fatalf("%s quiet=%v until=%s", name, quietNow, until)
		}
		unparsed := row
		unparsed.QuietHoursStart, unparsed.QuietHoursEnd, unparsed.QuietHoursTimezone = &windowStart, &windowEnd, &bad
		decision = DecideNotificationSend(now, unparsed)
		if decision.Action != NotificationDefer || decision.NextAttempt == nil || !decision.NextAttempt.Equal(until) {
			t.Fatalf("%s notification decision = %+v", name, decision)
		}
		past := now.Add(-time.Hour)
		due := DecideFollowUpDue(now, FollowUpDueFacts{
			Status: "SCHEDULED", PolicyEnabled: true, TriggerAt: &past, DailyLimit: 3,
			QuietHoursStart: &windowStart, QuietHoursEnd: &windowEnd, QuietHoursTimezone: &bad,
		})
		if due.Action != FollowUpDueDefer || due.DeferredUntil == nil || !due.DeferredUntil.Equal(until) {
			t.Fatalf("%s follow-up decision = %+v", name, due)
		}
	}
	good := "Asia/Shanghai"
	// 04:00 UTC is 12:00 in Asia/Shanghai, outside 22:00–08:00.
	noon := time.Date(2026, 6, 15, 4, 0, 0, 0, time.UTC)
	if quiet, _ := followUpQuietUntil(noon, &windowStart, &windowEnd, &good); quiet {
		t.Fatal("Asia/Shanghai noon was treated as quiet")
	}
	lower := "asia/shanghai"
	if quiet, _ := followUpQuietUntil(noon, &windowStart, &windowEnd, &lower); !quiet {
		t.Fatal("unparsed asia/shanghai at noon was treated as outside quiet hours")
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
