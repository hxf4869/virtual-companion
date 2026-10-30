package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type testStore struct {
	Store
	settings   Settings
	rel        Relationship
	saved      Clip
	existing   *Clip
	completion Completion
	accept     bool
	claims     atomic.Int32
	claimed    chan struct{}
}

func (s *testStore) GetVoiceSettings(context.Context, int64) (Settings, error) {
	return s.settings, nil
}
func (s *testStore) GetVoiceRelationship(context.Context, int64, int64) (Relationship, error) {
	return s.rel, nil
}
func (s *testStore) EnqueueVoiceClip(_ context.Context, c Clip) (Clip, error) {
	c.ID = 1
	c.Status = "queued"
	s.saved = c
	return c, nil
}
func (s *testStore) FindVoiceClip(context.Context, int64, int64, string, string) (Clip, error) {
	if s.existing != nil {
		return *s.existing, nil
	}
	return Clip{}, ErrNotFound
}
func (s *testStore) CompleteVoiceClip(_ context.Context, _ Clip, c Completion) (bool, error) {
	s.completion = c
	return s.accept, nil
}
func (s *testStore) ClaimVoiceClip(context.Context, string) (Clip, error) {
	s.claims.Add(1)
	if s.claimed != nil {
		s.claimed <- struct{}{}
	}
	return Clip{}, ErrNotFound
}
func (s *testStore) ListVoiceCleanup(context.Context) ([]CleanupObject, error) { return nil, nil }
func (s *testStore) ExpireVoiceClips(context.Context) error                    { return nil }

type testEngine struct {
	onlyDefault bool
	failure     error
	calls       int
	metadata    int
	data        []byte
}

func (e *testEngine) Voices(context.Context) ([]VoiceOption, error) {
	e.metadata++
	if e.onlyDefault {
		return []VoiceOption{{ID: "default", Name: "fixture", Gender: "NEUTRAL"}}, nil
	}
	return []VoiceOption{{ID: "zf_001", Name: "fixture", Gender: "FEMALE"}, {ID: "zm_010", Name: "fixture", Gender: "MALE"}, {ID: "default", Name: "fixture", Gender: "NEUTRAL"}}, nil
}
func (e *testEngine) Synthesize(context.Context, string, string, Params) ([]byte, error) {
	e.calls++
	return e.data, e.failure
}

type testBlobs struct {
	puts, deletes int
	failure       bool
}

func (b *testBlobs) Put(context.Context, string, []byte) (int64, error) {
	b.puts++
	if b.failure {
		return 0, errors.New("PRIVATE_OBJECT_ERROR")
	}
	return 1, nil
}
func (b *testBlobs) Get(context.Context, string) ([]byte, error) { return fixtureWAV(), nil }
func (b *testBlobs) Delete(context.Context, string) error        { b.deletes++; return nil }

func TestServiceDefaultsRoutingCacheAndIdempotency(t *testing.T) {
	store := &testStore{settings: DefaultSettings(), rel: Relationship{ID: 2, Gender: "MALE", RelationshipPrefs: RelationshipPrefs{Speed: 1, ProactiveVoice: true}, Mood: "开心"}}
	koko, cosy := &testEngine{}, &testEngine{onlyDefault: true}
	s := New(map[string]Engine{Kokoro: koko, CosyVoice: cosy}, nil, nil, "", nil)
	s.BindStore(store)
	for n := 0; n < 2; n++ {
		if _, err := s.Engines(context.Background(), 1); err != nil {
			t.Fatal(err)
		}
	}
	if koko.metadata != 1 || cosy.metadata != 1 {
		t.Fatal("ten minute metadata cache was bypassed")
	}
	in := CreateRequest{MessageRef: "synthetic", Purpose: "chat", Text: "synthetic text"}
	clip, err := s.Create(context.Background(), 1, 2, in)
	if err != nil || clip.Engine != Kokoro || clip.Voice != "zm_010" || clip.Params.Speed != 1.05 || clip.Params.Instructions != "" {
		t.Fatalf("male chat routing err %v", err)
	}
	in.Purpose = "proactive"
	clip, err = s.Create(context.Background(), 1, 2, in)
	if err != nil || clip.Engine != Kokoro || clip.Voice != "zm_010" {
		t.Fatalf("male fallback err %v", err)
	}
	store.rel.Gender = "FEMALE"
	clip, err = s.Create(context.Background(), 1, 2, in)
	if err != nil || clip.Engine != CosyVoice || clip.Params.Instructions != "You are a helpful assistant." {
		t.Fatalf("proactive routing err %v", err)
	}
	store.existing = &clip
	store.settings.CosyVoiceEnabled = false
	s.engines = map[string]Engine{}
	repeated, err := s.Create(context.Background(), 1, 2, in)
	if err != nil || repeated.ID != clip.ID {
		t.Fatal("idempotent retry depended on engine availability")
	}
}

