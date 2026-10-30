package voice

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// HTTPClient talks only to the fixed deployment URL. Redirects cannot move an
// unauthenticated private engine request to a different service.
type HTTPClient struct {
	engine string
	base   string
	http   *http.Client
}

func NewHTTPClient(engine, base string) (*HTTPClient, error) {
	u, err := url.Parse(base)
	if (engine != Kokoro && engine != CosyVoice && engine != "asr") || err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasSuffix(strings.TrimRight(u.Path, "/"), "/v1") {
		return nil, ErrInvalid
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	transport.ResponseHeaderTimeout = 0 // the job context bounds slow CosyVoice
	return &HTTPClient{engine: engine, base: strings.TrimRight(base, "/"), http: &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *HTTPClient) Voices(ctx context.Context) ([]VoiceOption, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	endpoint := c.base + "/voices"
	if c.engine == CosyVoice {
		endpoint = strings.TrimSuffix(c.base, "/v1") + "/healthz"
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	response, err := c.http.Do(req)
	if err != nil {
		return nil, engineFailure(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, &EngineError{Kind: "unavailable"}
	}
	data, err := readBounded(response.Body, 256<<10)
	if err != nil {
		return nil, &EngineError{Kind: "unavailable"}
	}
	var body struct {
		Voices []json.RawMessage `json:"voices"`
	}
	if json.Unmarshal(data, &body) != nil || body.Voices == nil {
		return nil, &EngineError{Kind: "unavailable"}
	}
	voices := make([]VoiceOption, 0, len(body.Voices))
	for _, raw := range body.Voices {
		var option VoiceOption
		if len(raw) > 0 && raw[0] == '"' {
			if json.Unmarshal(raw, &option.ID) != nil {
				return nil, &EngineError{Kind: "unavailable"}
			}
			option.Name = option.ID
		} else if json.Unmarshal(raw, &option) != nil {
			return nil, &EngineError{Kind: "unavailable"}
		}
		if !validVoiceID(option.ID) {
			return nil, &EngineError{Kind: "unavailable"}
		}
		if option.Name == "" {
			option.Name = option.ID
		}
		if option.Gender != "FEMALE" && option.Gender != "MALE" && option.Gender != "NEUTRAL" {
			option.Gender = "NEUTRAL"
		}
		if c.engine == Kokoro && len(option.ID) > 1 {
			if option.ID[1] == 'f' {
				option.Gender = "FEMALE"
			}
			if option.ID[1] == 'm' {
				option.Gender = "MALE"
			}
		}
		voices = append(voices, option)
	}
	return voices, nil
}

func (c *HTTPClient) Synthesize(ctx context.Context, text, voice string, params Params) ([]byte, error) {
	body := map[string]any{"input": text, "voice": voice}
	if c.engine == CosyVoice {
		body["model"] = "cosyvoice3-q8"
		body["stream"] = false
		body["instructions"] = params.Instructions
		if params.Seed != nil {
			body["seed"] = *params.Seed
		}
	} else {
		body["model"] = "kokoro-zh-v1.1"
		body["speed"] = params.Speed
		body["response_format"] = "wav"
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, &EngineError{Kind: "bad_request"}
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/audio/speech", bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return nil, engineFailure(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		kind := "upstream_error"
		switch response.StatusCode {
		case 400:
			kind = "bad_request"
		case 429:
			kind = "rate_limited"
		}
		return nil, &EngineError{Kind: kind, RetryAfter: retryAfter(response.Header.Get("Retry-After"), time.Now())}
	}
	data, err := readBounded(response.Body, MaxAudioBytes)
	if err != nil {
		return nil, engineFailure(ctx, err)
	}
	return data, nil
}

func engineFailure(ctx context.Context, err error) error {
	kind := "unavailable"
	var timeout net.Error
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.As(err, &timeout) && timeout.Timeout() {
		kind = "timeout"
	}
	return &EngineError{Kind: kind}
}

func retryAfter(raw string, now time.Time) time.Duration {
	var wait time.Duration
	if seconds, err := strconv.ParseInt(raw, 10, 32); err == nil {
		wait = time.Duration(seconds) * time.Second
	} else if at, err := http.ParseTime(raw); err == nil {
		wait = at.Sub(now)
	}
	if wait < 0 {
		return 0
	}
	if wait > time.Minute {
		return time.Minute
	}
	return wait
}

func validVoiceID(id string) bool {
	return id != "" && len([]rune(id)) <= 128 && strings.TrimSpace(id) == id && !strings.ContainsAny(id, "\x00\r\n")
}
