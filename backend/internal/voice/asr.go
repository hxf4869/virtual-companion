package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/restoregate"
)

const MaxRecordingBytes = 60*16000*2 + 4096
const MaxASRUploadBytes = MaxRecordingBytes + 65536

type Transcription struct {
	Text     string `json:"text"`
	Emotion  string `json:"emotion,omitempty"`
	Language string `json:"language,omitempty"`
}
type ASREngine interface {
	Healthy(context.Context) bool
	Transcribe(context.Context, []byte) (Transcription, error)
}

func (c *HTTPClient) Healthy(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSuffix(c.base, "/v1")+"/healthz", nil)
	res, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	return res.StatusCode == http.StatusOK
}
func (c *HTTPClient) Transcribe(ctx context.Context, audio []byte) (Transcription, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "recording.wav")
	_, _ = part.Write(audio)
	_ = writer.Close()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/audio/transcriptions", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	res, err := c.http.Do(req)
	if err != nil {
		return Transcription{}, engineFailure(ctx, err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		kind := "upstream_error"
		if res.StatusCode == 429 {
			kind = "rate_limited"
		}
		if res.StatusCode == 400 || res.StatusCode == 415 {
			kind = "bad_request"
		}
		return Transcription{}, &EngineError{Kind: kind}
	}
	data, err := readBounded(res.Body, 64<<10)
	if err != nil {
		return Transcription{}, &EngineError{Kind: "upstream_error"}
	}
	var result Transcription
	if json.Unmarshal(data, &result) != nil || !utf8.ValidString(result.Text) || strings.TrimSpace(result.Text) == "" || utf8.RuneCountInString(result.Text) > 4000 {
		return Transcription{}, &EngineError{Kind: "upstream_error"}
	}
	result.Text = strings.TrimSpace(result.Text)
	switch result.Emotion {
	case "HAPPY", "SAD", "ANGRY", "NEUTRAL":
	default:
		result.Emotion = ""
	}
	switch result.Language {
	case "zh", "en", "ja", "ko", "yue":
	default:
		result.Language = ""
	}
	return result, nil
}

func (s *Service) Transcribe(ctx context.Context, owner int64, audio []byte) (Transcription, error) {
	if s.asr == nil || restoregate.Closed(s.gate) {
		return Transcription{}, ErrUnavailable
	}
	settings, err := s.Settings(ctx, owner)
	if err != nil {
		return Transcription{}, err
	}
	if !settings.ASREnabled {
		return Transcription{}, ErrUnavailable
	}
	duration, err := pcmWAVDuration(audio, 16000, MaxRecordingBytes)
	if err != nil || duration > settings.MaxRecordingSeconds*1000 {
		return Transcription{}, ErrInvalid
	}
	select {
	case s.asrBusy <- struct{}{}:
		defer func() { <-s.asrBusy }()
	default:
		return Transcription{}, ErrRateLimited
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(settings.ASRTimeoutSeconds)*time.Second)
	defer cancel()
	if err := s.acquire(ctx); err != nil {
		return Transcription{}, ErrUnavailable
	}
	defer s.release()
	result, err := s.asr.Transcribe(ctx, audio)
	if err != nil {
		var engine *EngineError
		if errors.As(err, &engine) && engine.Kind == "rate_limited" {
			return Transcription{}, ErrRateLimited
		}
		return Transcription{}, ErrUnavailable
	}
	if restoregate.Closed(s.gate) {
		return Transcription{}, ErrUnavailable
	}
	return result, nil
}

func (s *Service) acquire(ctx context.Context) error {
	select {
	case s.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (s *Service) release() { <-s.slots }

// Waiting background synthesis must leave the next free slot to chat audio.
// Already running inference is never interrupted or reconfigured.
func (s *Service) acquireTTS(ctx context.Context, engine string) error {
	if engine == Kokoro {
		s.kokoroWaiting.Add(1)
		defer s.kokoroWaiting.Add(-1)
		return s.acquire(ctx)
	}
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if s.kokoroWaiting.Load() == 0 {
			select {
			case s.slots <- struct{}{}:
				return nil
			default:
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}
