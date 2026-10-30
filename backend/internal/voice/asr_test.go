package voice

import (
	"context"
	"encoding/binary"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func inputWAV() []byte {
	data := fixtureWAV()
	binary.LittleEndian.PutUint32(data[24:28], 16000)
	binary.LittleEndian.PutUint32(data[28:32], 32000)
	return data
}

type testASR struct {
	ASREngine
	started chan struct{}
	finish  chan struct{}
	calls   atomic.Int32
}

func (a *testASR) Healthy(context.Context) bool { return true }
func (a *testASR) Transcribe(ctx context.Context, _ []byte) (Transcription, error) {
	a.calls.Add(1)
	close(a.started)
	select {
	case <-a.finish:
		return Transcription{Text: "synthetic", Emotion: "HAPPY"}, nil
	case <-ctx.Done():
		return Transcription{}, ctx.Err()
	}
}

func TestASRAndTTSTogetherHaveTwoSlots(t *testing.T) {
	s := New(nil, nil, nil, "", nil)
	if err := s.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := s.acquire(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("third engine exceeded two slots")
	}
	s.release()
	s.release()
}
func TestASRBoundedInputAndSingleConcurrency(t *testing.T) {
	asr := &testASR{started: make(chan struct{}), finish: make(chan struct{})}
	s := New(nil, nil, nil, "", asr)
	store := &testStore{settings: DefaultSettings()}
	s.BindStore(store)
	if _, err := s.Transcribe(context.Background(), 1, fixtureWAV()); err != ErrInvalid {
		t.Fatal("24k recording accepted")
	}
	done := make(chan error, 1)
	go func() { _, err := s.Transcribe(context.Background(), 1, inputWAV()); done <- err }()
	<-asr.started
	if _, err := s.Transcribe(context.Background(), 1, inputWAV()); err != ErrRateLimited {
		t.Fatal("ASR concurrency exceeded")
	}
	close(asr.finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	store.settings.MaxRecordingSeconds = 1
	if _, err := s.Transcribe(context.Background(), 1, inputWAV()); err != ErrInvalid {
		t.Fatal("recording duration ignored")
	}
	if asr.calls.Load() != 1 {
		t.Fatal("invalid audio reached engine")
	}
}

func TestASRHTTPMultipartAndResultSanitization(t *testing.T) {
	var calls int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Error("wrong ASR endpoint")
		}
		if err := r.ParseMultipartForm(MaxRecordingBytes); err != nil {
			t.Error(err)
		}
		if len(r.MultipartForm.File["file"]) != 1 {
			t.Error("missing WAV file")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":" synthetic ","emotion":"UNTRUSTED_INSTRUCTION","language":"zh"}`))
	}))
	defer server.Close()
	client, err := NewHTTPClient("asr", server.URL+"/v1")
	if err != nil {
		t.Fatal(err)
	}
	result, err := client.Transcribe(context.Background(), inputWAV())
	if err != nil || result.Text != "synthetic" || result.Emotion != "" || result.Language != "zh" || calls != 1 {
		t.Fatal("ASR result contract", err)
	}
}
