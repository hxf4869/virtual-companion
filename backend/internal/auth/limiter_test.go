package auth

import (
	"testing"
	"time"
)

func TestLimiterAllowsThenBlocksSource(t *testing.T) {
	t.Parallel()
	l := NewLimiter()
	now := time.Now()
	l.now = func() time.Time { return now }
	for i := 0; i < defaultSourceLimit; i++ {
		account := "user-" + string(rune('a'+i))
		if _, ok := l.Allow("login", "127.0.0.1", account); !ok {
			t.Fatalf("allow %d", i)
		}
	}
	retry, ok := l.Allow("login", "127.0.0.1", "other")
	if ok {
		t.Fatal("must block")
	}
	if retry < time.Second {
		t.Fatalf("retry %s", retry)
	}
	if _, ok := l.Allow("login", "10.0.0.2", "bob"); !ok {
		t.Fatal("other source")
	}
}

func TestLimiterInFlightCap(t *testing.T) {
	t.Parallel()
	l := NewLimiter()
	l.maxFlight = 1
	if _, ok := l.Enter(); !ok {
		t.Fatal("first")
	}
	if _, ok := l.Enter(); ok {
		t.Fatal("second")
	}
	l.Leave()
	if _, ok := l.Enter(); !ok {
		t.Fatal("after leave")
	}
}
