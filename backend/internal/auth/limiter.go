package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

const (
	defaultSourceLimit   = 10
	defaultAccountLimit  = 5
	defaultSourceWindow  = time.Minute
	defaultAccountWindow = 15 * time.Minute
	defaultMaxKeys       = 4096
	defaultMaxInFlight   = 4
	defaultKeyTTL        = 30 * time.Minute
	minRetryAfter        = time.Second
)

// Limiter is a single-process bounded sliding window for login/password/reauth.
// Keys are HMAC digests so raw IPs and usernames are not stored.
type Limiter struct {
	mu        sync.Mutex
	hmacKey   []byte
	sources   map[string]*bucket
	accounts  map[string]*bucket
	inFlight  int
	maxFlight int
	now       func() time.Time
}

type bucket struct {
	hits []time.Time
	last time.Time
}

func NewLimiter() *Limiter {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		key = make([]byte, 32)
	}
	return &Limiter{
		hmacKey:   key,
		sources:   map[string]*bucket{},
		accounts:  map[string]*bucket{},
		maxFlight: defaultMaxInFlight,
		now:       time.Now,
	}
}

// Allow records one attempt. ok is false when the caller must wait retry.
// kind is a small enum (login, password, reauth). source and account are raw
// and hashed before retention.
func (l *Limiter) Allow(kind, source, account string) (retry time.Duration, ok bool) {
	if l == nil {
		return 0, true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.gc(now)
	if l.inFlight >= l.maxFlight {
		return time.Duration(l.maxFlight) * time.Second, false
	}
	sk := l.digest("s", kind, source)
	ak := l.digest("a", kind, account)
	if retry, ok = l.hit(l.sources, sk, now, defaultSourceLimit, defaultSourceWindow); !ok {
		return retry, false
	}
	if retry, ok = l.hit(l.accounts, ak, now, defaultAccountLimit, defaultAccountWindow); !ok {
		return retry, false
	}
	return 0, true
}

func (l *Limiter) Enter() (retry time.Duration, ok bool) {
	if l == nil {
		return 0, true
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inFlight >= l.maxFlight {
		return time.Second, false
	}
	l.inFlight++
	return 0, true
}

func (l *Limiter) Leave() {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.inFlight > 0 {
		l.inFlight--
	}
}

func (l *Limiter) hit(m map[string]*bucket, key string, now time.Time, limit int, window time.Duration) (time.Duration, bool) {
	b := m[key]
	if b == nil {
		if len(m) >= defaultMaxKeys {
			return time.Minute, false
		}
		b = &bucket{}
		m[key] = b
	}
	cutoff := now.Add(-window)
	kept := b.hits[:0]
	for _, t := range b.hits {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	b.hits = kept
	if len(b.hits) >= limit {
		retry := b.hits[0].Add(window).Sub(now)
		if retry < minRetryAfter {
			retry = minRetryAfter
		}
		return retry, false
	}
	b.hits = append(b.hits, now)
	b.last = now
	return 0, true
}

func (l *Limiter) gc(now time.Time) {
	cutoff := now.Add(-defaultKeyTTL)
	for k, b := range l.sources {
		if b.last.Before(cutoff) {
			delete(l.sources, k)
		}
	}
	for k, b := range l.accounts {
		if b.last.Before(cutoff) {
			delete(l.accounts, k)
		}
	}
}

func (l *Limiter) digest(part, kind, raw string) string {
	mac := hmac.New(sha256.New, l.hmacKey)
	_, _ = mac.Write([]byte(part))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(kind))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(raw))
	return hex.EncodeToString(mac.Sum(nil))
}
