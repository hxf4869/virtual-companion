package openai

import (
	"strings"
	"testing"
	"time"
)

func TestValidateRejectsIncompleteAndIllegalConfig(t *testing.T) {
	t.Parallel()
	base := Config{
		Endpoint:          "https://models.example/v1/chat/completions",
		BearerToken:       "offline-token-sentinel",
		Model:             "offline-model-sentinel",
		MaxTokens:         128,
		Temperature:       1,
		ConnectTimeout:    10 * time.Second,
		FirstTokenTimeout: 60 * time.Second,
		TotalTimeout:      240 * time.Second,
		MaxResponseBytes:  256 << 10,
	}
	if err := base.Validate(); err != nil {
		t.Fatal(err)
	}

	bad := base
	bad.Endpoint = "http://models.example/v1/chat/completions"
	if err := bad.Validate(); err == nil || !strings.Contains(err.Error(), "https") {
		t.Fatalf("http endpoint: %v", err)
	}

	bad = base
	bad.Endpoint = "https://127.0.0.1/v1/chat/completions"
	if err := bad.Validate(); err != nil {
		t.Fatalf("https loopback should be allowed: %v", err)
	}

	bad = base
	bad.Endpoint = "http://127.0.0.1/v1/chat/completions"
	if err := bad.Validate(); err == nil {
		t.Fatal("http loopback requires AllowLoopbackHTTP")
	}
	bad.AllowLoopbackHTTP = true
	if err := bad.Validate(); err != nil {
		t.Fatal(err)
	}

	bad = base
	bad.Endpoint = "https://10.0.0.1/v1/chat/completions"
	if err := bad.Validate(); err == nil {
		t.Fatal("private IP must be rejected")
	}

	bad = base
	bad.Endpoint = "https://models.example/v1/chat/completions?x=1"
	if err := bad.Validate(); err == nil {
		t.Fatal("query must be rejected")
	}

	bad = base
	bad.Endpoint = "https://user:pass@models.example/v1/chat/completions"
	if err := bad.Validate(); err == nil {
		t.Fatal("userinfo must be rejected")
	}

	bad = base
	bad.MaxResponseBytes = -1
	if err := bad.Validate(); err == nil {
		t.Fatal("negative maxResponseBytes must fail")
	}
	bad = base
	bad.MaxResponseBytes = hardMaxResponseBytes + 1
	if err := bad.Validate(); err == nil {
		t.Fatal("over-cap maxResponseBytes must fail")
	}

	bad = base
	bad.BearerToken = "token\n"
	err := bad.Validate()
	if err == nil {
		t.Fatal("control character in credential must fail")
	}
	if strings.Contains(err.Error(), "token\n") || strings.Contains(err.Error(), "offline-token") {
		t.Fatalf("credential leaked: %v", err)
	}
}

func TestNewAllowsLoopbackHTTPOnlyWhenOptedIn(t *testing.T) {
	t.Parallel()
	_, err := New(Config{
		Endpoint:          "http://127.0.0.1:9/v1/chat/completions",
		BearerToken:       "offline-token-sentinel",
		Model:             "offline-model-sentinel",
		AllowLoopbackHTTP: true,
	})
	if err != nil {
		t.Fatal(err)
	}
}
