package openai

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sync/atomic"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
)

var _ companion.Provider = (*Adapter)(nil)

const (
	idleConnTimeout   = 90 * time.Second
	maxIdleConns      = 8
	maxIdleConnsHost  = 2
	tlsHandshakeFloor = 2 * time.Second
)

// Adapter is the production OpenAI Chat Completions compatible client.
// It performs one HTTP request per Stream call, classifies failures, and
// does not retry, persist, or log bodies or credentials.
type Adapter struct {
	cfg       Config
	endpoint  *url.URL
	client    *http.Client
	transport *http.Transport
	lookup    func(context.Context, string) ([]net.IPAddr, error)
}

// lookupFunc resolves a hostname. Tests inject a fake; production uses DNS.
type lookupFunc func(context.Context, string) ([]net.IPAddr, error)

// New constructs a ready adapter. It does not open a connection.
func New(cfg Config) (*Adapter, error) {
	return newAdapter(cfg, defaultLookup)
}

func newAdapter(cfg Config, lookup lookupFunc) (*Adapter, error) {
	cfg = cfg.withDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	endpoint, err := parseEndpoint(cfg.Endpoint, cfg.AllowLoopbackHTTP)
	if err != nil {
		return nil, err
	}
	if lookup == nil {
		lookup = defaultLookup
	}
	a := &Adapter{cfg: cfg, endpoint: endpoint, lookup: lookup}
	tlsTimeout := cfg.ConnectTimeout
	if tlsTimeout < tlsHandshakeFloor {
		tlsTimeout = tlsHandshakeFloor
	}
	transport := &http.Transport{
		Proxy:                 noProxy,
		DialContext:           a.dialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          maxIdleConns,
		MaxIdleConnsPerHost:   maxIdleConnsHost,
		IdleConnTimeout:       idleConnTimeout,
		TLSHandshakeTimeout:   tlsTimeout,
		ExpectContinueTimeout: time.Second,
		DisableCompression:    false,
	}
	a.transport = transport
	a.client = &http.Client{
		Transport:     transport,
		CheckRedirect: denyRedirect,
		Timeout:       0,
	}
	return a, nil
}

// Close idle HTTP connections. Stream in flight is cancelled by context.
func (a *Adapter) Close() {
	if a == nil || a.transport == nil {
		return
	}
	a.transport.CloseIdleConnections()
}

