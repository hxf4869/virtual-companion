package modelhttp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

const (
	DefaultConnectTimeout    = 10 * time.Second
	DefaultFirstTokenTimeout = 60 * time.Second
	DefaultTotalTimeout      = 240 * time.Second
	DefaultMaxResponseBytes  = 256 << 10
	HardMaxResponseBytes     = 1 << 20
	idleConnTimeout          = 90 * time.Second
)

type Config struct {
	Endpoint          *url.URL
	ConnectTimeout    time.Duration
	FirstTokenTimeout time.Duration
	TotalTimeout      time.Duration
	MaxResponseBytes  int64
}

// DecodeResponse owns only protocol decoding. markFirst must be called when
// the first user-visible text is accepted.
type DecodeResponse func(
	ctx context.Context,
	body io.Reader,
	maxBytes int64,
	emit func(companion.OutputDelta) error,
	markFirst func(),
) (companion.AttemptResult, error)

type Client struct {
	cfg       Config
	client    *http.Client
	transport *http.Transport
	lookup    lookupFunc
}

func New(cfg Config) (*Client, error) { return newClient(cfg, defaultLookup) }

func newClient(cfg Config, lookup lookupFunc) (*Client, error) {
	if cfg.Endpoint == nil || cfg.Endpoint.Scheme == "" || cfg.Endpoint.Host == "" {
		return nil, errors.New("provider endpoint is required")
	}
	if cfg.ConnectTimeout == 0 {
		cfg.ConnectTimeout = DefaultConnectTimeout
	}
	if cfg.FirstTokenTimeout == 0 {
		cfg.FirstTokenTimeout = DefaultFirstTokenTimeout
	}
	if cfg.TotalTimeout == 0 {
		cfg.TotalTimeout = DefaultTotalTimeout
	}
	if cfg.MaxResponseBytes == 0 {
		cfg.MaxResponseBytes = DefaultMaxResponseBytes
	}
	if cfg.ConnectTimeout <= 0 || cfg.ConnectTimeout > time.Minute ||
		cfg.FirstTokenTimeout <= 0 || cfg.FirstTokenTimeout > 5*time.Minute ||
		cfg.TotalTimeout <= 0 || cfg.TotalTimeout > 10*time.Minute ||
		cfg.MaxResponseBytes <= 0 || cfg.MaxResponseBytes > HardMaxResponseBytes {
		return nil, errors.New("provider HTTP budget is invalid")
	}
	if lookup == nil {
		lookup = defaultLookup
	}
	c := &Client{cfg: cfg, lookup: lookup}
	t := &http.Transport{
		Proxy: noProxy, DialContext: c.dialContext, ForceAttemptHTTP2: true,
		MaxIdleConns: 8, MaxIdleConnsPerHost: 2,
		IdleConnTimeout:       idleConnTimeout,
		TLSHandshakeTimeout:   cfg.ConnectTimeout,
		ExpectContinueTimeout: time.Second,
	}
	c.transport = t
	c.client = &http.Client{Transport: t, CheckRedirect: denyRedirect}
	return c, nil
}

func (c *Client) Close() {
	if c != nil && c.transport != nil {
		c.transport.CloseIdleConnections()
	}
}

