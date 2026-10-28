// Package notify sends one inbox event through an enabled email or Feishu
// channel. It does not roll back the inbox row and does not record an ST ACK.
package notify

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"time"
)

const (
	// Title is the generic subject and the body used when preview is off.
	Title = "有一条新的陪伴消息"
	// LoginHint tells the reader the text is not the conversation itself.
	LoginHint = "请登录后查看。"
	// GroupVisible is the Feishu notice that the bot posts into a group.
	GroupVisible = "此消息对群内成员可见。"
	// WaitingHost is the fixed copy for a WAITING_HOST inbox event.
	WaitingHost = "有待继续的互动"

	KindAccepted = "accepted"
	KindFailed   = "failed"
	KindUnknown  = "unknown"
	KindRetry    = "retry"

	CodeSMTPRejected      = "SMTP_REJECTED"
	CodeSMTPTemporary     = "SMTP_TEMPORARY"
	CodeHTTPError         = "HTTP_ERROR"
	CodeFeishuRejected    = "FEISHU_REJECTED"
	CodeRateLimited       = "RATE_LIMITED"
	CodeSafetyBlocked     = "SAFETY_BLOCKED"
	CodeNotConfigured     = "NOT_CONFIGURED"
	CodeCredentialMissing = "CREDENTIAL_MISSING"
)

// Message is the text that will be handed to a channel after safety review.
type Message struct {
	Subject string
	Text    string
}

// Request is one delivery attempt. Target is the mailbox or the group label.
// It is never a webhook URL and must not be written to logs.
// SMTPUsername, SMTPPassword, WebhookURL and SignSecret come from the channel
// row. They are not process configuration and must not be written to logs.
type Request struct {
	Channel      string
	Target       string
	Subject      string
	Text         string
	DeliveryID   int64
	Now          time.Time
	SMTPUsername string
	SMTPPassword string
	WebhookURL   string
	SignSecret   string
}

// Result is a channel outcome. Accepted and a terminal unknown or failed are
// recorded as those statuses. Retry stays pending. Correlation is an opaque
// id the caller may store; it is not an ST message id.
type Result struct {
	Kind        string
	FailureCode string
	Correlation string
}

// Compose builds the notification text. Preview defaults to off at the call
// site. WAITING_HOST never uses the inbox body. The email subject stays generic.
func Compose(channel, intent string, body *string, preview bool) Message {
	var text strings.Builder
	switch intent {
	case "WAITING_HOST":
		text.WriteString(WaitingHost)
	default:
		if preview && body != nil {
			if trimmed := strings.TrimSpace(*body); trimmed != "" {
				text.WriteString(trimmed)
				break
			}
		}
		text.WriteString(Title)
	}
	text.WriteByte('\n')
	text.WriteString(LoginHint)
	if channel == "FEISHU" {
		text.WriteByte('\n')
		text.WriteString(GroupVisible)
	}
	return Message{Subject: Title, Text: text.String()}
}

// ComposeWithLink adds the login-protected conversation path when the id is
// known. A zero id leaves the text unchanged. The path carries no body, API
// key or long-lived token. Preview still controls whether the greeting is
// included; WAITING_HOST never includes it.
func ComposeWithLink(channel, intent string, body *string, preview bool, conversationID int64) Message {
	msg := Compose(channel, intent, body, preview)
	if conversationID > 0 {
		msg.Text += "\n/api/v1/conversations/" + itoa(conversationID)
	}
	return msg
}

// FeishuSign is the custom-bot signature: HMAC-SHA256 with
// timestamp + "\n" + secret as the key and an empty message, then base64.
func FeishuSign(timestamp, secret string) string {
	mac := hmac.New(sha256.New, []byte(timestamp+"\n"+secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// Correlation is a local opaque id. It matches the delivery correlation check
// and is not a Message-ID.
func Correlation(prefix string, deliveryID int64, now time.Time) string {
	if now.IsZero() {
		now = time.Unix(0, 0).UTC()
	}
	if prefix == "" {
		prefix = "n"
	}
	return prefix + "-" + itoa(deliveryID) + "-" + itoa(now.Unix())
}

// Backoff is the wait after retryable attempt n (1-based): 1m, 2m, 4m, …,
// capped at 30m. The peer may already have the message, so a later attempt
// can repeat it.
func Backoff(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	shift := attempt - 1
	if shift > 5 {
		shift = 5
	}
	d := time.Minute << shift
	if d > 30*time.Minute {
		return 30 * time.Minute
	}
	return d
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
