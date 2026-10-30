// Package voice owns bounded TTS calls and the durable per-engine speech queue.
package voice

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	Kokoro        = "kokoro"
	CosyVoice     = "cosyvoice"
	MaxAudioBytes = 32 << 20
	PreviewText   = "你好，很高兴认识你。今天也想陪你说说话。"
)

var (
	ErrInvalid     = errors.New("invalid voice request")
	ErrUnavailable = errors.New("voice capability unavailable")
	ErrNotFound    = errors.New("voice not found")
	ErrConflict    = errors.New("voice revision conflict")
	ErrRateLimited = errors.New("voice limit reached")
	ErrStore       = errors.New("voice storage failed")
)

type SettingsValues struct {
	KokoroEnabled           bool               `json:"kokoroEnabled"`
	CosyVoiceEnabled        bool               `json:"cosyVoiceEnabled"`
	ASREnabled              bool               `json:"asrEnabled"`
	KokoroTimeoutSeconds    int                `json:"kokoroTimeoutSeconds"`
	CosyVoiceTimeoutSeconds int                `json:"cosyVoiceTimeoutSeconds"`
	ASRTimeoutSeconds       int                `json:"asrTimeoutSeconds"`
	DailyChatLimit          int                `json:"dailyChatLimit"`
	DailyProactiveLimit     int                `json:"dailyProactiveLimit"`
	VoiceFrequency          string             `json:"voiceFrequency"`
	CosyVoiceInstructions   map[string]string  `json:"cosyVoiceInstructions"`
	ProactiveVoiceRates     map[string]float64 `json:"proactiveVoiceRates"`
	KokoroMoodSpeeds        map[string]float64 `json:"kokoroMoodSpeeds"`
	MaxRecordingSeconds     int                `json:"maxRecordingSeconds"`
}

type Settings struct {
	SettingsValues
	Revision  int64      `json:"revision"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

type SettingsWrite struct {
	SettingsValues
	ExpectedRevision int64 `json:"expectedRevision"`
}

func (s *SettingsWrite) UnmarshalJSON(data []byte) error {
	type plain SettingsWrite
	var value plain
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return ErrInvalid
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return ErrInvalid
	}
	for _, key := range []string{"kokoroEnabled", "cosyVoiceEnabled", "asrEnabled", "kokoroTimeoutSeconds", "cosyVoiceTimeoutSeconds", "asrTimeoutSeconds", "dailyChatLimit", "dailyProactiveLimit", "voiceFrequency", "cosyVoiceInstructions", "proactiveVoiceRates", "kokoroMoodSpeeds", "maxRecordingSeconds", "expectedRevision"} {
		if len(fields[key]) == 0 || string(fields[key]) == "null" {
			return ErrInvalid
		}
	}
	*s = SettingsWrite(value)
	return nil
}

func DefaultSettings() Settings {
	return Settings{SettingsValues: SettingsValues{
		KokoroEnabled: true, CosyVoiceEnabled: true, ASREnabled: true,
		KokoroTimeoutSeconds: 60, CosyVoiceTimeoutSeconds: 300, ASRTimeoutSeconds: 30,
		DailyChatLimit: 60, DailyProactiveLimit: 8, VoiceFrequency: "STANDARD", MaxRecordingSeconds: 60,
		ProactiveVoiceRates: map[string]float64{"morning": 1, "night": 1, "care": .5, "share": .3, "default": 0},
		CosyVoiceInstructions: map[string]string{
			"morning": "You are a helpful assistant. 请用刚睡醒、有点慵懒又温柔的语气说。",
			"night":   "You are a helpful assistant. 请轻声、温柔、放慢一点地说。",
			"care":    "You are a helpful assistant. 请温柔关切地说。",
			"share":   "You are a helpful assistant. 请开心、轻快地说。",
			"default": "You are a helpful assistant.",
		},
		KokoroMoodSpeeds: map[string]float64{"开心": 1.05, "得意": 1.05, "懒洋洋": 0.92, "有点累": 0.92, "困": 0.92},
	}}
}

func (s SettingsWrite) Validate() error {
	if s.ExpectedRevision < 0 || s.KokoroTimeoutSeconds < 1 || s.KokoroTimeoutSeconds > 3600 || s.CosyVoiceTimeoutSeconds < 1 || s.CosyVoiceTimeoutSeconds > 3600 || s.ASRTimeoutSeconds < 1 || s.ASRTimeoutSeconds > 120 || s.DailyChatLimit < 0 || int64(s.DailyChatLimit) > math.MaxInt32 || s.DailyProactiveLimit < 0 || int64(s.DailyProactiveLimit) > math.MaxInt32 || s.MaxRecordingSeconds < 1 || s.MaxRecordingSeconds > 60 || !validFrequency(s.VoiceFrequency, false) {
		return ErrInvalid
	}
	if len(s.ProactiveVoiceRates) != 5 {
		return ErrInvalid
	}
	for _, key := range []string{"morning", "night", "care", "share", "default"} {
		v, ok := s.ProactiveVoiceRates[key]
		if !ok || math.IsNaN(v) || v < 0 || v > 1 {
			return ErrInvalid
		}
	}
	if len(s.CosyVoiceInstructions) != 5 {
		return ErrInvalid
	}
	for _, key := range []string{"morning", "night", "care", "share", "default"} {
		v := s.CosyVoiceInstructions[key]
		if !strings.HasPrefix(v, "You are a helpful assistant.") || utf8.RuneCountInString(v) > 1000 {
			return ErrInvalid
		}
	}
	if s.KokoroMoodSpeeds == nil {
		return ErrInvalid
	}
	for key, speed := range s.KokoroMoodSpeeds {
		if strings.TrimSpace(key) == "" || !validSpeed(speed) {
			return ErrInvalid
		}
	}
	return nil
}

func validSpeed(speed float64) bool { return !math.IsNaN(speed) && speed >= 0.5 && speed <= 2 }
func validFrequency(f string, off bool) bool {
	return f == "LOW" || f == "STANDARD" || f == "HIGH" || off && f == "OFF"
}

type RelationshipPrefs struct {
	KokoroVoice     *string `json:"kokoroVoice"`
	CosyVoice       *string `json:"cosyVoice"`
	Speed           float64 `json:"speed"`
	VoiceFrequency  *string `json:"voiceFrequency"`
	ProactiveVoice  bool    `json:"proactiveVoice"`
	ProactiveEngine *string `json:"proactiveEngine"`
}

type Relationship struct {
	RelationshipPrefs
	ID     int64
	Gender string
	Mood   string
}

type Params struct {
	Speed          float64 `json:"speed"`
	Instructions   string  `json:"instructions,omitempty"`
	Seed           *int64  `json:"seed,omitempty"`
	TimeoutSeconds int     `json:"timeoutSeconds"`
}

type Clip struct {
	OwnerID        int64      `json:"-"`
	ID             int64      `json:"clipId,string"`
	RelationshipID int64      `json:"relationshipId,string"`
	MessageRef     *string    `json:"messageRef,omitempty"`
	Purpose        string     `json:"purpose"`
	Engine         string     `json:"engine"`
	Voice          string     `json:"voice"`
	Text           string     `json:"text"`
	Status         string     `json:"status"`
	ErrorKind      *string    `json:"errorKind,omitempty"`
	DurationMS     *int       `json:"durationMs,omitempty"`
	GenerationMS   *int       `json:"generationMs,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	ReadyAt        *time.Time `json:"readyAt,omitempty"`
	Params         Params     `json:"-"`
	ObjectKey      string     `json:"-"`
	RetryCount     int        `json:"-"`
	StartedAt      *time.Time `json:"-"`
}

