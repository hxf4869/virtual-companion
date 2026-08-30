package companion

import (
	"testing"
	"time"
)

func TestRetryOnlyForUnsentConnectTimeout(t *testing.T) {
	t.Parallel()
	b := TurnBudget{MaxAttempts: 2, MaxOutputTokens: 16, ConnectTimeout: time.Second}
	if !AllowNewAttempt(b, 1, AttemptTimedOut, Timeout(TimeoutConnect, DeliveryNotSent)) {
		t.Fatal("unsent connect may retry once")
	}
	if AllowNewAttempt(b, 2, AttemptTimedOut, Timeout(TimeoutConnect, DeliveryNotSent)) {
		t.Fatal("must not exceed maxAttempts")
	}
}

func TestRetryDeniedForSafetyCancelUnknownAndTotalTimeout(t *testing.T) {
	t.Parallel()
	b := TurnBudget{MaxAttempts: 2}
	cases := []error{
		InvalidRequest(),
		Canceled(DeliveryUnknown),
		RateLimited(),
		Timeout(TimeoutTotal, DeliveryUnknown),
		Timeout(TimeoutConnect, DeliveryUnknown),
		Disconnected(DeliveryUnknown),
		UpstreamUnavailable(),
	}
	for _, err := range cases {
		status, _ := ClassifyAttempt(err)
		if AllowNewAttempt(b, 1, status, err) {
			t.Fatalf("must not retry %v status=%s", err, status)
		}
	}
	if AllowNewAttempt(b, 1, AttemptSucceeded, nil) {
		t.Fatal("success")
	}
	if AllowNewAttempt(b, 1, AttemptOutcomeUnknown, Disconnected(DeliveryUnknown)) {
		t.Fatal("outcome unknown")
	}
}
