package jobs

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/notify"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

var errNotificationStore = errors.New("notification store is unavailable")

// MaxNotificationAttempts is the number of send tries before a retryable
// result becomes terminal. unknown stays pending until that cap because the
// outcome function treats unknown as terminal. A later try can repeat a
// message the peer already has.
const MaxNotificationAttempts = 5

type notificationStore interface {
	ListDueNotificationDeliveries(context.Context, time.Time) ([]postgres.NotificationDue, error)
	LoadNotificationDelivery(context.Context, int64, int64, time.Time) (postgres.NotificationDelivery, error)
	LoadNotificationCredential(context.Context, int64, string, string) (string, error)
	RecordNotificationOutcome(context.Context, int64, int64, string, string, string) (string, error)
	ScheduleNotificationDelivery(context.Context, int64, int64, int, time.Time) error
	StopNotificationDeliveries(context.Context, int64, *string, string) (int, error)
}

// RunNotificationDeliveries sends each due delivery once. It is not a Loop
// method; the claim loop calls it later. Quiet hours move next_attempt_at
// only. They do not rewrite follow_up.trigger_at.
func RunNotificationDeliveries(ctx context.Context, store notificationStore, sender notify.Sender, policy *safety.Policy, now time.Time, logger *slog.Logger, maxAttempts int) error {
	if store == nil || sender == nil {
		return errNotificationStore
	}
	if now.IsZero() {
		now = time.Now()
	}
	if maxAttempts <= 0 {
		maxAttempts = MaxNotificationAttempts
	}
	if policy == nil {
		policy = safety.New()
	}
	due, err := store.ListDueNotificationDeliveries(ctx, now)
	if err != nil {
		return err
	}
	var first error
	for _, item := range due {
		if err := deliverNotification(ctx, store, sender, policy, now, logger, maxAttempts, item); err != nil && first == nil {
			first = err
		}
	}
	return first
}

func deliverNotification(ctx context.Context, store notificationStore, sender notify.Sender, policy *safety.Policy, now time.Time, logger *slog.Logger, maxAttempts int, item postgres.NotificationDue) error {
	row, err := store.LoadNotificationDelivery(ctx, item.OwnerID, item.ID, now)
	if err != nil {
		return err
	}
	switch decision := postgres.DecideNotificationSend(now, row); decision.Action {
	case postgres.NotificationSkip:
		return nil
	case postgres.NotificationStop:
		_, err = store.StopNotificationDeliveries(ctx, row.OwnerID, &row.EventID, decision.StopReason)
		return err
	case postgres.NotificationDefer:
		if decision.NextAttempt == nil {
			return nil
		}
		return store.ScheduleNotificationDelivery(ctx, row.OwnerID, row.ID, decision.AttemptCount, *decision.NextAttempt)
	}
	plain, err := store.LoadNotificationCredential(ctx, row.OwnerID, row.Channel, row.ConfiguredTarget)
	if err != nil {
		return err
	}
	user, pass, hook, secret, ok := channelCredential(row.Channel, plain)
	if !ok {
		logNotificationCode(logger, notify.CodeCredentialMissing)
		_, err = store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "failed", notify.CodeCredentialMissing, "")
		return err
	}
	msg := notify.ComposeWithLink(row.Channel, row.Intent, row.Body, row.Preview, row.ConversationID)
	if !policy.ReviewOutput(msg.Subject + "\n" + msg.Text).Allow {
		logNotificationCode(logger, notify.CodeSafetyBlocked)
		_, err = store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "failed", notify.CodeSafetyBlocked, "")
		return err
	}
	result, sendErr := sender.Send(ctx, notify.Request{
		Channel:      row.Channel,
		Target:       row.ConfiguredTarget,
		Subject:      msg.Subject,
		Text:         msg.Text,
		DeliveryID:   row.ID,
		Now:          now,
		SMTPUsername: user,
		SMTPPassword: pass,
		WebhookURL:   hook,
		SignSecret:   secret,
	})
	if sendErr != nil {
		result = notify.Result{Kind: notify.KindUnknown}
	}
	return applyNotificationResult(ctx, store, row, result, now, logger, maxAttempts)
}

func applyNotificationResult(ctx context.Context, store notificationStore, row postgres.NotificationDelivery, result notify.Result, now time.Time, logger *slog.Logger, maxAttempts int) error {
	switch result.Kind {
	case notify.KindAccepted:
		correlation := result.Correlation
		if correlation == "" {
			correlation = notify.Correlation("n", row.ID, now)
		}
		_, err := store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "accepted", "", correlation)
		return err
	case notify.KindFailed:
		code := result.FailureCode
		if code == "" {
			code = notify.CodeSMTPRejected
		}
		logNotificationCode(logger, code)
		_, err := store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "failed", code, "")
		return err
	case notify.KindUnknown, notify.KindRetry:
		nextCount := row.AttemptCount + 1
		if nextCount >= maxAttempts {
			if result.Kind == notify.KindUnknown {
				logNotificationCode(logger, "UNKNOWN")
				_, err := store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "unknown", "", result.Correlation)
				return err
			}
			code := result.FailureCode
			if code == "" {
				code = notify.CodeSMTPTemporary
			}
			logNotificationCode(logger, code)
			_, err := store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "failed", code, "")
			return err
		}
		if result.FailureCode != "" {
			logNotificationCode(logger, result.FailureCode)
		} else {
			logNotificationCode(logger, "UNKNOWN")
		}
		return store.ScheduleNotificationDelivery(ctx, row.OwnerID, row.ID, nextCount, now.Add(notify.Backoff(nextCount)))
	default:
		logNotificationCode(logger, notify.CodeNotConfigured)
		_, err := store.RecordNotificationOutcome(ctx, row.OwnerID, row.ID, "failed", notify.CodeNotConfigured, "")
		return err
	}
}

// channelCredential reads the channel row plaintext. EMAIL is a username
// line, which may be empty, and the remainder is the password. The password
// is required. FEISHU is a webhook URL line and the remainder is the sign
// secret. The URL is required. Only trailing newlines are removed. A missing
// credential is not replaced by another channel or by a process secret.
func channelCredential(channel, plain string) (user, pass, hook, secret string, ok bool) {
	plain = strings.TrimRight(plain, "\r\n")
	if plain == "" {
		return "", "", "", "", false
	}
	line, rest, found := strings.Cut(plain, "\n")
	line = strings.TrimRight(line, "\r")
	rest = strings.TrimRight(rest, "\r\n")
	switch channel {
	case "EMAIL":
		if !found || rest == "" {
			return "", "", "", "", false
		}
		return line, rest, "", "", true
	case "FEISHU":
		hook = strings.TrimSpace(line)
		if hook == "" || !strings.Contains(hook, "://") {
			return "", "", "", "", false
		}
		return "", "", hook, rest, true
	default:
		return "", "", "", "", false
	}
}

func logNotificationCode(logger *slog.Logger, code string) {
	if logger == nil || code == "" {
		return
	}
	logger.Info("notification", "error_code", code)
}