type CreateRequest struct {
	MessageRef string `json:"messageRef"`
	Text       string `json:"text"`
	Purpose    string `json:"purpose"`
}

type PreviewRequest struct {
	RelationshipID int64    `json:"relationshipId,string"`
	Engine         string   `json:"engine"`
	Voice          string   `json:"voice"`
	Speed          *float64 `json:"speed,omitempty"`
}

type Completion struct {
	StorageBytes int64
	Status       string
	ErrorKind    string
	DurationMS   int
	GenerationMS int
	RetryAfter   time.Duration
}

type Attachment struct {
	ClipID     string `json:"clipId"`
	Status     string `json:"status"`
	DurationMS int    `json:"durationMs"`
}

type CleanupObject struct {
	Key string
}

type Store interface {
	ExpireVoiceClips(context.Context) error
	VoiceUsage(context.Context, int64) (Usage, error)
	GetVoiceSettings(context.Context, int64) (Settings, error)
	SaveVoiceSettings(context.Context, int64, SettingsWrite) (Settings, error)
	GetVoiceRelationship(context.Context, int64, int64) (Relationship, error)
	EnqueueVoiceClip(context.Context, Clip) (Clip, error)
	GetVoiceClip(context.Context, int64, int64) (Clip, error)
	FindVoiceClip(context.Context, int64, int64, string, string) (Clip, error)
	ResolveVoiceMessage(context.Context, int64, int64, string) (string, error)
	ClaimVoiceClip(context.Context, string) (Clip, error)
	CompleteVoiceClip(context.Context, Clip, Completion) (bool, error)
	ListVoiceCleanup(context.Context) ([]CleanupObject, error)
	CompleteVoiceCleanup(context.Context, string) error
}

type Usage struct {
	Clips        int64 `json:"clips"`
	StorageBytes int64 `json:"storageBytes"`
	DurationMS   int64 `json:"durationMs"`
}

// BlobStore reuses the configured encrypted MinIO adapter.
type BlobStore interface {
	Put(context.Context, string, []byte) (int64, error)
	Get(context.Context, string) ([]byte, error)
	Delete(context.Context, string) error
}

type VoiceOption struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Gender string `json:"gender,omitempty"`
}

type EngineState struct {
	Engine     string        `json:"engine"`
	Configured bool          `json:"configured"`
	Enabled    bool          `json:"enabled"`
	Healthy    bool          `json:"healthy"`
	Voices     []VoiceOption `json:"voices"`
}

type CapabilityState struct {
	Configured bool `json:"configured"`
	Enabled    bool `json:"enabled"`
	Healthy    bool `json:"healthy"`
}

type Engines struct {
	TTS []EngineState   `json:"tts"`
	ASR CapabilityState `json:"asr"`
}

// Engine is implemented by the HTTP client and deterministic fixture server
// in tests. Errors expose only a closed class, never input or response bodies.
type Engine interface {
	Voices(context.Context) ([]VoiceOption, error)
	Synthesize(context.Context, string, string, Params) ([]byte, error)
}

type EngineError struct {
	Kind       string
	RetryAfter time.Duration
}

func (e *EngineError) Error() string { return "speech engine " + e.Kind }

func readBounded(r io.Reader, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, ErrUnavailable
	}
	return b, nil
}
