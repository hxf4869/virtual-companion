package openai

import (
	"fmt"
	"math"
	"net"
	"net/url"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	chatCompletionsPath      = "/v1/chat/completions"
	defaultMaxTokens         = 8192
	defaultTemperature       = 1.0
	minTemperature           = 0.0
	maxTemperature           = 2.0
	defaultConnectTimeout    = 10 * time.Second
	defaultFirstTokenTimeout = 60 * time.Second
	defaultTotalTimeout      = 240 * time.Second
	defaultMaxResponseBytes  = 256 << 10
	hardMaxResponseBytes     = 1 << 20
	hardMaxConnectTimeout    = 60 * time.Second
	hardMaxFirstTokenTimeout = 5 * time.Minute
	hardMaxTotalTimeout      = 10 * time.Minute
	maxMessages              = 64
	maxMessageBytes          = 64 << 10
	loopbackIPv4             = "127.0.0.1"
)

// Config is the adapter construction input. Endpoint and credential come
// only from process configuration, never from the repository or ModelRequest.
type Config struct {
	Endpoint          string
	BearerToken       string
	Model             string
	MaxTokens         int
	Temperature       float64
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxResponseBytes  int64
	// AllowLoopbackHTTP permits http://127.0.0.1 for mock contract tests.
	// Production config loading never sets this.
	AllowLoopbackHTTP bool
}

func (c Config) withDefaults() Config {
	if c.MaxTokens == 0 {
		c.MaxTokens = defaultMaxTokens
	}
	if c.Temperature == 0 {
		c.Temperature = defaultTemperature
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = defaultConnectTimeout
	}
	if c.FirstTokenTimeout == 0 {
		c.FirstTokenTimeout = defaultFirstTokenTimeout
	}
	if c.TotalTimeout == 0 {
		c.TotalTimeout = defaultTotalTimeout
	}
	if c.MaxResponseBytes == 0 {
		c.MaxResponseBytes = defaultMaxResponseBytes
	}
	return c
}

// Validate reports construction errors without opening a connection.
func (c Config) Validate() error {
	c = c.withDefaults()
	if strings.TrimSpace(c.Endpoint) == "" {
		return fmt.Errorf("provider endpoint is required")
	}
	if err := requireSecret(c.BearerToken); err != nil {
		return err
	}
	if strings.TrimSpace(c.Model) == "" {
		return fmt.Errorf("provider model is required")
	}
	if c.MaxTokens < 1 || c.MaxTokens > defaultMaxTokens {
		return fmt.Errorf("provider maxTokens must be between 1 and %d", defaultMaxTokens)
	}
	if math.IsNaN(c.Temperature) || math.IsInf(c.Temperature, 0) ||
		c.Temperature < minTemperature || c.Temperature > maxTemperature {
		return fmt.Errorf("provider temperature must be between 0 and 2")
	}
	if c.ConnectTimeout <= 0 || c.ConnectTimeout > hardMaxConnectTimeout {
		return fmt.Errorf("provider connect timeout must be in (0, %s]", hardMaxConnectTimeout)
	}
	if c.FirstTokenTimeout <= 0 || c.FirstTokenTimeout > hardMaxFirstTokenTimeout {
		return fmt.Errorf("provider first-token timeout must be in (0, %s]", hardMaxFirstTokenTimeout)
	}
	if c.TotalTimeout <= 0 || c.TotalTimeout > hardMaxTotalTimeout {
		return fmt.Errorf("provider total timeout must be in (0, %s]", hardMaxTotalTimeout)
	}
	if c.MaxResponseBytes <= 0 || c.MaxResponseBytes > hardMaxResponseBytes {
		return fmt.Errorf("provider maxResponseBytes must be in (0, %d]", hardMaxResponseBytes)
	}
	if _, err := parseEndpoint(c.Endpoint, c.AllowLoopbackHTTP); err != nil {
		return err
	}
	return nil
}

func parseEndpoint(raw string, allowLoopbackHTTP bool) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("provider endpoint must be an absolute URL")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("provider endpoint must not include user info, query, or fragment")
	}
	if !strings.HasSuffix(u.EscapedPath(), chatCompletionsPath) {
		return nil, fmt.Errorf("provider endpoint path must end with %s", chatCompletionsPath)
	}
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("provider endpoint must include a host")
	}
	if strings.Contains(host, ":") {
		return nil, fmt.Errorf("provider endpoint must not use an IPv6 literal host")
	}
	scheme := strings.ToLower(u.Scheme)
	if host == loopbackIPv4 {
		if scheme != "https" && !(allowLoopbackHTTP && scheme == "http") {
			return nil, fmt.Errorf("provider loopback endpoint must use https, or http when AllowLoopbackHTTP is set")
		}
		return u, nil
	}
	if scheme != "https" {
		return nil, fmt.Errorf("provider endpoint must use https")
	}
	if ip := net.ParseIP(host); ip != nil {
		return nil, fmt.Errorf("provider endpoint host is not allowed")
	}
	if err := requireHostname(host); err != nil {
		return nil, err
	}
	return u, nil
}

func requireHostname(host string) error {
	host = strings.ToLower(host)
	if strings.HasPrefix(host, ".") || strings.HasSuffix(host, ".") || !strings.Contains(host, ".") {
		return fmt.Errorf("provider endpoint host is not allowed")
	}
	for _, label := range strings.Split(host, ".") {
		if label == "" || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return fmt.Errorf("provider endpoint host is not allowed")
		}
		for i := 0; i < len(label); {
			r, n := utf8.DecodeRuneInString(label[i:])
			if r == utf8.RuneError && n == 1 {
				return fmt.Errorf("provider endpoint host is not allowed")
			}
			if !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-') {
				return fmt.Errorf("provider endpoint host is not allowed")
			}
			i += n
		}
	}
	return nil
}

func requireSecret(value string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("provider credential is required")
	}
	for _, r := range value {
		if r > 0xFF || unicode.IsControl(r) {
			return fmt.Errorf("provider credential contains an invalid character")
		}
	}
	return nil
}
