package voice

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/restoregate"
)

type cachedVoices struct {
	voices  []VoiceOption
	healthy bool
	until   time.Time
}

type Service struct {
	store   Store
	blobs   BlobStore
	engines map[string]Engine
	asr     ASREngine
	asrBusy chan struct{}
	slots   chan struct{}
	log     *slog.Logger
	gate    string
	cacheMu sync.Mutex
	cache   map[string]cachedVoices
}

func New(engines map[string]Engine, blobs BlobStore, log *slog.Logger, gate string, asr ASREngine) *Service {
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Service{engines: engines, blobs: blobs, log: log, gate: gate, asr: asr, asrBusy: make(chan struct{}, 1), slots: make(chan struct{}, 2), cache: map[string]cachedVoices{}}
}

func (s *Service) BindStore(store Store) { s.store = store }

func (s *Service) Settings(ctx context.Context, owner int64) (Settings, error) {
	return s.store.GetVoiceSettings(ctx, owner)
}
func (s *Service) SaveSettings(ctx context.Context, owner int64, in SettingsWrite) (Settings, error) {
	if err := in.Validate(); err != nil {
		return Settings{}, err
	}
	return s.store.SaveVoiceSettings(ctx, owner, in)
}

func (s *Service) voices(ctx context.Context, engine string) cachedVoices {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	if cached, ok := s.cache[engine]; ok && time.Now().Before(cached.until) {
		return cached
	}
	out := cachedVoices{voices: []VoiceOption{}, until: time.Now().Add(10 * time.Minute)}
	if client := s.engines[engine]; client != nil {
		voices, err := client.Voices(ctx)
		if err == nil {
			out.voices = voices
			out.healthy = true
		}
	}
	if ctx.Err() != nil {
		return out
	}
	s.cache[engine] = out
	return out
}

func (s *Service) Engines(ctx context.Context, owner int64) (Engines, error) {
	settings, err := s.Settings(ctx, owner)
	if err != nil {
		return Engines{}, err
	}
	out := Engines{TTS: make([]EngineState, 0, 2), ASR: CapabilityState{Configured: s.asr != nil, Enabled: s.asr != nil && settings.ASREnabled}}
	for _, engine := range []string{Kokoro, CosyVoice} {
		cached := s.voices(ctx, engine)
		enabled := settings.KokoroEnabled
		if engine == CosyVoice {
			enabled = settings.CosyVoiceEnabled
		}
		out.TTS = append(out.TTS, EngineState{Engine: engine, Configured: s.engines[engine] != nil, Enabled: s.engines[engine] != nil && enabled, Healthy: cached.healthy, Voices: cached.voices})
	}
	if s.asr != nil {
		out.ASR.Healthy = s.asr.Healthy(ctx)
	}
	return out, nil
}

func (s *Service) validateVoice(ctx context.Context, engine, id string) error {
	if !validVoiceID(id) {
		return ErrInvalid
	}
	state := s.voices(ctx, engine)
	if s.engines[engine] == nil || !state.healthy {
		return ErrUnavailable
	}
	for _, option := range state.voices {
		if option.ID == id {
			return nil
		}
	}
	return ErrInvalid
}

// ValidateRelationshipPatch retains JSON null and omission as distinct
// operations. The store applies these five keys in the preferences transaction.
func (s *Service) ValidateRelationshipPatch(ctx context.Context, patch map[string]json.RawMessage) error {
	for key, raw := range patch {
		switch key {
		case "kokoroVoice", "cosyVoice":
			if string(raw) == "null" {
				continue
			}
			var id string
			if json.Unmarshal(raw, &id) != nil {
				return ErrInvalid
			}
			engine := Kokoro
			if key == "cosyVoice" {
				engine = CosyVoice
			}
			if err := s.validateVoice(ctx, engine, id); err != nil {
				return err
			}
		case "voiceFrequency":
			if string(raw) == "null" {
				continue
			}
			var f string
			if json.Unmarshal(raw, &f) != nil || !validFrequency(f, true) {
				return ErrInvalid
			}
		case "speed":
			var speed float64
			if string(raw) == "null" || json.Unmarshal(raw, &speed) != nil || !validSpeed(speed) {
				return ErrInvalid
			}
		case "proactiveEngine":
			if string(raw) != "null" && string(raw) != `"kokoro"` && string(raw) != `"cosyvoice"` {
				return ErrInvalid
			}
		case "proactiveVoice":
			var enabled bool
			if string(raw) == "null" || json.Unmarshal(raw, &enabled) != nil {
				return ErrInvalid
			}
		default:
			return ErrInvalid
		}
	}
	return nil
}

