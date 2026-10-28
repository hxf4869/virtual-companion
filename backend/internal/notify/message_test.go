package notify

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestFeishuSignKnownVector(t *testing.T) {
	got := FeishuSign("1599360473", "demo-secret")
	const want = "3/MaVZ8JLIy4TUG+7KSFJqvUkTKd+HWY8g+56DZWq8s="
	if got != want {
		t.Fatalf("sign = %s", got)
	}
}

func TestComposePreviewDefaultsOff(t *testing.T) {
	body := "w10 greeting text"
	msg := Compose("EMAIL", "BODY", &body, false)
	if msg.Subject != Title {
		t.Fatalf("subject = %s", msg.Subject)
	}
	if strings.Contains(msg.Text, body) {
		t.Fatal("preview off still included the greeting")
	}
	if !strings.Contains(msg.Text, Title) || !strings.Contains(msg.Text, LoginHint) {
		t.Fatalf("generic text = %s", msg.Text)
	}
	if strings.Contains(msg.Text, GroupVisible) {
		t.Fatal("email text included the group warning")
	}
}

func TestComposePreviewAndFeishuVisibility(t *testing.T) {
	body := "w10 greeting text"
	msg := Compose("FEISHU", "BODY", &body, true)
	if msg.Subject != Title {
		t.Fatalf("subject = %s", msg.Subject)
	}
	if !strings.Contains(msg.Text, body) || !strings.Contains(msg.Text, GroupVisible) || !strings.Contains(msg.Text, LoginHint) {
		t.Fatalf("feishu preview = %s", msg.Text)
	}
}

func TestComposeWaitingHostIgnoresBody(t *testing.T) {
	body := "w10 greeting text"
	msg := Compose("FEISHU", "WAITING_HOST", &body, true)
	if !strings.Contains(msg.Text, WaitingHost) {
		t.Fatalf("text = %s", msg.Text)
	}
	if strings.Contains(msg.Text, body) {
		t.Fatal("waiting host included the greeting")
	}
	if !strings.Contains(msg.Text, GroupVisible) {
		t.Fatal("feishu waiting host omitted the group warning")
	}
}

func TestCorrelationAndBackoff(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	id := Correlation("n", 42, now)
	if !regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`).MatchString(id) {
		t.Fatalf("correlation %s", id)
	}
	if Backoff(1) != time.Minute || Backoff(2) != 2*time.Minute || Backoff(3) != 4*time.Minute {
		t.Fatalf("backoff = %s %s %s", Backoff(1), Backoff(2), Backoff(3))
	}
	if Backoff(8) != 30*time.Minute {
		t.Fatalf("capped backoff = %s", Backoff(8))
	}
}
