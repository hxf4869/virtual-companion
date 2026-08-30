package companion

import (
	"context"
	"errors"
	"fmt"
	"unicode/utf8"
)

var (
	errSafetyStop = errors.New("companion: safety stop")
	errLengthStop = errors.New("companion: output budget stop")
	errLateDelta  = errors.New("companion: late delta discarded")
)

// StreamInput is one Attempt's process-local stream. Provider I/O is the
// only external call. Safety is a function; there is no hub.
type StreamInput struct {
	Provider Provider
	Request  ModelRequest
	Budget   TurnBudget
	Guard    OutputGuard
	// Emit is invoked only for deltas that passed rolling review. G5 tests
	// capture it; G6 will fan-out from the coordinator. Nil is allowed.
	Emit func(OutputDelta) error
}

// StreamResult is the in-process Attempt outcome. Unreviewed or blocked
// text is never persistable.
type StreamResult struct {
	Status      AttemptStatus
	Failure     string
	Delivery    Delivery
	Billing     BillingDisposition
	Finish      FinishReason
	Usage       Usage
	Text        string
	Published   []string
	Withdraw    bool
	Safety      Review
	Persistable bool
	ProviderErr error
}

// StreamAttempt runs Provider.Stream with rolling output review and a
// bounded accumulator. Provider EOS does not complete the Turn.
func StreamAttempt(ctx context.Context, in StreamInput) StreamResult {
	if ctx == nil {
		ctx = context.Background()
	}
	req, err := applyBudget(in.Request, in.Budget)
	if err != nil {
		return StreamResult{
			Status:      AttemptFailed,
			Failure:     string(CodeInvalidRequest),
			Delivery:    DeliveryNotSent,
			Billing:     BillingNotSent,
			ProviderErr: InvalidRequest(),
		}
	}
	if in.Provider == nil {
		return StreamResult{
			Status:      AttemptFailed,
			Failure:     string(CodeInvalidRequest),
			Delivery:    DeliveryNotSent,
			Billing:     BillingNotSent,
			ProviderErr: InvalidRequest(),
		}
	}
	window := in.Guard.WindowRunes
	if window <= 0 {
		window = 96
	}
	review := in.Guard.Review
	if review == nil {
		review = func(string) Review { return Review{Allow: true, Risk: "R0_NORMAL"} }
	}

	callCtx := ctx
	var cancel context.CancelFunc
	if in.Budget.TotalTimeout > 0 {
		callCtx, cancel = context.WithTimeout(ctx, in.Budget.TotalTimeout)
		defer cancel()
	}

	acc := ""
	tail := ""
	var published []string
	stopped := false
	withdraw := false
	lengthHit := false
	safetyHit := Review{Allow: true, Risk: "R0_NORMAL"}

	stop := func() {
		stopped = true
		if cancel != nil {
			cancel()
		}
	}

	emit := func(d OutputDelta) error {
		if stopped || callCtx.Err() != nil {
			return errLateDelta
		}
		if d.Text == "" {
			return nil
		}
		if !utf8.ValidString(d.Text) {
			stop()
			return Malformed(DeliveryUnknown)
		}
		windowText := tail + d.Text
		dec := review(windowText)
		if !dec.Allow {
			safetyHit = dec
			withdraw = true
			stop()
			return errSafetyStop
		}
		next := acc + d.Text
		if overOutputBudget(next, in.Budget) {
			lengthHit = true
			stop()
			return errLengthStop
		}
		acc = next
		tail = LastRunes(acc, window)
		published = append(published, d.Text)
		if in.Emit != nil {
			if err := in.Emit(d); err != nil {
				stop()
				return err
			}
		}
		return nil
	}

	result, perr := in.Provider.Stream(callCtx, req, emit)
	if withdraw {
		return StreamResult{
			Status:      AttemptCancelled,
			Failure:     safetyHit.Code(),
			Delivery:    deliveryOf(perr, DeliveryUnknown),
			Billing:     ClassifyBilling(deliveryOf(perr, DeliveryUnknown), Usage{}, perr),
			Text:        "",
			Published:   published,
			Withdraw:    true,
			Safety:      safetyHit,
			Persistable: false,
			ProviderErr: nil,
		}
	}
	if errors.Is(perr, errLengthStop) || (perr == nil && lengthHit) {
		final := review(acc)
		return StreamResult{
			Status:      AttemptSucceeded,
			Delivery:    DeliveryReceived,
			Billing:     ClassifyBilling(DeliveryReceived, result.Usage, nil),
			Finish:      FinishLength,
			Usage:       result.Usage,
			Text:        acc,
			Published:   published,
			Safety:      final,
			Persistable: final.Allow && acc != "",
			Withdraw:    !final.Allow,
		}
	}
	if perr != nil {
		if errors.Is(perr, errLateDelta) {
			perr = Canceled(DeliveryUnknown)
		}
		status, code := ClassifyAttempt(perr)
		del := deliveryOf(perr, DeliveryUnknown)
		if callCtx.Err() != nil && status == AttemptCancelled && ctx.Err() != nil {
			status = AttemptCancelled
			code = string(CodeCanceled)
		}
		return StreamResult{
			Status:      status,
			Failure:     code,
			Delivery:    del,
			Billing:     ClassifyBilling(del, Usage{}, perr),
			Text:        "",
			Published:   published,
			Withdraw:    true,
			Safety:      Review{Allow: true, Risk: "R0_NORMAL"},
			Persistable: false,
			ProviderErr: perr,
		}
	}
	if result == (AttemptResult{}) {
		return StreamResult{
			Status:      AttemptFailed,
			Failure:     string(CodeMalformed),
			Delivery:    DeliveryUnknown,
			Billing:     BillingUnknown,
			Published:   published,
			Withdraw:    true,
			Persistable: false,
			ProviderErr: Malformed(DeliveryUnknown),
		}
	}
	final := review(acc)
	out := StreamResult{
		Status:      AttemptSucceeded,
		Delivery:    DeliveryReceived,
		Billing:     ClassifyBilling(DeliveryReceived, result.Usage, nil),
		Finish:      result.Finish,
		Usage:       result.Usage,
		Text:        acc,
		Published:   published,
		Safety:      final,
		Persistable: final.Allow && acc != "",
		Withdraw:    !final.Allow,
	}
	if !final.Allow {
		out.Text = ""
		out.Failure = final.Code()
	}
	return out
}