func (s *Service) Create(ctx context.Context, owner, relationshipID int64, in CreateRequest) (Clip, error) {
	return s.create(ctx, owner, relationshipID, in, "default", time.Time{}, time.Time{})
}

func ProactiveScene(trigger string) string {
	switch trigger {
	case "morning", "good_morning":
		return "morning"
	case "night", "good_night":
		return "night"
	case "share", "share_day":
		return "share"
	case "care":
		return trigger
	default:
		return "default"
	}
}

func (s *Service) PrepareProactive(ctx context.Context, owner, relationshipID int64, in CreateRequest, trigger string, sendAt, now time.Time) (Clip, error) {
	return s.create(ctx, owner, relationshipID, in, ProactiveScene(trigger), sendAt, now)
}

func (s *Service) create(ctx context.Context, owner, relationshipID int64, in CreateRequest, scene string, sendAt, now time.Time) (Clip, error) {
	if restoregate.Closed(s.gate) {
		return Clip{}, ErrUnavailable
	}
	if in.Purpose != "chat" && in.Purpose != "proactive" || strings.TrimSpace(in.MessageRef) == "" || utf8.RuneCountInString(in.MessageRef) > 512 || strings.TrimSpace(in.Text) == "" || utf8.RuneCountInString(in.Text) > 4000 {
		return Clip{}, ErrInvalid
	}
	if in.Purpose == "chat" && strings.HasPrefix(in.MessageRef, "stmsg:") {
		ref, err := s.store.ResolveVoiceMessage(ctx, owner, relationshipID, in.MessageRef)
		if err != nil {
			return Clip{}, err
		}
		in.MessageRef = ref
	}
	if CleanText(in.Text) == "" {
		return Clip{}, ErrInvalid
	}
	if existing, err := s.store.FindVoiceClip(ctx, owner, relationshipID, in.Purpose, in.MessageRef); err == nil {
		if existing.Text != in.Text {
			return Clip{}, ErrInvalid
		}
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Clip{}, err
	}
	settings, err := s.Settings(ctx, owner)
	if err != nil {
		return Clip{}, err
	}
	rel, err := s.store.GetVoiceRelationship(ctx, owner, relationshipID)
	if err != nil {
		return Clip{}, err
	}
	if rel.VoiceFrequency != nil && *rel.VoiceFrequency == "OFF" || in.Purpose == "proactive" && !rel.ProactiveVoice {
		return Clip{}, ErrUnavailable
	}
	engine := Kokoro
	voiceID := "zf_001"
	if rel.Gender == "MALE" {
		voiceID = "zm_010"
	}
	if rel.KokoroVoice != nil {
		voiceID = *rel.KokoroVoice
	}
	if in.Purpose == "proactive" {
		engine = CosyVoice
		voiceID = "default"
		if rel.CosyVoice != nil {
			voiceID = *rel.CosyVoice
		} else if rel.Gender == "MALE" {
			voiceID = ""
			for _, v := range s.voices(ctx, CosyVoice).voices {
				if v.Gender == "MALE" {
					voiceID = v.ID
					break
				}
			}
			if voiceID == "" {
				engine = Kokoro
				voiceID = "zm_010"
				if rel.KokoroVoice != nil {
					voiceID = *rel.KokoroVoice
				}
			}
		}
	}
	if in.Purpose == "proactive" {
		if rel.ProactiveEngine != nil && *rel.ProactiveEngine == Kokoro {
			engine, voiceID = Kokoro, "zf_001"
			if rel.Gender == "MALE" {
				voiceID = "zm_010"
			}
			if rel.KokoroVoice != nil {
				voiceID = *rel.KokoroVoice
			}
		}
		if engine == CosyVoice && !sendAt.IsZero() && sendAt.Sub(now) < 5*time.Minute {
			return Clip{}, ErrUnavailable
		}
	}
	params := Params{Speed: rel.Speed, TimeoutSeconds: settings.KokoroTimeoutSeconds}
	if engine == Kokoro {
		if !settings.KokoroEnabled {
			return Clip{}, ErrUnavailable
		}
		if multiplier, ok := settings.KokoroMoodSpeeds[rel.Mood]; ok {
			params.Speed = math.Max(0.5, math.Min(2, params.Speed*multiplier))
		}
	} else {
		if !settings.CosyVoiceEnabled {
			return Clip{}, ErrUnavailable
		}
		params.TimeoutSeconds = settings.CosyVoiceTimeoutSeconds
		params.Instructions = settings.CosyVoiceInstructions[scene]
	}
	if err = s.validateVoice(ctx, engine, voiceID); err != nil {
		return Clip{}, err
	}
	ref := in.MessageRef
	return s.store.EnqueueVoiceClip(ctx, Clip{OwnerID: owner, RelationshipID: relationshipID, MessageRef: &ref, Purpose: in.Purpose, Engine: engine, Voice: voiceID, Text: in.Text, Params: params})
}

