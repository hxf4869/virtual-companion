package config

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// Notify is the process configuration for email and Feishu. Empty host and
// empty webhook leave that channel unconfigured. There is no switch that
// disables TLS certificate verification.
type Notify struct {
	SMTPHost         string
	SMTPPort         int
	SMTPUsername     string
	SMTPPassword     string
	SMTPFrom         string
	FeishuWebhookURL string
	FeishuSignSecret string
	MaxAttempts      int
}

// LoadNotify reads notification settings. Absent values leave both channels
// off and the attempt cap at 5.
func LoadNotify(getenv func(string) string) (Notify, error) {
	if getenv == nil {
		getenv = func(string) string { return "" }
	}
	out := Notify{MaxAttempts: 5}
	if raw := strings.TrimSpace(getenv("VC_NOTIFY_MAX_ATTEMPTS")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return Notify{}, errors.New("VC_NOTIFY_MAX_ATTEMPTS must be from 1 to 20")
		}
		out.MaxAttempts = n
	}
	out.SMTPHost = strings.TrimSpace(getenv("VC_SMTP_HOST"))
	if raw := strings.TrimSpace(getenv("VC_SMTP_PORT")); raw != "" {
		n, err := strconv.Atoi(raw)
		if err != nil {
			return Notify{}, errors.New("VC_SMTP_PORT is invalid")
		}
		out.SMTPPort = n
	}
	out.SMTPUsername = strings.TrimSpace(getenv("VC_SMTP_USERNAME"))
	out.SMTPPassword = getenv("VC_SMTP_PASSWORD")
	out.SMTPFrom = strings.TrimSpace(getenv("VC_SMTP_FROM"))
	out.FeishuWebhookURL = strings.TrimSpace(getenv("VC_FEISHU_WEBHOOK_URL"))
	out.FeishuSignSecret = getenv("VC_FEISHU_SIGN_SECRET")
	if err := out.Validate(); err != nil {
		return Notify{}, err
	}
	return out, nil
}

// Validate checks a configured channel without echoing a webhook URL.
func (n Notify) Validate() error {
	if n.MaxAttempts < 1 || n.MaxAttempts > 20 {
		return errors.New("VC_NOTIFY_MAX_ATTEMPTS must be from 1 to 20")
	}
	if strings.TrimSpace(n.SMTPHost) != "" {
		if n.SMTPPort < 1 || n.SMTPPort > 65535 {
			return errors.New("VC_SMTP_PORT is required when VC_SMTP_HOST is set")
		}
		if strings.TrimSpace(n.SMTPFrom) == "" {
			return errors.New("VC_SMTP_FROM is required when VC_SMTP_HOST is set")
		}
	}
	if strings.TrimSpace(n.FeishuWebhookURL) != "" && !feishuWebhookAllowed(n.FeishuWebhookURL) {
		return errors.New("VC_FEISHU_WEBHOOK_URL is not allowed")
	}
	return nil
}

func feishuWebhookAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	switch u.Scheme {
	case "https":
		return true
	case "http":
		return host == "127.0.0.1" || host == "localhost" || host == "::1"
	default:
		return false
	}
}
