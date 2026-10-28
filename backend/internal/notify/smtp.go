package notify

import (
	"context"
	"crypto/tls"
	"errors"
	"net"
	"strconv"
	"strings"
	"time"

	mail "github.com/wneessen/go-mail"
)

// SMTPConfig is process configuration. An empty host means the channel is
// not configured and Send does not dial. Certificate verification stays on;
// a tls.Config with InsecureSkipVerify is rejected.
type SMTPConfig struct {
	Host     string
	Port     int
	Username string
	Password string
	From     string
	TLS      *tls.Config
	Timeout  time.Duration
}

// SMTP sends one plain-text message over implicit TLS.
type SMTP struct {
	cfg SMTPConfig
}

// NewSMTP rejects a disabled certificate check. It does not dial.
func NewSMTP(cfg SMTPConfig) (*SMTP, error) {
	if cfg.TLS != nil && cfg.TLS.InsecureSkipVerify {
		return nil, errors.New("smtp tls verification must stay enabled")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	return &SMTP{cfg: cfg}, nil
}

// Send reports accepted only after SMTP accepts the data. A break while the
// data writer closes is unknown: the peer may already have the message.
// A 4xx response stays retryable. A 5xx response is a permanent failure.
// The returned result never includes the recipient or the message text.
func (s *SMTP) Send(ctx context.Context, req Request) (Result, error) {
	if s == nil || strings.TrimSpace(s.cfg.Host) == "" {
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
	if s.cfg.TLS != nil && s.cfg.TLS.InsecureSkipVerify {
		return Result{Kind: KindFailed, FailureCode: CodeNotConfigured}, nil
	}
	client, msg, err := s.client(req)
	if err != nil {
		return Result{Kind: KindRetry, FailureCode: CodeSMTPTemporary}, nil
	}
	err = client.DialAndSendWithContext(ctx, msg)
	return classifySMTP(msg, err), nil
}

func (s *SMTP) client(req Request) (*mail.Client, *mail.Msg, error) {
	host := strings.TrimSpace(s.cfg.Host)
	tlsCfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: serverName(host),
	}
	if s.cfg.TLS != nil {
		tlsCfg.RootCAs = s.cfg.TLS.RootCAs
		tlsCfg.ServerName = s.cfg.TLS.ServerName
		if tlsCfg.ServerName == "" {
			tlsCfg.ServerName = serverName(host)
		}
		if s.cfg.TLS.MinVersion > 0 {
			tlsCfg.MinVersion = s.cfg.TLS.MinVersion
		}
	}
	opts := []mail.Option{
		mail.WithPort(s.cfg.Port),
		mail.WithSSL(),
		mail.WithTLSPolicy(mail.TLSMandatory),
		mail.WithTLSConfig(tlsCfg),
		mail.WithTimeout(s.cfg.Timeout),
		mail.WithHELO("localhost"),
	}
	if strings.TrimSpace(s.cfg.Username) != "" {
		opts = append(opts,
			mail.WithSMTPAuth(mail.SMTPAuthPlain),
			mail.WithUsername(s.cfg.Username),
			mail.WithPassword(s.cfg.Password),
		)
	}
	client, err := mail.NewClient(host, opts...)
	if err != nil {
		return nil, nil, err
	}
	msg := mail.NewMsg()
	if err := msg.From(s.cfg.From); err != nil {
		return nil, nil, err
	}
	if err := msg.To(req.Target); err != nil {
		return nil, nil, err
	}
	msg.Subject(req.Subject)
	msg.SetBodyString(mail.TypeTextPlain, req.Text)
	return client, msg, nil
}

func classifySMTP(msg *mail.Msg, err error) Result {
	if msg != nil && msg.IsDelivered() {
		return Result{Kind: KindAccepted}
	}
	var sendErr *mail.SendError
	if msg != nil {
		_ = errors.As(msg.SendError(), &sendErr)
	}
	if sendErr == nil {
		_ = errors.As(err, &sendErr)
	}
	if sendErr == nil {
		return Result{Kind: KindRetry, FailureCode: CodeSMTPTemporary}
	}
	switch sendErr.Reason {
	case mail.ErrSMTPDataClose, mail.ErrWriteContent:
		return Result{Kind: KindUnknown}
	case mail.ErrConnCheck, mail.ErrGetSender, mail.ErrGetRcpts:
		return Result{Kind: KindRetry, FailureCode: CodeSMTPTemporary}
	case mail.ErrSMTPMailFrom, mail.ErrSMTPRcptTo, mail.ErrSMTPData:
		if sendErr.IsTemp() || sendErr.ErrorCode()/100 == 4 {
			return Result{Kind: KindRetry, FailureCode: CodeSMTPTemporary}
		}
		return Result{Kind: KindFailed, FailureCode: CodeSMTPRejected}
	default:
		if sendErr.IsTemp() {
			return Result{Kind: KindRetry, FailureCode: CodeSMTPTemporary}
		}
		return Result{Kind: KindFailed, FailureCode: CodeSMTPRejected}
	}
}

func serverName(host string) string {
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
}

// portFromAddr splits host:port. It exists so tests and the service share one parse.
func portFromAddr(addr string) (string, int, error) {
	host, raw, err := net.SplitHostPort(addr)
	if err != nil {
		return "", 0, err
	}
	port, err := strconv.Atoi(raw)
	if err != nil {
		return "", 0, err
	}
	return host, port, nil
}