func (a *Adapter) Stream(ctx context.Context, request companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if a == nil || a.client == nil {
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
	body, err := encodeRequest(a.cfg, request)
	if err != nil {
		if companion.AsError(err) != nil {
			return companion.AttemptResult{}, err
		}
		return companion.AttemptResult{}, companion.InvalidRequest()
	}

	timeouts := a.clampTimeouts(request.Timeouts)
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	var gotConn atomic.Bool
	var wroteRequest atomic.Bool
	ctx = httptrace.WithClientTrace(ctx, &httptrace.ClientTrace{
		GotConn:      func(httptrace.GotConnInfo) { gotConn.Store(true) },
		WroteRequest: func(httptrace.WroteRequestInfo) { wroteRequest.Store(true) },
	})
	deliveryNow := func() companion.Delivery {
		if gotConn.Load() || wroteRequest.Load() {
			return companion.DeliveryUnknown
		}
		return companion.DeliveryNotSent
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	if !sameApprovedEndpoint(a.endpoint, req.URL) {
		return companion.AttemptResult{}, companion.InvalidRequest()
	}
	req.Header.Set("Content-Type", "application/json")
	if request.Stream {
		req.Header.Set("Accept", "text/event-stream")
	} else {
		req.Header.Set("Accept", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+a.cfg.BearerToken)

	start := time.Now()
	totalDeadline := start.Add(timeouts.Total)
	connectDeadline := start.Add(timeouts.Connect)
	connectWait := timeouts.Connect
	connectPhase := companion.TimeoutConnect
	if !connectDeadline.Before(totalDeadline) {
		connectWait = time.Until(totalDeadline)
		connectPhase = companion.TimeoutTotal
	}
	if connectWait <= 0 {
		return companion.AttemptResult{}, companion.Timeout(companion.TimeoutTotal, companion.DeliveryNotSent)
	}

	type doResult struct {
		resp *http.Response
		err  error
	}
	ch := make(chan doResult, 1)
	go func() {
		resp, doErr := a.client.Do(req)
		ch <- doResult{resp, doErr}
	}()

	timer := time.NewTimer(connectWait)
	var res doResult
	select {
	case res = <-ch:
		timer.Stop()
	case <-timer.C:
		cancel(timeoutErr{phase: connectPhase, delivery: deliveryNow()})
		res = <-ch
		if res.resp != nil {
			closeBody(res.resp.Body)
		}
		return companion.AttemptResult{}, classify(ctx, res.err, deliveryNow())
	case <-ctx.Done():
		timer.Stop()
		res = <-ch
		if res.resp != nil {
			closeBody(res.resp.Body)
		}
		return companion.AttemptResult{}, classify(ctx, ctx.Err(), deliveryNow())
	}
	if res.err != nil {
		if res.resp != nil {
			closeBody(res.resp.Body)
		}
		delivery := deliveryNow()
		if isNotSent(res.err) && !gotConn.Load() {
			delivery = companion.DeliveryNotSent
		}
		return companion.AttemptResult{}, classify(ctx, res.err, delivery)
	}
	resp := res.resp
	defer closeBody(resp.Body)

	if statusErr := classifyStatus(resp.StatusCode); statusErr != nil {
		drainLimited(resp.Body, a.cfg.MaxResponseBytes)
		return companion.AttemptResult{}, statusErr
	}
	wantType := "application/json"
	if request.Stream {
		wantType = "text/event-stream"
	}
	if mediaType(resp.Header.Get("Content-Type")) != wantType {
		drainLimited(resp.Body, a.cfg.MaxResponseBytes)
		return companion.AttemptResult{}, companion.Malformed(companion.DeliveryReceived)
	}

	firstDeadline := time.Now().Add(timeouts.FirstToken)
	firstWait := timeouts.FirstToken
	firstPhase := companion.TimeoutFirstToken
	if !firstDeadline.Before(totalDeadline) {
		firstWait = time.Until(totalDeadline)
		firstPhase = companion.TimeoutTotal
	}
	if firstWait <= 0 {
		cancel(timeoutErr{phase: companion.TimeoutTotal, delivery: companion.DeliveryUnknown})
		return companion.AttemptResult{}, companion.Timeout(companion.TimeoutTotal, companion.DeliveryUnknown)
	}

	var firstSeen atomic.Bool
	ftTimer := time.AfterFunc(firstWait, func() {
		if !firstSeen.Load() {
			cancel(timeoutErr{phase: firstPhase, delivery: companion.DeliveryUnknown})
		}
	})
	defer ftTimer.Stop()

	totalLeft := time.Until(totalDeadline)
	if totalLeft <= 0 {
		cancel(timeoutErr{phase: companion.TimeoutTotal, delivery: companion.DeliveryUnknown})
		return companion.AttemptResult{}, companion.Timeout(companion.TimeoutTotal, companion.DeliveryUnknown)
	}
	totalTimer := time.AfterFunc(totalLeft, func() {
		cancel(timeoutErr{phase: companion.TimeoutTotal, delivery: companion.DeliveryUnknown})
	})
	defer totalTimer.Stop()

	markFirst := func() {
		firstSeen.Store(true)
		ftTimer.Stop()
	}

	if !request.Stream {
		text, usage, finish, parseErr := decodeCompletion(resp.Body, a.cfg.MaxResponseBytes)
		if parseErr != nil {
			return companion.AttemptResult{}, classifyParse(ctx, parseErr, companion.DeliveryReceived)
		}
		if int64(len(text)) > a.cfg.MaxResponseBytes {
			return companion.AttemptResult{}, companion.Malformed(companion.DeliveryReceived)
		}
		markFirst()
		if err := emit(companion.OutputDelta{Text: text}); err != nil {
			return companion.AttemptResult{}, classifyEmit(ctx, err)
		}
		if err := ctx.Err(); err != nil {
			return companion.AttemptResult{}, classify(ctx, err, companion.DeliveryReceived)
		}
		return companion.AttemptResult{Finish: finish, Usage: usage}, nil
	}

	result, parseErr := a.consumeStream(ctx, resp.Body, emit, markFirst)
	if parseErr != nil {
		return companion.AttemptResult{}, classifyParse(ctx, parseErr, companion.DeliveryReceived)
	}
	if err := ctx.Err(); err != nil {
		return companion.AttemptResult{}, classify(ctx, err, companion.DeliveryReceived)
	}
	return result, nil
}

func (a *Adapter) consumeStream(
	ctx context.Context,
	body io.Reader,
	emit func(companion.OutputDelta) error,
	markFirst func(),
) (companion.AttemptResult, error) {
	state := streamState{maxOut: a.cfg.MaxResponseBytes}
	var terminal bool
	var result companion.AttemptResult
	err := decodeSSE(newBoundReader(body, a.cfg.MaxResponseBytes), a.cfg.MaxResponseBytes, a.cfg.MaxResponseBytes, func(data string) (bool, error) {
		if err := ctx.Err(); err != nil {
			return false, err
		}
		if terminal {
			return false, nil
		}
		if int64(len(data)) > a.cfg.MaxResponseBytes {
			return false, errMalformed
		}
		if data == "[DONE]" {
			if !state.contentSeen || state.finish == "" || state.usage == nil {
				return false, errMalformed
			}
			if state.join.pendingIncomplete() {
				return false, errMalformed
			}
			terminal = true
			result = companion.AttemptResult{Finish: state.finish, Usage: *state.usage}
			return false, nil
		}
		if state.usage != nil {
			return false, errMalformed
		}
		units, present, finish, usage, err := decodeStreamChunk(data)
		if err != nil {
			return false, err
		}
		if usage != nil {
			if state.finish == "" {
				return false, errMalformed
			}
			state.usage = usage
			return true, nil
		}
		if state.finish != "" {
			return false, errMalformed
		}
		if present {
			text, jerr := state.join.append(units)
			if jerr != nil {
				return false, jerr
			}
			if int64(len(text)) > state.maxOut-state.outBytes {
				return false, errMalformed
			}
			state.outBytes += int64(len(text))
			state.contentSeen = true
			markFirst()
			if text != "" {
				if err := emit(companion.OutputDelta{Text: text}); err != nil {
					return false, err
				}
			} else if state.join.pendingIncomplete() {
				markFirst()
			}
		}
		if finish != "" {
			if state.finish != "" {
				return false, errMalformed
			}
			state.finish = finish
		}
		return true, nil
	})
	if err != nil {
		return companion.AttemptResult{}, err
	}
	if !terminal {
		return companion.AttemptResult{}, errMalformed
	}
	return result, nil
}

type streamState struct {
	join        utf16Join
	outBytes    int64
	maxOut      int64
	contentSeen bool
	finish      companion.FinishReason
	usage       *companion.Usage
}

func (a *Adapter) clampTimeouts(req companion.TimeoutBudget) companion.TimeoutBudget {
	out := companion.TimeoutBudget{
		Connect:    a.cfg.ConnectTimeout,
		FirstToken: a.cfg.FirstTokenTimeout,
		Total:      a.cfg.TotalTimeout,
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

type timeoutErr struct {
	phase    companion.TimeoutPhase
	delivery companion.Delivery
}

func (e timeoutErr) Error() string {
	return companion.Timeout(e.phase, e.delivery).Error()
}

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
	if errors.Is(err, context.Canceled) || (ctx != nil && errors.Is(ctx.Err(), context.Canceled) && timeoutCause(ctx, nil) == nil) {
		return companion.Canceled(delivery)
	}
	if errors.Is(err, errRedirect) {
		return companion.Malformed(companion.DeliveryReceived)
	}
	if errors.Is(err, errBlocked) || errors.Is(err, errMalformed) || errors.Is(err, errOverLimit) {
		if delivery == companion.DeliveryNotSent {
			return companion.Malformed(companion.DeliveryNotSent)
		}
		return companion.Malformed(delivery)
	}
	if errors.Is(err, errDNS) || isNotSent(err) {
		if delivery == companion.DeliveryNotSent {
			return companion.Disconnected(companion.DeliveryNotSent)
		}
		return companion.Disconnected(delivery)
	}
	if err == nil && ctx != nil && ctx.Err() != nil {
		if te := timeoutCause(ctx, ctx.Err()); te != nil {
			return companion.Timeout(te.phase, te.delivery)
		}
		return companion.Canceled(delivery)
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
	if errors.Is(err, errMalformed) || errors.Is(err, errOverLimit) {
		return companion.Malformed(delivery)
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.EOF) {
		return companion.Malformed(delivery)
	}
	if errors.Is(err, context.Canceled) {
		return companion.Canceled(delivery)
	}
	return companion.Disconnected(delivery)
}

func classifyEmit(ctx context.Context, err error) error {
	if pe := companion.AsError(err); pe != nil {
		return pe
	}
	if ctx != nil && ctx.Err() != nil {
		return classify(ctx, ctx.Err(), companion.DeliveryReceived)
	}
	return companion.Disconnected(companion.DeliveryReceived)
}

func timeoutCause(ctx context.Context, err error) *timeoutErr {
	var te timeoutErr
	if errors.As(err, &te) {
		return &te
	}
	if ctx == nil {
		return nil
	}
	if errors.As(context.Cause(ctx), &te) {
		return &te
	}
	return nil
}

func isNotSent(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errBlocked) || errors.Is(err, errDNS) {
		return true
	}
	if errors.Is(err, errRedirect) {
		return false
	}
	var op *net.OpError
	if errors.As(err, &op) {
		return op.Op == "dial" || op.Op == "connect"
	}
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return true
	}
	return false
}

func closeBody(c io.Closer) {
	if c == nil {
		return
	}
	_ = c.Close()
}

func drainLimited(r io.Reader, max int64) {
	if r == nil {
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(r, max))
}