func (c *Client) Do(
	ctx context.Context,
	payload []byte,
	headers http.Header,
	wantContentType string,
	timeouts companion.TimeoutBudget,
	emit func(companion.OutputDelta) error,
	decode DecodeResponse,
) (companion.AttemptResult, error) {
	if c == nil || c.client == nil || decode == nil {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if emit == nil {
		emit = func(companion.OutputDelta) error { return nil }
	}
	if err := ctx.Err(); err != nil {
		return companion.AttemptResult{}, companion.Canceled(companion.DeliveryNotSent)
	}
	b := c.clampTimeouts(timeouts)
	callCtx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)

	var gotConn atomic.Bool
	var wroteRequest atomic.Bool
	var firstSeen atomic.Bool
	trace := &httptrace.ClientTrace{
		GotConn:      func(httptrace.GotConnInfo) { gotConn.Store(true) },
		WroteRequest: func(httptrace.WroteRequestInfo) { wroteRequest.Store(true) },
	}
	callCtx = httptrace.WithClientTrace(callCtx, trace)
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, c.cfg.Endpoint.String(), bytes.NewReader(payload))
	if err != nil || !sameEndpoint(c.cfg.Endpoint, req.URL) {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	req.Header = headers.Clone()
	req.Header.Set("Content-Type", "application/json")

	delivery := func() companion.Delivery {
		if gotConn.Load() || wroteRequest.Load() {
			return companion.DeliveryUnknown
		}
		return companion.DeliveryNotSent
	}
	connectTimer := time.AfterFunc(b.Connect, func() {
		if !gotConn.Load() {
			cancel(timeoutErr{phase: companion.TimeoutConnect, delivery: delivery()})
		}
	})
	firstTimer := time.AfterFunc(b.FirstToken, func() {
		if !firstSeen.Load() {
			cancel(timeoutErr{phase: companion.TimeoutFirstToken, delivery: delivery()})
		}
	})
	totalTimer := time.AfterFunc(b.Total, func() {
		cancel(timeoutErr{phase: companion.TimeoutTotal, delivery: delivery()})
	})
	defer connectTimer.Stop()
	defer firstTimer.Stop()
	defer totalTimer.Stop()

	resp, err := c.client.Do(req)
	connectTimer.Stop()
	if err != nil {
		return companion.AttemptResult{}, classify(callCtx, err, delivery())
	}
	defer closeBody(resp.Body)
	if statusErr := classifyStatus(resp.StatusCode); statusErr != nil {
		drainLimited(resp.Body, c.cfg.MaxResponseBytes)
		return companion.AttemptResult{}, statusErr
	}
	if mediaType(resp.Header.Get("Content-Type")) != wantContentType {
		drainLimited(resp.Body, c.cfg.MaxResponseBytes)
		return companion.AttemptResult{}, companion.Malformed(companion.DeliveryReceived)
	}
	markFirst := func() {
		firstSeen.Store(true)
		firstTimer.Stop()
	}
	result, err := decode(callCtx, resp.Body, c.cfg.MaxResponseBytes, emit, markFirst)
	if err != nil {
		return companion.AttemptResult{}, classifyParse(callCtx, err, companion.DeliveryReceived)
	}
	if err := callCtx.Err(); err != nil {
		return companion.AttemptResult{}, classify(callCtx, err, companion.DeliveryReceived)
	}
	if !firstSeen.Load() {
		return companion.AttemptResult{}, companion.Malformed(companion.DeliveryReceived)
	}
	return result, nil
}

