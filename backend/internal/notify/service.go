package notify

import (
	"context"
	"time"
)

// DefaultSendTimeout is the limit of one channel send when the caller does
// not set one. NewSMTP applies it when SMTPConfig.Timeout is unset.
// NewFeishu applies it when FeishuConfig.HTTP is nil. companiond leaves
// both unset, so email and Feishu share this bound.
const DefaultSendTimeout = 10 * time.Second

// Sender delivers one already reviewed notification.
type Sender interface {
	Send(ctx context.Context, req Request) (Result, error)
}

// Service routes a delivery to the configured email or Feishu channel.
// A channel with no process configuration is not dialed.
type Service struct {
	smtp   *SMTP
	feishu *Feishu
}

// NewService builds both channels. SMTP construction rejects a TLS config
// that turns certificate verification off.
func NewService(smtp SMTPConfig, feishu FeishuConfig) (*Service, error) {
	mailer, err := NewSMTP(smtp)
	if err != nil {
		return nil, err
	}
	return &Service{smtp: mailer, feishu: NewFeishu(feishu)}, nil
}

// Send dispatches one channel. The text is sent as given; the caller reviews it.
func (s *Service) Send(ctx context.Context, req Request) (Result, error) {
	if s == nil {
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
	switch req.Channel {
	case "EMAIL":
		return s.smtp.Send(ctx, req)
	case "FEISHU":
		return s.feishu.Send(ctx, req)
	default:
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
}