func (s *Service) Preview(ctx context.Context, owner int64, in PreviewRequest) (Clip, error) {
	if restoregate.Closed(s.gate) {
		return Clip{}, ErrUnavailable
	}
	if in.RelationshipID <= 0 || in.Engine != Kokoro && in.Engine != CosyVoice {
		return Clip{}, ErrInvalid
	}
	speed := 1.0
	if in.Speed != nil {
		speed = *in.Speed
	}
	if !validSpeed(speed) {
		return Clip{}, ErrInvalid
	}
	settings, err := s.Settings(ctx, owner)
	if err != nil {
		return Clip{}, err
	}
	if _, err = s.store.GetVoiceRelationship(ctx, owner, in.RelationshipID); err != nil {
		return Clip{}, err
	}
	params := Params{Speed: speed, TimeoutSeconds: settings.KokoroTimeoutSeconds}
	if in.Engine == Kokoro && !settings.KokoroEnabled || in.Engine == CosyVoice && !settings.CosyVoiceEnabled {
		return Clip{}, ErrUnavailable
	}
	if in.Engine == CosyVoice {
		params.TimeoutSeconds = settings.CosyVoiceTimeoutSeconds
		params.Instructions = settings.CosyVoiceInstructions["default"]
	}
	if err = s.validateVoice(ctx, in.Engine, in.Voice); err != nil {
		return Clip{}, err
	}
	return s.store.EnqueueVoiceClip(ctx, Clip{OwnerID: owner, RelationshipID: in.RelationshipID, Purpose: "preview", Engine: in.Engine, Voice: in.Voice, Text: PreviewText, Params: params})
}

func (s *Service) Get(ctx context.Context, owner, id int64) (Clip, error) {
	if restoregate.Closed(s.gate) {
		return Clip{}, ErrUnavailable
	}
	return s.store.GetVoiceClip(ctx, owner, id)
}
func (s *Service) Audio(ctx context.Context, clip Clip) ([]byte, error) {
	if s.blobs == nil {
		return nil, ErrUnavailable
	}
	data, err := s.blobs.Get(ctx, clip.ObjectKey)
	if err != nil {
		return nil, ErrUnavailable
	}
	// Storage I/O can outlive a concurrent source or account deletion.
	current, err := s.Get(ctx, clip.OwnerID, clip.ID)
	if err != nil {
		return nil, err
	}
	if current.Status != "ready" || current.ObjectKey != clip.ObjectKey {
		return nil, ErrNotFound
	}
	return data, nil
}

