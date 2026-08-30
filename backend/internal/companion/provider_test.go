package companion

import (
	"strings"
	"testing"
)

func TestErrorMessagesAreBodyFree(t *testing.T) {
	t.Parallel()
	secret := "sk-live-must-never-appear"
	body := "provider-response-body"
	cases := []error{
		InvalidRequest(),
		RateLimited(),
		UpstreamUnavailable(),
		Timeout(TimeoutConnect, DeliveryNotSent),
		Timeout(TimeoutFirstToken, DeliveryUnknown),
		Timeout(TimeoutTotal, DeliveryUnknown),
		Malformed(DeliveryReceived),
		Disconnected(DeliveryUnknown),
		Canceled(DeliveryUnknown),
	}
	for _, err := range cases {
		msg := err.Error()
		if !strings.HasPrefix(msg, "provider: ") {
			t.Fatalf("error %q should start with provider:", msg)
		}
		if strings.Contains(msg, secret) || strings.Contains(msg, body) {
			t.Fatalf("secret leaked in %q", msg)
		}
		if strings.Contains(strings.ToLower(msg), "bearer") {
			t.Fatalf("credential wording in %q", msg)
		}
	}
}

func TestAsErrorAndIs(t *testing.T) {
	t.Parallel()
	err := Timeout(TimeoutConnect, DeliveryNotSent)
	pe := AsError(err)
	if pe == nil || pe.Code != CodeTimeout || pe.Phase != TimeoutConnect {
		t.Fatalf("AsError %+v", pe)
	}
	if !Is(err, CodeTimeout) || Is(err, CodeMalformed) {
		t.Fatal("Is mismatch")
	}
	if AsError(nil) != nil || Is(nil, CodeTimeout) {
		t.Fatal("nil must not match")
	}
}