// GetJSON performs one bounded, non-retrying catalog read. It is used only by
// the explicit ADMIN discovery action, never by generation routing.
func (c *Client) GetJSON(ctx context.Context, headers http.Header) ([]byte, error) {
	if c == nil || c.client == nil {
		return nil, errors.New("provider HTTP client is unavailable")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	callCtx, cancel := context.WithTimeout(ctx, c.cfg.TotalTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(callCtx, http.MethodGet, c.cfg.Endpoint.String(), nil)
	if err != nil || !sameEndpoint(c.cfg.Endpoint, req.URL) {
		return nil, errors.New("provider catalog request is invalid")
	}
	req.Header = headers.Clone()
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, errors.New("provider catalog is unavailable")
	}
	defer closeBody(resp.Body)
	if resp.StatusCode != http.StatusOK || mediaType(resp.Header.Get("Content-Type")) != "application/json" {
		drainLimited(resp.Body, c.cfg.MaxResponseBytes)
		return nil, errors.New("provider catalog is unavailable")
	}
	body, err := io.ReadAll(NewBoundReader(resp.Body, c.cfg.MaxResponseBytes))
	if err != nil {
		return nil, errors.New("provider catalog response is invalid")
	}
	return body, nil
}

func (c *Client) clampTimeouts(req companion.TimeoutBudget) companion.TimeoutBudget {
	out := companion.TimeoutBudget{
		Connect: c.cfg.ConnectTimeout, FirstToken: c.cfg.FirstTokenTimeout,
		Total: c.cfg.TotalTimeout,
	}
	if req.Connect > 0 && req.Connect < out.Connect {
		out.Connect = req.Connect
	}
	if req.FirstToken > 0 && req.FirstToken < out.FirstToken {
		out.FirstToken = req.FirstToken
	}
	if req.Total > 0 && req.Total < out.Total {
		out.Total = req.Total
	}
	return out
}

func (c *Client) dialContext(ctx context.Context, network, addr string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, errDNS
	}
	d := net.Dialer{Timeout: c.cfg.ConnectTimeout}
	if host == loopbackIPv4 {
		return d.DialContext(ctx, network, addr)
	}
	ips, err := c.lookup(ctx, host)
	if err != nil || len(ips) == 0 {
		return nil, errDNS
	}
	for _, ip := range ips {
		if blockedIP(ip.IP) {
			return nil, errBlocked
		}
	}
	for _, ip := range ips {
		conn, dialErr := d.DialContext(ctx, network, net.JoinHostPort(ip.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
	}
	return nil, errDNS
}

type timeoutErr struct {
	phase    companion.TimeoutPhase
	delivery companion.Delivery
}

func (e timeoutErr) Error() string { return companion.Timeout(e.phase, e.delivery).Error() }

func classifyStatus(code int) error {
	if code == http.StatusOK {
		return nil
	}
	if code == http.StatusTooManyRequests {
		return companion.RateLimited()
	}
	if code >= 500 && code <= 599 {
		return companion.UpstreamUnavailable()
	}
	return companion.Malformed(companion.DeliveryReceived)
}

func classify(ctx context.Context, err error, delivery companion.Delivery) error {
	if pe := companion.AsError(err); pe != nil {
		return pe
	}
	if te := timeoutCause(ctx, err); te != nil {
		return companion.Timeout(te.phase, te.delivery)
	}
	if errors.Is(err, context.Canceled) || (ctx != nil && errors.Is(ctx.Err(), context.Canceled)) {
		return companion.Canceled(delivery)
	}
	if errors.Is(err, errRedirect) {
		return companion.Malformed(companion.DeliveryReceived)
	}
	if errors.Is(err, errBlocked) || errors.Is(err, ErrMalformed) || errors.Is(err, ErrOverLimit) {
		return companion.Malformed(delivery)
	}
	if errors.Is(err, errDNS) || isNotSent(err) {
		return companion.Disconnected(delivery)
	}
	return companion.Disconnected(delivery)
}

func classifyParse(ctx context.Context, err error, delivery companion.Delivery) error {
	if pe := companion.AsError(err); pe != nil {
		return pe
	}
	if te := timeoutCause(ctx, err); te != nil {
		return companion.Timeout(te.phase, te.delivery)
	}
	if ctx != nil && ctx.Err() != nil {
		return classify(ctx, ctx.Err(), delivery)
	}
	if errors.Is(err, ErrMalformed) || errors.Is(err, ErrOverLimit) ||
		errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return companion.Malformed(delivery)
	}
	if errors.Is(err, context.Canceled) {
		return companion.Canceled(delivery)
	}
	return companion.Disconnected(delivery)
}

func timeoutCause(ctx context.Context, err error) *timeoutErr {
	var te timeoutErr
	if errors.As(err, &te) {
		return &te
	}
	if ctx != nil && errors.As(context.Cause(ctx), &te) {
		return &te
	}
	return nil
}

func isNotSent(err error) bool {
	var op *net.OpError
	if errors.As(err, &op) {
		return op.Op == "dial" || op.Op == "connect"
	}
	return errors.Is(err, errBlocked) || errors.Is(err, errDNS)
}

func mediaType(v string) string {
	if i := strings.IndexByte(v, ';'); i >= 0 {
		v = v[:i]
	}
	return strings.ToLower(strings.TrimSpace(v))
}

func closeBody(c io.Closer) {
	if c != nil {
		_ = c.Close()
	}
}

func drainLimited(r io.Reader, max int64) {
	if r != nil {
		_, _ = io.Copy(io.Discard, io.LimitReader(r, max))
	}
}
