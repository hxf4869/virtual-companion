package voice

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureWAV() []byte {
	b := make([]byte, 48044)
	copy(b, "RIFF")
	binary.LittleEndian.PutUint32(b[4:], uint32(len(b)-8))
	copy(b[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(b[16:], 16)
	binary.LittleEndian.PutUint16(b[20:], 1)
	binary.LittleEndian.PutUint16(b[22:], 1)
	binary.LittleEndian.PutUint32(b[24:], 24000)
	binary.LittleEndian.PutUint32(b[28:], 48000)
	binary.LittleEndian.PutUint16(b[32:], 2)
	binary.LittleEndian.PutUint16(b[34:], 16)
	copy(b[36:], "data")
	binary.LittleEndian.PutUint32(b[40:], 48000)
	return b
}

func TestHTTPClientEngineProtocols(t *testing.T) {
	for _, engine := range []string{Kokoro, CosyVoice} {
		t.Run(engine, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet {
					want := "/v1/voices"
					if engine == CosyVoice {
						want = "/healthz"
					}
					if r.URL.Path != want {
						t.Errorf("metadata path %s", r.URL.Path)
					}
					_, _ = w.Write([]byte(`{"voices":["zf_001","zm_010","default"]}`))
					return
				}
				calls.Add(1)
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("invalid request JSON")
				}
				if r.URL.Path != "/v1/audio/speech" || body["input"] != "synthetic input" || body["voice"] != "zf_001" {
					t.Error("speech protocol mismatch")
				}
				if engine == Kokoro {
					if body["response_format"] != "wav" || body["speed"] != float64(1) {
						t.Error("Kokoro output or speed mismatch")
					}
					if body["model"] != "kokoro-zh-v1.1" {
						t.Error("Kokoro model alias mismatch")
					}
					if _, ok := body["instructions"]; ok {
						t.Error("Kokoro received instructions")
					}
					if _, ok := body["seed"]; ok {
						t.Error("Kokoro received seed")
					}
				} else if body["model"] != "cosyvoice3-q8" || body["stream"] != false || body["instructions"] != "You are a helpful assistant." || body["seed"] != float64(7) {
					t.Error("CosyVoice protocol mismatch")
				}
				w.Header().Set("Content-Type", "audio/wav")
				_, _ = w.Write(fixtureWAV())
			}))
			defer srv.Close()
			client, err := NewHTTPClient(engine, srv.URL+"/v1")
			if err != nil {
				t.Fatal(err)
			}
			voices, err := client.Voices(context.Background())
			if err != nil || len(voices) != 3 {
				t.Fatalf("voices %d err %v", len(voices), err)
			}
			if engine == Kokoro && (voices[0].Gender != "FEMALE" || voices[1].Gender != "MALE") {
				t.Fatal("gender mapping")
			}
			seed := int64(7)
			data, err := client.Synthesize(context.Background(), "synthetic input", "zf_001", Params{Speed: 1, Instructions: "You are a helpful assistant.", Seed: &seed})
			if err != nil || calls.Load() != 1 {
				t.Fatalf("synthesis calls %d err %v", calls.Load(), err)
			}
			if duration, err := WAVDuration(data); err != nil || duration != 1000 {
				t.Fatalf("duration %d err %v", duration, err)
			}
		})
	}
}

func TestHTTPClientFailuresAreBoundedAndBodyFree(t *testing.T) {
	const private = "PRIVATE_VOICE_PAYLOAD"
	for _, tc := range []struct {
		name   string
		status int
		kind   string
	}{
		{"400", 400, "bad_request"}, {"429", 429, "rate_limited"}, {"500", 500, "upstream_error"}, {"redirect", 307, "upstream_error"}, {"timeout", 0, "timeout"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if tc.status == 0 {
					_, _ = io.Copy(io.Discard, r.Body)
					<-r.Context().Done()
					return
				}
				w.Header().Set("Retry-After", "99999")
				w.Header().Set("Location", "http://example.invalid/private")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(private))
			}))
			defer srv.Close()
			client, _ := NewHTTPClient(Kokoro, srv.URL+"/v1")
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
			defer cancel()
			_, err := client.Synthesize(ctx, private, "zf_001", Params{Speed: 1})
			var failure *EngineError
			if !errors.As(err, &failure) || failure.Kind != tc.kind || calls.Load() != 1 {
				t.Fatalf("calls %d error %v", calls.Load(), err)
			}
			if strings.Contains(err.Error(), private) || strings.Contains(err.Error(), srv.URL) {
				t.Fatal("private error material escaped")
			}
			if tc.status == 429 && failure.RetryAfter != time.Minute {
				t.Fatal("unbounded retry-after")
			}
		})
	}
}

func TestWAVAndURLValidation(t *testing.T) {
	valid := fixtureWAV()
	for _, change := range []func([]byte){func(b []byte) { b[0] = 0 }, func(b []byte) { binary.LittleEndian.PutUint32(b[24:], 16000) }, func(b []byte) { binary.LittleEndian.PutUint32(b[40:], 99999999) }} {
		b := append([]byte(nil), valid...)
		change(b)
		if _, err := WAVDuration(b); err == nil {
			t.Fatal("malformed engine WAV accepted")
		}
	}
	for _, base := range []string{"https://example.invalid/v1?secret=value", "http://user:pass@example.invalid/v1", "file:///tmp/v1", "http://example.invalid/audio/speech"} {
		if _, err := NewHTTPClient(Kokoro, base); err == nil {
			t.Fatal("invalid endpoint accepted")
		}
	}
}