func TestWorkerRetriesOnly429AndFallsBackWithoutPrivateLogs(t *testing.T) {
	for _, kind := range []string{"bad_request", "rate_limited", "upstream_error", "timeout", "unavailable", "ready", "storage_error", "stale", "invalid_wav"} {
		t.Run(kind, func(t *testing.T) {
			var logs bytes.Buffer
			store := &testStore{settings: DefaultSettings(), accept: kind != "stale"}
			engine := &testEngine{data: fixtureWAV()}
			if kind == "invalid_wav" {
				engine.data = []byte("invalid fixture WAV")
			}
			if kind != "ready" && kind != "storage_error" && kind != "stale" && kind != "invalid_wav" {
				engine.failure = &EngineError{Kind: kind}
				engine.data = nil
			}
			blobs := &testBlobs{failure: kind == "storage_error"}
			s := New(map[string]Engine{Kokoro: engine}, blobs, slog.New(slog.NewJSONHandler(&logs, nil)), "", nil)
			s.BindStore(store)
			at := time.Now()
			clip := Clip{OwnerID: 991234, ID: 2, Engine: Kokoro, Voice: "zf_001", Text: "PRIVATE_VOICE_PAYLOAD", ObjectKey: "PRIVATE_OBJECT_KEY", StartedAt: &at, Params: Params{Speed: 1, TimeoutSeconds: 1}}
			s.process(context.Background(), clip)
			switch kind {
			case "invalid_wav":
				if store.completion.Status != "failed" || store.completion.ErrorKind != "upstream_error" || blobs.puts != 0 {
					t.Fatal("invalid engine WAV reached object storage")
				}
			case "ready", "stale":
				if store.completion.Status != "ready" {
					t.Fatal("ready audio not published")
				}
			case "rate_limited":
				if store.completion.Status != "queued" || store.completion.RetryAfter != time.Second {
					t.Fatal("429 was not queued")
				}
				for retry := 1; retry <= 3; retry++ {
					clip.RetryCount = retry
					s.process(context.Background(), clip)
				}
				if engine.calls != 4 || store.completion.Status != "failed" || store.completion.ErrorKind != "rate_limited" {
					t.Fatal("429 retries were not bounded to three")
				}
			default:
				if store.completion.Status != "failed" || store.completion.ErrorKind != kind || engine.calls != 1 {
					t.Fatal("non-429 failure retried or lost text fallback state")
				}
			}
			if kind == "stale" && blobs.deletes != 1 {
				t.Fatal("stale writer left uploaded audio")
			}
			for _, private := range []string{"PRIVATE_VOICE_PAYLOAD", "PRIVATE_OBJECT_KEY", "PRIVATE_OBJECT_ERROR", "991234"} {
				if strings.Contains(logs.String(), private) {
					t.Fatal("voice log contained private material")
				}
			}
		})
	}
}

func TestSettingsAndRelationshipPatchValidation(t *testing.T) {
	settings := DefaultSettings()
	in := SettingsWrite{SettingsValues: settings.SettingsValues}
	if err := in.Validate(); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(in)
	var fields map[string]any
	_ = json.Unmarshal(body, &fields)
	delete(fields, "kokoroEnabled")
	missing, _ := json.Marshal(fields)
	var decoded SettingsWrite
	if json.Unmarshal(missing, &decoded) == nil {
		t.Fatal("missing boolean accepted")
	}
	fields["kokoroEnabled"] = nil
	null, _ := json.Marshal(fields)
	if json.Unmarshal(null, &decoded) == nil {
		t.Fatal("null boolean accepted")
	}
	in.KokoroTimeoutSeconds = 3601
	if in.Validate() == nil {
		t.Fatal("unbounded worker lease accepted")
	}
	a, b := DefaultSettings(), DefaultSettings()
	a.KokoroMoodSpeeds["开心"] = 2
	if b.KokoroMoodSpeeds["开心"] != 1.05 {
		t.Fatal("defaults shared mutable maps")
	}
	s := New(nil, nil, nil, "", nil)
	for _, patch := range []map[string]json.RawMessage{{"speed": json.RawMessage(`null`)}, {"speed": json.RawMessage(`0.1`)}, {"proactiveVoice": json.RawMessage(`null`)}, {"voiceFrequency": json.RawMessage(`"wrong"`)}} {
		if s.ValidateRelationshipPatch(context.Background(), patch) == nil {
			t.Fatal("invalid patch accepted")
		}
	}
	if s.ValidateRelationshipPatch(context.Background(), map[string]json.RawMessage{"kokoroVoice": json.RawMessage(`null`), "voiceFrequency": json.RawMessage(`null`)}) != nil {
		t.Fatal("null inheritance rejected")
	}
}

func TestRestoreGateAndWorkerShutdown(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restore-gate.json")
	if err := os.WriteFile(path, []byte(`{"blocked":true}`), 0600); err != nil {
		t.Fatal(err)
	}
	store := &testStore{}
	s := New(nil, nil, nil, path, nil)
	s.BindStore(store)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := s.Get(ctx, 1, 1); !errors.Is(err, ErrUnavailable) {
		t.Fatal("voice transcript crossed closed restore gate")
	}
	if _, err := s.Create(ctx, 1, 2, CreateRequest{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("voice enqueue crossed closed restore gate")
	}
	if _, err := s.Preview(ctx, 1, PreviewRequest{}); !errors.Is(err, ErrUnavailable) {
		t.Fatal("voice preview crossed closed restore gate")
	}
	s.Run(ctx)
	if store.claims.Load() != 0 {
		t.Fatal("voice work crossed closed restore gate")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	store.claimed = make(chan struct{}, 2)
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()
	done := make(chan struct{})
	go func() { s.Run(ctx2); close(done) }()
	for range 2 {
		select {
		case <-store.claimed:
		case <-time.After(time.Second):
			t.Fatal("voice workers did not start")
		}
	}
	cancel2()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("voice workers did not stop")
	}
	if store.claims.Load() != 2 {
		t.Fatal("both engine workers did not resume")
	}
}
