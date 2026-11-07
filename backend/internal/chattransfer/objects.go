// Package chattransfer provides bounded encrypted staging for chat transfers.
package chattransfer

import (
	"context"
	"errors"
	"fmt"
	"io"
)

const ChunkBytes = 1 << 20

// Object keys use exactly eight decimal digits, starting at zero.
const maxChunks = 100000000

// Objects is implemented by the private encrypted blobstore. Put encrypts each
// chunk with the existing FieldCipher; this package never stores plaintext.
type Objects interface {
	Put(context.Context, string, []byte) (int64, error)
	GetLimited(context.Context, string, int64) ([]byte, error)
	Delete(context.Context, string) error
	ListKeys(context.Context, string, string, int) ([]string, error)
}

type Manifest struct {
	Prefix string `json:"prefix"`
	Chunks int    `json:"chunks"`
	Bytes  int64  `json:"bytes"`
}

// Writer buffers at most one chunk. Before its first Write or Seal, the caller
// must durably record a unique, never-reused prefix for interrupted-upload GC.
// This writer never deletes objects or changes database state.
type Writer struct {
	ctx      context.Context
	objects  Objects
	manifest Manifest
	maxBytes int64
	buffer   []byte
	err      error
	sealed   bool
}

// NewWriter uses maxBytes == 0 for an export with no total-size truncation.
func NewWriter(ctx context.Context, objects Objects, prefix string, maxBytes int64) *Writer {
	w := &Writer{ctx: ctx, objects: objects, manifest: Manifest{Prefix: prefix}, maxBytes: maxBytes}
	if ctx == nil || objects == nil || prefix == "" || maxBytes < 0 {
		w.err = errors.New("chat transfer write failed")
	}
	return w
}

func (w *Writer) Write(p []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	if w.sealed {
		return 0, errors.New("chat transfer writer is sealed")
	}
	if err := w.ctx.Err(); err != nil {
		w.err = err
		return 0, err
	}
	// Check the complete call before accepting bytes, including the eight-digit
	// object-key capacity. No caller can receive a successful truncated write.
	if int64(len(p)) > int64(maxChunks)*ChunkBytes-w.manifest.Bytes ||
		(w.maxBytes > 0 && int64(len(p)) > w.maxBytes-w.manifest.Bytes) {
		w.err = errors.New("chat transfer size limit exceeded")
		return 0, w.err
	}
	n := 0
	for len(p) > 0 {
		if w.buffer == nil {
			w.buffer = make([]byte, 0, ChunkBytes)
		}
		copied := min(len(p), ChunkBytes-len(w.buffer))
		w.buffer = append(w.buffer, p[:copied]...)
		w.manifest.Bytes += int64(copied)
		n += copied
		p = p[copied:]
		if len(w.buffer) == ChunkBytes {
			if err := w.flush(); err != nil {
				return n, err
			}
		}
	}
	return n, nil
}

func (w *Writer) flush() error {
	if err := w.ctx.Err(); err != nil {
		w.err = err
		return err
	}
	if _, err := w.objects.Put(w.ctx, chunkKey(w.manifest.Prefix, w.manifest.Chunks), w.buffer); err != nil {
		w.err = errors.New("chat transfer write failed")
		return w.err
	}
	w.manifest.Chunks++
	w.buffer = w.buffer[:0]
	return nil
}

// Seal publishes only a manifest; lifecycle cleanup remains the caller's job.
// Repeated successful seals return the same manifest without writing objects.
func (w *Writer) Seal() (Manifest, error) {
	if w.err != nil {
		return Manifest{}, w.err
	}
	if err := w.ctx.Err(); err != nil {
		w.err = err
		return Manifest{}, err
	}
	if !w.sealed && len(w.buffer) > 0 {
		if err := w.flush(); err != nil {
			return Manifest{}, err
		}
	}
	w.sealed = true
	w.buffer = nil
	return w.manifest, nil
}

type reader struct {
	ctx      context.Context
	objects  Objects
	manifest Manifest
	chunk    int
	buffer   []byte
	err      error
}

// NewReader validates the manifest before loading any objects. Each subsequent
// Read loads at most one chunk and requires its exact expected plaintext size.
func NewReader(ctx context.Context, objects Objects, manifest Manifest) (io.Reader, error) {
	if ctx == nil || objects == nil || manifest.Prefix == "" || manifest.Bytes < 0 || manifest.Chunks < 0 || manifest.Chunks > maxChunks {
		return nil, errors.New("chat transfer manifest is invalid")
	}
	expected := int64(0)
	if manifest.Bytes > 0 {
		expected = (manifest.Bytes-1)/ChunkBytes + 1
	}
	if int64(manifest.Chunks) != expected {
		return nil, errors.New("chat transfer manifest is invalid")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &reader{ctx: ctx, objects: objects, manifest: manifest}, nil
}

func (r *reader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.err != nil {
		return 0, r.err
	}
	if err := r.ctx.Err(); err != nil {
		r.err = err
		return 0, err
	}
	if len(r.buffer) == 0 {
		if r.chunk == r.manifest.Chunks {
			return 0, io.EOF
		}
		size := min(int64(ChunkBytes), r.manifest.Bytes-int64(r.chunk)*ChunkBytes)
		data, err := r.objects.GetLimited(r.ctx, chunkKey(r.manifest.Prefix, r.chunk), size)
		if err != nil || int64(len(data)) != size {
			r.err = errors.New("chat transfer read failed")
			return 0, r.err
		}
		if err := r.ctx.Err(); err != nil {
			r.err = err
			return 0, err
		}
		r.chunk++
		r.buffer = data
	}
	n := copy(p, r.buffer)
	r.buffer = r.buffer[n:]
	return n, nil
}

func chunkKey(prefix string, chunk int) string {
	return fmt.Sprintf("%s%08d.enc", prefix, chunk)
}
