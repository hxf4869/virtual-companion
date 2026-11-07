package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

type uploadTestObjects struct {
	data map[string][]byte
	err  error
}

func (o *uploadTestObjects) Put(_ context.Context, key string, body []byte) (int64, error) {
	if o.err != nil {
		return 0, o.err
	}
	if o.data == nil {
		o.data = map[string][]byte{}
	}
	o.data[key] = bytes.Clone(body)
	return int64(len(body)), nil
}
func (o *uploadTestObjects) GetLimited(_ context.Context, key string, _ int64) ([]byte, error) {
	return o.data[key], o.err
}
func (o *uploadTestObjects) Delete(_ context.Context, key string) error {
	delete(o.data, key)
	return o.err
}
func (o *uploadTestObjects) ListKeys(context.Context, string, string, int) ([]string, error) {
	return nil, o.err
}

func TestChatTransferMultipartFileFirstAndDigestIgnoreTransport(t *testing.T) {
	file := "{\"chat_metadata\":{}}\r\n{\"mes\":\"synthetic\"}\n"
	digest := sha256.Sum256([]byte(file))
	for _, name := range []string{"synthetic.jsonl", "ignored.bin"} {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, err := form.CreateFormFile("file", name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.WriteString(part, file)
		_ = form.WriteField("requestId", "synthetic-request")
		_ = form.Close()
		req := httptest.NewRequest("POST", "/", &body)
		req.Header.Set("Content-Type", form.FormDataContentType())
		objects := &uploadTestObjects{}
		out, err := readChatMultipart(t.Context(), req, objects, "owned-prefix/", map[string]bool{"requestId": true})
		if err != nil {
			t.Fatal(err)
		}
		if out.SHA256 != hex.EncodeToString(digest[:]) || out.Fields["requestId"] != "synthetic-request" {
			t.Fatal("file digest or late multipart field changed")
		}
		reader, err := chattransfer.NewReader(t.Context(), objects, out.Manifest)
		if err != nil {
			t.Fatal(err)
		}
		actual, err := io.ReadAll(reader)
		if err != nil || string(actual) != file {
			t.Fatalf("staged file mismatch: %v", err)
		}
	}
}

func TestChatTransferMultipartRejectsInvalidEnvelope(t *testing.T) {
	for _, scenario := range []string{"duplicate-file", "duplicate-field", "unknown-field", "missing-file", "truncated", "field-limit", "overhead-limit"} {
		t.Run(scenario, func(t *testing.T) {
			var body bytes.Buffer
			form := multipart.NewWriter(&body)
			if scenario != "missing-file" {
				part, _ := form.CreateFormFile("file", "unused.jsonl")
				_, _ = io.WriteString(part, "{}\n")
			}
			_ = form.WriteField("requestId", "synthetic")
			switch scenario {
			case "duplicate-file":
				part, _ := form.CreateFormFile("file", "another.jsonl")
				_, _ = io.WriteString(part, "{}\n")
			case "duplicate-field":
				_ = form.WriteField("requestId", "second")
			case "unknown-field":
				_ = form.WriteField("unknown", "synthetic")
			case "field-limit":
				_ = form.WriteField("value", strings.Repeat("x", chatTransferFieldsBytes))
			}
			if scenario != "truncated" {
				_ = form.Close()
			}
			if scenario == "overhead-limit" {
				_, _ = io.WriteString(&body, strings.Repeat("x", chatTransferFieldsBytes))
			}
			req := httptest.NewRequest("POST", "/", &body)
			req.Header.Set("Content-Type", form.FormDataContentType())
			_, err := readChatMultipart(t.Context(), req, &uploadTestObjects{}, "owned/", map[string]bool{"requestId": true, "value": true})
			if scenario == "field-limit" || scenario == "overhead-limit" {
				var code *postgres.ChatError
				if !errors.As(err, &code) || code.Code != "CHAT_PAYLOAD_TOO_LARGE" {
					t.Fatalf("limit error=%v", err)
				}
			} else if !errors.Is(err, postgres.ErrInvalid) {
				t.Fatalf("invalid multipart error=%v", err)
			}
		})
	}
}

func TestChatTransferMultipartStorageFailureIsNotInputFailure(t *testing.T) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "unused")
	_, _ = io.WriteString(part, strings.Repeat("x", chattransfer.ChunkBytes))
	_ = form.Close()
	req := httptest.NewRequest("POST", "/", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	_, err := readChatMultipart(t.Context(), req, &uploadTestObjects{err: errors.New("synthetic store unavailable")}, "owned/", nil)
	if err == nil || errors.Is(err, postgres.ErrInvalid) {
		t.Fatalf("object failure error=%v", err)
	}
}
