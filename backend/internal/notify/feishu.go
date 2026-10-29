package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const feishuBodyLimit = 64 * 1024

// FeishuConfig is an optional HTTP client override. The webhook URL and the
// sign secret are fields on Request, taken from the channel row. Values on
// this struct are not used and are not a fallback.
type FeishuConfig struct {
	WebhookURL string
	SignSecret string
	HTTP       *http.Client
}

// Feishu posts a text message with the standard library. HTTP success and a
// body whose code is 0 are separate. Redirects are not followed.
type Feishu struct {
	cfg    FeishuConfig
	client *http.Client
}

// NewFeishu builds a client that does not follow redirects.
func NewFeishu(cfg FeishuConfig) *Feishu {
	client := cfg.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	client = cloneClient(client)
	client.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Feishu{cfg: cfg, client: client}
}

// Send posts the text. A 2xx response whose JSON code is missing or not 0 is
// a business failure. 429 and the bot rate-limit codes stay retryable. A
// break after the request was written is unknown.
func (f *Feishu) Send(ctx context.Context, req Request) (Result, error) {
	hook := strings.TrimSpace(req.WebhookURL)
	if f == nil || hook == "" || !webhookAllowed(hook) {
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
	now := req.Now
	if now.IsZero() {
		now = time.Now()
	}
	payload := map[string]any{
		"msg_type": "text",
		"content":  map[string]string{"text": req.Text},
	}
	if secret := req.SignSecret; secret != "" {
		ts := strconv.FormatInt(now.Unix(), 10)
		payload["timestamp"] = ts
		payload["sign"] = FeishuSign(ts, secret)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return Result{Kind: KindFailed, FailureCode: CodeHTTPError}, nil
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, hook, bytes.NewReader(raw))
	if err != nil {
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := f.client.Do(httpReq)
	if err != nil {
		if dialFailed(err) {
			return Result{Kind: KindRetry, FailureCode: CodeHTTPError}, nil
		}
		return Result{Kind: KindUnknown}, nil
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, feishuBodyLimit+1))
	if err != nil {
		return Result{Kind: KindUnknown}, nil
	}
	if len(body) > feishuBodyLimit {
		return Result{Kind: KindFailed, FailureCode: CodeHTTPError}, nil
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return Result{Kind: KindRetry, FailureCode: CodeRateLimited}, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Result{Kind: KindFailed, FailureCode: CodeHTTPError}, nil
	}
	var parsed struct {
		Code *int `json:"code"`
	}
	if json.Unmarshal(body, &parsed) != nil || parsed.Code == nil {
		return Result{Kind: KindFailed, FailureCode: CodeFeishuRejected}, nil
	}
	switch *parsed.Code {
	case 0:
		return Result{
			Kind:        KindAccepted,
			Correlation: Correlation("feishu", req.DeliveryID, now),
		}, nil
	case 9499, 11232:
		return Result{Kind: KindRetry, FailureCode: CodeRateLimited}, nil
	default:
		return Result{Kind: KindFailed, FailureCode: CodeFeishuRejected}, nil
	}
}

func webhookAllowed(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	switch u.Scheme {
	case "https":
		return true
	case "http":
		return host == "127.0.0.1" || host == "localhost" || host == "::1"
	default:
		return false
	}
}

func dialFailed(err error) bool {
	var op *net.OpError
	if errors.As(err, &op) && op.Op == "dial" {
		return true
	}
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		if errors.As(urlErr.Err, &op) && op.Op == "dial" {
			return true
		}
	}
	return false
}

func cloneClient(src *http.Client) *http.Client {
	out := *src
	return &out
}
