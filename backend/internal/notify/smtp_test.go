package notify

import (
	"bufio"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"io"
	"math/big"
	"mime/quotedprintable"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

type smtpScript int

const (
	smtpAccept smtpScript = iota
	smtpReject
	smtpTemp
	smtpDrop
)

func TestSMTPAcceptRejectTempAndUnknown(t *testing.T) {
	cases := []struct {
		name string
		mode smtpScript
		kind string
		code string
	}{
		{name: "accept", mode: smtpAccept, kind: KindAccepted},
		{name: "reject", mode: smtpReject, kind: KindFailed, code: CodeSMTPRejected},
		{name: "temp", mode: smtpTemp, kind: KindRetry, code: CodeSMTPTemporary},
		{name: "unknown", mode: smtpDrop, kind: KindUnknown},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			addr, captured, clientTLS := startSMTP(t, tc.mode)
			host, port, err := portFromAddr(addr)
			if err != nil {
				t.Fatal(err)
			}
			sender, err := NewSMTP(SMTPConfig{
				Host: host,
				Port: port,
				From: "notify@example.test",
				TLS:  clientTLS,
			})
			if err != nil {
				t.Fatal(err)
			}
			result, err := sender.Send(context.Background(), Request{
				Channel:    "EMAIL",
				Target:     "owner@example.test",
				Subject:    Title,
				Text:       Title + "\n" + LoginHint,
				DeliveryID: 7,
			})
			if err != nil {
				t.Fatal(err)
			}
			if result.Kind != tc.kind || result.FailureCode != tc.code {
				t.Fatalf("result = %+v", result)
			}
			if strings.Contains(result.Correlation, "owner@example.test") || strings.Contains(result.FailureCode, "@") {
				t.Fatalf("result leaked an address: %+v", result)
			}
			body := captured()
			if tc.mode == smtpAccept {
				decoded, err := io.ReadAll(quotedprintable.NewReader(strings.NewReader(body)))
				if err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(string(decoded), Title) || !strings.Contains(body, "owner@example.test") {
					t.Fatalf("captured message = %q", body)
				}
			}
			if tc.mode == smtpDrop && !strings.Contains(body, "DATA") {
				t.Fatal("response was lost before the message was written")
			}
		})
	}
}

func TestSMTPRejectsInsecureSkipVerify(t *testing.T) {
	_, err := NewSMTP(SMTPConfig{
		Host: "127.0.0.1",
		Port: 1,
		From: "notify@example.test",
		TLS:  &tls.Config{InsecureSkipVerify: true},
	})
	if err == nil {
		t.Fatal("insecure tls config was accepted")
	}
}

func TestSMTPVerificationStaysOn(t *testing.T) {
	addr, captured, _ := startSMTP(t, smtpAccept)
	host, port, err := portFromAddr(addr)
	if err != nil {
		t.Fatal(err)
	}
	sender, err := NewSMTP(SMTPConfig{
		Host:    host,
		Port:    port,
		From:    "notify@example.test",
		Timeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := sender.Send(context.Background(), Request{
		Target:  "owner@example.test",
		Subject: Title,
		Text:    Title,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind == KindAccepted {
		t.Fatal("untrusted certificate was accepted")
	}
	if strings.Contains(captured(), "Subject:") {
		t.Fatal("message was written without a trusted certificate")
	}
}

func TestSMTPEmptyHostDoesNotDial(t *testing.T) {
	sender, err := NewSMTP(SMTPConfig{})
	if err != nil {
		t.Fatal(err)
	}
	result, err := sender.Send(context.Background(), Request{Target: "owner@example.test", Text: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Kind != KindFailed || result.FailureCode != CodeNotConfigured {
		t.Fatalf("result = %+v", result)
	}
}

func startSMTP(t *testing.T, mode smtpScript) (string, func() string, *tls.Config) {
	t.Helper()
	serverTLS, clientTLS := testCerts(t)
	ln, err := tls.Listen("tcp", "127.0.0.1:0", serverTLS)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	cap := &smtpCapture{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		serveSMTP(conn, mode, cap)
	}()
	t.Cleanup(func() {
		_ = ln.Close()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
		}
	})
	return ln.Addr().String(), cap.String, clientTLS
}

type smtpCapture struct {
	mu sync.Mutex
	b  strings.Builder
}

func (c *smtpCapture) add(line string) {
	c.mu.Lock()
	c.b.WriteString(line)
	c.mu.Unlock()
}

func (c *smtpCapture) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.b.String()
}

func serveSMTP(conn net.Conn, mode smtpScript, got *smtpCapture) {
	rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
	if _, err := rw.WriteString("220 localhost ready\r\n"); err != nil {
		return
	}
	if err := rw.Flush(); err != nil {
		return
	}
	for {
		line, err := rw.ReadString('\n')
		if err != nil {
			return
		}
		got.add(line)
		cmd := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
			if writeSMTP(rw, "250 localhost\r\n") != nil {
				return
			}
		case strings.HasPrefix(cmd, "NOOP"), strings.HasPrefix(cmd, "RSET"), strings.HasPrefix(cmd, "MAIL FROM"):
			if writeSMTP(rw, "250 OK\r\n") != nil {
				return
			}
		case strings.HasPrefix(cmd, "RCPT TO"):
			reply := "250 OK\r\n"
			if mode == smtpReject {
				reply = "550 rejected\r\n"
			}
			if mode == smtpTemp {
				reply = "451 temporary\r\n"
			}
			if writeSMTP(rw, reply) != nil {
				return
			}
		case cmd == "DATA":
			if writeSMTP(rw, "354 end\r\n") != nil {
				return
			}
			for {
				data, err := rw.ReadString('\n')
				if err != nil {
					return
				}
				got.add(data)
				if strings.TrimRight(data, "\r\n") == "." {
					break
				}
			}
			if mode == smtpDrop {
				_ = conn.Close()
				return
			}
			if writeSMTP(rw, "250 OK\r\n") != nil {
				return
			}
		case strings.HasPrefix(cmd, "QUIT"):
			_ = writeSMTP(rw, "221 bye\r\n")
			return
		default:
			if writeSMTP(rw, "250 OK\r\n") != nil {
				return
			}
		}
	}
}

func writeSMTP(rw *bufio.ReadWriter, line string) error {
	if _, err := rw.WriteString(line); err != nil {
		return err
	}
	return rw.Flush()
}

func testCerts(t *testing.T) (server, client *tls.Config) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		DNSNames:     []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	server = &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
	}
	client = &tls.Config{
		MinVersion: tls.VersionTLS12,
		ServerName: "127.0.0.1",
		RootCAs:    pool,
	}
	return server, client
}