// Run is attached to the existing jobs plane and shares its cancellation and
// restore gate. Each engine has one loop, and PostgreSQL excludes other workers.
func (s *Service) Run(ctx context.Context) {
	var workers sync.WaitGroup
	for _, engine := range []string{Kokoro, CosyVoice} {
		workers.Add(1)
		go func(engine string) { defer workers.Done(); s.runEngine(ctx, engine) }(engine)
	}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if !restoregate.Closed(s.gate) {
			s.cleanup(ctx)
		}
		select {
		case <-ctx.Done():
			workers.Wait()
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) runEngine(ctx context.Context, engine string) {
	for ctx.Err() == nil {
		var clip Clip
		err := ErrNotFound
		if !restoregate.Closed(s.gate) {
			clip, err = s.store.ClaimVoiceClip(ctx, engine)
		}
		if err == nil {
			s.process(ctx, clip)
			continue
		}
		if !errors.Is(err, ErrNotFound) && ctx.Err() == nil {
			s.log.Warn("voice", slog.String("engine", engine), slog.String("status", "failed"), slog.String("error_kind", "storage_error"))
		}
		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Service) process(ctx context.Context, clip Clip) {
	started := time.Now()
	if clip.StartedAt == nil {
		return
	}
	jobCtx, cancel := context.WithDeadline(ctx, clip.StartedAt.Add(time.Duration(clip.Params.TimeoutSeconds)*time.Second+30*time.Second))
	defer cancel()
	if err := s.acquire(jobCtx); err != nil {
		return
	}
	defer s.release()
	completion := Completion{Status: "failed", ErrorKind: "unavailable"}
	var audio []byte
	engine := s.engines[clip.Engine]
	settings, err := s.Settings(jobCtx, clip.OwnerID)
	if err == nil && engine != nil && (clip.Engine == Kokoro && settings.KokoroEnabled || clip.Engine == CosyVoice && settings.CosyVoiceEnabled) {
		callCtx, callCancel := context.WithTimeout(jobCtx, time.Duration(clip.Params.TimeoutSeconds)*time.Second)
		audio, err = engine.Synthesize(callCtx, CleanText(clip.Text), clip.Voice, clip.Params)
		callCancel()
		if err == nil {
			completion.DurationMS, err = WAVDuration(audio)
			if err != nil {
				err = &EngineError{Kind: "upstream_error"}
			}
		}
		if err == nil {
			if s.blobs == nil {
				err = ErrStore
			} else {
				_, err = s.blobs.Put(jobCtx, clip.ObjectKey, audio)
			}
			if err == nil {
				completion.Status = "ready"
				completion.ErrorKind = ""
			} else {
				completion.ErrorKind = "storage_error"
			}
		} else {
			var failure *EngineError
			if errors.As(err, &failure) {
				completion.ErrorKind = failure.Kind
				if failure.Kind == "rate_limited" && clip.RetryCount < 3 && ctx.Err() == nil {
					completion.Status = "queued"
					completion.ErrorKind = ""
					completion.RetryAfter = time.Second * time.Duration(1<<clip.RetryCount)
					if failure.RetryAfter > completion.RetryAfter {
						completion.RetryAfter = failure.RetryAfter
					}
				}
			}
		}
	}
	completion.GenerationMS = int(time.Since(started).Milliseconds())
	// Finalization gets its own short cancellation-independent context, so
	// shutdown cannot strand a completed call or a partial upload as running.
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer finishCancel()
	accepted, finishErr := s.store.CompleteVoiceClip(finishCtx, clip, completion)
	if (!accepted || finishErr != nil) && s.blobs != nil && len(audio) > 0 {
		_ = s.blobs.Delete(finishCtx, clip.ObjectKey)
	}
	if finishErr != nil {
		completion.Status = "failed"
		completion.ErrorKind = "storage_error"
	}
	s.log.Info("voice", slog.String("engine", clip.Engine), slog.String("status", completion.Status), slog.String("error_kind", completion.ErrorKind), slog.Int("duration_ms", completion.DurationMS), slog.Int("generation_ms", completion.GenerationMS))
}

func (s *Service) cleanup(ctx context.Context) {
	if s.blobs == nil {
		return
	}
	objects, err := s.store.ListVoiceCleanup(ctx)
	if err != nil {
		return
	}
	for _, object := range objects {
		if s.blobs.Delete(ctx, object.Key) != nil {
			continue
		}
		if s.store.CompleteVoiceCleanup(ctx, object.Key) != nil {
			return
		}
	}
}
