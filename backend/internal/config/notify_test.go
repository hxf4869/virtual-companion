package config

import (
	"strings"
	"testing"
)

func TestLoadNotifyAbsentIsOff(t *testing.T) {
	got, err := LoadNotify(func(string) string { return "" })
	if err != nil {
		t.Fatal(err)
	}
	if got.MaxAttempts != 5 || got.SMTPHost != "" || got.FeishuWebhookURL != "" {
		t.Fatalf("notify = %+v", got)
	}
}

func TestLoadNotifyRejectsPartialSMTPAndExternalHTTP(t *testing.T) {
	_, err := LoadNotify(func(key string) string {
		if key == "VC_SMTP_HOST" {
			return "127.0.0.1"
		}
		return ""
	})
	if err == nil || !strings.Contains(err.Error(), "VC_SMTP_PORT") {
		t.Fatalf("host without port: %v", err)
	}
	_, err = LoadNotify(func(key string) string {
		switch key {
		case "VC_SMTP_HOST":
			return "127.0.0.1"
		case "VC_SMTP_PORT":
			return "2525"
		default:
			return ""
		}
	})
	if err == nil || !strings.Contains(err.Error(), "VC_SMTP_FROM") {
		t.Fatalf("host without from: %v", err)
	}
	const secretURL = "http://evil.example/hook-secret"
	_, err = LoadNotify(func(key string) string {
		if key == "VC_FEISHU_WEBHOOK_URL" {
			return secretURL
		}
		return ""
	})
	if err == nil {
		t.Fatal("external http webhook was accepted")
	}
	if strings.Contains(err.Error(), "evil.example") || strings.Contains(err.Error(), "hook-secret") {
		t.Fatalf("error echoed the webhook: %v", err)
	}
}

func TestLoadNotifyAllowsLoopbackAndHTTPS(t *testing.T) {
	got, err := LoadNotify(func(key string) string {
		switch key {
		case "VC_SMTP_HOST":
			return "127.0.0.1"
		case "VC_SMTP_PORT":
			return "2525"
		case "VC_SMTP_FROM":
			return "notify@example.test"
		case "VC_FEISHU_WEBHOOK_URL":
			return "http://127.0.0.1:9/hook"
		case "VC_FEISHU_SIGN_SECRET":
			return "demo-secret"
		case "VC_NOTIFY_MAX_ATTEMPTS":
			return "5"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.SMTPPort != 2525 || got.MaxAttempts != 5 || got.FeishuSignSecret != "demo-secret" {
		t.Fatalf("notify = %+v", got)
	}
	if _, err := LoadNotify(func(key string) string {
		if key == "VC_FEISHU_WEBHOOK_URL" {
			return "https://open.example.test/hook"
		}
		return ""
	}); err != nil {
		t.Fatal(err)
	}
}