func overOutputBudget(text string, b TurnBudget) bool {
	if b.MaxResponseBytes > 0 && int64(len(text)) > b.MaxResponseBytes {
		return true
	}
	if b.MaxOutputTokens > 0 && EstimateTokens(text) > b.MaxOutputTokens {
		return true
	}
	return false
}

func applyBudget(req ModelRequest, b TurnBudget) (ModelRequest, error) {
	if b.MaxOutputTokens < 1 || b.MaxAttempts < 1 {
		return ModelRequest{}, fmt.Errorf("turn budget is incomplete")
	}
	if req.MaxTokens > b.MaxOutputTokens {
		return ModelRequest{}, fmt.Errorf("request maxTokens exceeds frozen budget")
	}
	if req.Timeouts.Connect > 0 && b.ConnectTimeout > 0 && req.Timeouts.Connect > b.ConnectTimeout {
		return ModelRequest{}, fmt.Errorf("request connect timeout exceeds frozen budget")
	}
	if req.Timeouts.FirstToken > 0 && b.FirstTokenTimeout > 0 && req.Timeouts.FirstToken > b.FirstTokenTimeout {
		return ModelRequest{}, fmt.Errorf("request first-token timeout exceeds frozen budget")
	}
	if req.Timeouts.Total > 0 && b.TotalTimeout > 0 && req.Timeouts.Total > b.TotalTimeout {
		return ModelRequest{}, fmt.Errorf("request total timeout exceeds frozen budget")
	}
	if req.MaxTokens == 0 {
		req.MaxTokens = b.MaxOutputTokens
	}
	if req.Timeouts.Connect == 0 {
		req.Timeouts.Connect = b.ConnectTimeout
	}
	if req.Timeouts.FirstToken == 0 {
		req.Timeouts.FirstToken = b.FirstTokenTimeout
	}
	if req.Timeouts.Total == 0 {
		req.Timeouts.Total = b.TotalTimeout
	}
	return req, nil
}

func deliveryOf(err error, fallback Delivery) Delivery {
	if pe := AsError(err); pe != nil && pe.Delivery != "" {
		return pe.Delivery
	}
	return fallback
}
