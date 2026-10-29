// Package memoryengine is the private, bounded transport to the local engine.
package memoryengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"time"
)

var ErrUnavailable = errors.New("memory engine unavailable")
var ErrConflict = errors.New("memory engine operation conflict")

var closedCodePattern = regexp.MustCompile(`^MEMORYCORE_[A-Z0-9_]+$`)

type closedError struct{ code string }

func (e *closedError) Error() string { return e.code }

// revisionConflictError is the propose/profile failure that must not be logged as a still-running extraction.
type revisionConflictError struct{ closedError }

func (e *revisionConflictError) Unwrap() error { return ErrConflict }

// RevisionConflictError is the observable engine result of a scope revision moving under an in-flight operation.
func RevisionConflictError() error {
	return &revisionConflictError{closedError: closedError{code: "MEMORYCORE_REVISION_CONFLICT"}}
}

// ClosedCode returns a closed engine code carried by err. Any other text is discarded.
func ClosedCode(err error) string {
	var closed *closedError
	if errors.As(err, &closed) && len(closed.code) <= 64 && closedCodePattern.MatchString(closed.code) {
		return closed.code
	}
	var revision *revisionConflictError
	if errors.As(err, &revision) && len(revision.code) <= 64 && closedCodePattern.MatchString(revision.code) {
		return revision.code
	}
	return ""
}

type Scope struct {
	OwnerID        string `json:"ownerId"`
	InstanceID     string `json:"instanceId"`
	Mode           string `json:"mode"`
	DomainID       string `json:"domainId"`
	ProfileScopeID string `json:"profileScopeId"`
}

const (
	LocalEmbeddingModel      = "qwen3-embedding:0.6b"
	LocalEmbeddingDimensions = 1024
	LocalRerankModel         = "bge-reranker-v2-m3"
)

type EmbeddingProbe struct {
	Model      string `json:"model"`
	Dimensions int    `json:"dimensions"`
	Healthy    bool   `json:"healthy"`
}

type RerankProbe struct {
	Model             string `json:"model"`
	DeploymentEnabled bool   `json:"deploymentEnabled"`
	Healthy           bool   `json:"healthy"`
}

type LocalModelStatus struct {
	Embedding EmbeddingProbe `json:"embedding"`
	Rerank    RerankProbe    `json:"rerank"`
}

func UnavailableLocalModels() LocalModelStatus {
	return LocalModelStatus{
		Embedding: EmbeddingProbe{Model: LocalEmbeddingModel, Dimensions: LocalEmbeddingDimensions},
		Rerank:    RerankProbe{Model: LocalRerankModel},
	}
}

type Client struct {
	base, token string
	http        *http.Client
}

func New(base, token string) (*Client, error) {
	u, e := url.Parse(base)
	if e != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || token == "" {
		return nil, ErrUnavailable
	}
	return &Client{base: base, token: token, http: &http.Client{Timeout: 5 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrUnavailable }}}, nil
}
func (c *Client) Call(ctx context.Context, action string, input, out any) error {
	if c == nil {
		return ErrUnavailable
	}
	switch action {
	case "propose", "commit", "operation-status", "search", "rebuild-profile", "rebuild-space", "forget", "clear-owner", "export-owner", "correct-propose", "scope-status", "invalidate-scope", "read-profile":
	default:
		return ErrUnavailable
	}
	body, e := json.Marshal(input)
	if e != nil {
		return ErrUnavailable
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/internal/"+action, bytes.NewReader(body))
	if e != nil {
		return ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	res, e := c.http.Do(req)
	if e != nil {
		return ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode == 409 {
		return conflictStatus(res.Body)
	}
	if res.StatusCode != 200 {
		return closedStatus(res.Body)
	}
	if out == nil {
		_, e = io.Copy(io.Discard, io.LimitReader(res.Body, 64<<20))
		return e
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(out); e != nil {
		return ErrUnavailable
	}
	return nil
}

func (c *Client) LocalModels(ctx context.Context) (LocalModelStatus, error) {
	if c == nil {
		return LocalModelStatus{}, ErrUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/internal/local-models", nil)
	if err != nil {
		return LocalModelStatus{}, ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := c.http.Do(req)
	if err != nil {
		return LocalModelStatus{}, ErrUnavailable
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 512))
		return LocalModelStatus{}, ErrUnavailable
	}
	var out LocalModelStatus
	if json.NewDecoder(io.LimitReader(res.Body, 1<<16)).Decode(&out) != nil {
		return LocalModelStatus{}, ErrUnavailable
	}
	return out, nil
}

func conflictStatus(body io.Reader) error {
	var payload struct {
		Code string `json:"code"`
	}
	if json.NewDecoder(io.LimitReader(body, 512)).Decode(&payload) != nil || payload.Code != "MEMORYCORE_REVISION_CONFLICT" {
		return ErrConflict
	}
	return RevisionConflictError()
}
func closedStatus(body io.Reader) error {
	var payload struct {
		Code string `json:"code"`
	}
	dec := json.NewDecoder(io.LimitReader(body, 512))
	if dec.Decode(&payload) != nil || len(payload.Code) > 64 || !closedCodePattern.MatchString(payload.Code) {
		return ErrUnavailable
	}
	return &closedError{code: payload.Code}
}
