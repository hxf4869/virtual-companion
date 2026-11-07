package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"time"

	"github.com/hxf4869/virtual-companion/internal/chatjsonl"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	chatTransferHTTPTimeout = 150 * time.Second
	chatTransferFieldsBytes = 8 << 20
	chatTransferBodyBytes   = chatjsonl.MaxFileBytes + chatTransferFieldsBytes
)

// The mux type selects the transfer-specific body and transport budgets.
// Authentication still happens before an upload intent or object is created.
type chatTransferHandler struct{ http.HandlerFunc }

type chatMultipartUpload struct {
	Fields   map[string]string
	Manifest chattransfer.Manifest
	SHA256   string
}

type countedChatReader struct {
	reader io.Reader
	bytes  int64
}

type chatUploadWriter struct {
	io.Writer
	err error
}

func (w *chatUploadWriter) Write(p []byte) (int, error) {
	n, err := w.Writer.Write(p)
	if err != nil {
		w.err = err
	}
	return n, err
}

func (r *countedChatReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	r.bytes += int64(n)
	return n, err
}

func chatTransferTooLarge() error { return &postgres.ChatError{Code: "CHAT_PAYLOAD_TOO_LARGE"} }

// readChatMultipart accepts fields in any order. The authenticated caller has
// already persisted prefix as an upload intent; an incomplete object set is
// therefore recoverable without trusting a client-supplied filename or path.
func readChatMultipart(ctx context.Context, req *http.Request, objects chattransfer.Objects, prefix string, allowed map[string]bool) (chatMultipartUpload, error) {
	out := chatMultipartUpload{Fields: map[string]string{}}
	typeName, params, err := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if err != nil || typeName != "multipart/form-data" || params["boundary"] == "" {
		return out, postgres.ErrInvalid
	}
	if req.ContentLength > chatTransferBodyBytes {
		return out, chatTransferTooLarge()
	}
	raw := &countedChatReader{reader: &io.LimitedReader{R: req.Body, N: chatTransferBodyBytes + 1}}
	parts := multipart.NewReader(raw, params["boundary"])
	fileSeen, fileBytes, valueBytes := false, int64(0), int64(0)
	for {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		part, err := parts.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return out, chatMultipartError(ctx, err, raw.bytes-fileBytes)
		}
		name := part.FormName()
		if name == "file" {
			if fileSeen {
				return out, postgres.ErrInvalid
			}
			fileSeen = true
			// Accept one extra byte to detect overflow rather than truncate it.
			writer := chattransfer.NewWriter(ctx, objects, prefix, 0)
			storage := &chatUploadWriter{Writer: writer}
			digest := sha256.New()
			n, err := io.CopyBuffer(io.MultiWriter(storage, digest), io.LimitReader(part, chatjsonl.MaxFileBytes+1), make([]byte, 32<<10))
			fileBytes = n
			if n > chatjsonl.MaxFileBytes {
				return out, chatTransferTooLarge()
			}
			if err != nil {
				if storage.err != nil {
					return out, storage.err
				}
				return out, chatMultipartError(ctx, err, raw.bytes-fileBytes)
			}
			out.Manifest, err = writer.Seal()
			if err != nil {
				return out, err
			}
			out.SHA256 = hex.EncodeToString(digest.Sum(nil))
		} else {
			if !allowed[name] || part.FileName() != "" {
				return out, postgres.ErrInvalid
			}
			if _, exists := out.Fields[name]; exists {
				return out, postgres.ErrInvalid
			}
			value, err := io.ReadAll(io.LimitReader(part, chatTransferFieldsBytes-valueBytes+1))
			valueBytes += int64(len(value))
			if valueBytes > chatTransferFieldsBytes {
				return out, chatTransferTooLarge()
			}
			if err != nil {
				return out, chatMultipartError(ctx, err, raw.bytes-fileBytes)
			}
			out.Fields[name] = string(value)
		}
		if err := part.Close(); err != nil {
			return out, chatMultipartError(ctx, err, raw.bytes-fileBytes)
		}
	}
	// Include the multipart epilogue and parser read-ahead in the overhead cap.
	if _, err := io.Copy(io.Discard, raw); err != nil {
		return out, chatMultipartError(ctx, err, raw.bytes-fileBytes)
	}
	if raw.bytes > chatTransferBodyBytes || raw.bytes-fileBytes > chatTransferFieldsBytes {
		return out, chatTransferTooLarge()
	}
	if !fileSeen {
		return out, postgres.ErrInvalid
	}
	return out, ctx.Err()
}

func chatMultipartError(ctx context.Context, err error, overhead int64) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var limit *http.MaxBytesError
	if overhead > chatTransferFieldsBytes || errors.As(err, &limit) {
		return chatTransferTooLarge()
	}
	var timeout net.Error
	if errors.As(err, &timeout) && timeout.Timeout() {
		return &postgres.ChatError{Code: "CHAT_TRANSFER_TIMEOUT"}
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, multipart.ErrMessageTooLarge) {
		return postgres.ErrInvalid
	}
	return postgres.ErrInvalid
}

func withChatTransferDeadline(next http.HandlerFunc) chatTransferHandler {
	return chatTransferHandler{func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), chatTransferHTTPTimeout)
		defer cancel()
		deadline, _ := ctx.Deadline()
		controller := http.NewResponseController(w)
		// Override only this route's ordinary 15s request-body transport budget.
		// Recorders without transport controls return ErrNotSupported in tests.
		_ = controller.SetReadDeadline(deadline)
		_ = controller.SetWriteDeadline(deadline)
		next(w, r.WithContext(ctx))
	}}
}
