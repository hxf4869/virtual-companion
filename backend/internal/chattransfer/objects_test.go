package chattransfer

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
)

type memoryObjects struct {
	data      map[string][]byte
	puts      int
	gets      int
	maxGet    int64
	putFailAt int
	getErr    error
	ignoreMax bool
}

func (m *memoryObjects) Put(ctx context.Context, key string, data []byte) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	m.puts++
	if m.puts == m.putFailAt {
		return 0, errors.New("private-prefix secret-token")
	}
	if len(data) > ChunkBytes {
		return 0, errors.New("chunk too large")
	}
	if m.data == nil {
		m.data = make(map[string][]byte)
	}
	m.data[key] = bytes.Clone(data)
	return int64(len(data)), nil
}

func (m *memoryObjects) GetLimited(ctx context.Context, key string, max int64) ([]byte, error) {
	m.gets++
	m.maxGet = max
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if m.getErr != nil {
		return nil, m.getErr
	}
	data, ok := m.data[key]
	if !ok || (!m.ignoreMax && int64(len(data)) > max) {
		return nil, errors.New("private-prefix object missing or too large")
	}
	return bytes.Clone(data), nil
}

func (m *memoryObjects) Delete(context.Context, string) error { return nil }
func (m *memoryObjects) ListKeys(context.Context, string, string, int) ([]string, error) {
	return nil, nil
}

// Keep only sizes for the large fixture; neither its input nor its output is
// ever accumulated as a complete file in the test process.
type generatedObjects struct {
	memoryObjects
	sizes map[string]int
}

func (g *generatedObjects) Put(_ context.Context, key string, data []byte) (int64, error) {
	if len(data) > ChunkBytes || bytes.Count(data, []byte{0x7f}) != len(data) {
		return 0, errors.New("invalid generated chunk")
	}
	g.sizes[key] = len(data)
	return int64(len(data)), nil
}

func (g *generatedObjects) GetLimited(_ context.Context, key string, max int64) ([]byte, error) {
	size, ok := g.sizes[key]
	if !ok || int64(size) > max || max > ChunkBytes {
		return nil, errors.New("invalid generated chunk read")
	}
	return bytes.Repeat([]byte{0x7f}, size), nil
}

func TestLargeTransferStreamsAtExactMaximumWithoutWholeFileFixture(t *testing.T) {
	const size int64 = 50*ChunkBytes + 17
	objects := &generatedObjects{sizes: make(map[string]int)}
	w := NewWriter(context.Background(), objects, "large/", size)
	block := bytes.Repeat([]byte{0x7f}, 32*1024)
	for remaining := size; remaining > 0; {
		n := min(remaining, int64(len(block)))
		if written, err := w.Write(block[:n]); err != nil || int64(written) != n {
			t.Fatalf("write=%d, error=%v", written, err)
		}
		remaining -= n
	}
	manifest, err := w.Seal()
	if err != nil || manifest.Bytes != size || manifest.Chunks != 51 {
		t.Fatalf("manifest=%+v, error=%v", manifest, err)
	}
	r, err := NewReader(context.Background(), objects, manifest)
	if err != nil {
		t.Fatal(err)
	}
	if read, err := io.Copy(io.Discard, r); err != nil || read != size {
		t.Fatalf("read=%d, error=%v", read, err)
	}
}

func TestWriterReaderChunkBoundaries(t *testing.T) {
	t.Parallel()
	for _, size := range []int{0, 1, ChunkBytes - 1, ChunkBytes, ChunkBytes + 1, 2*ChunkBytes + 17} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			objects := &memoryObjects{}
			w := NewWriter(context.Background(), objects, "unique/", int64(size))
			// Repeated small writes cross chunk boundaries without constructing
			// a second full-file fixture in memory.
			block := bytes.Repeat([]byte{0xe4, 0xbd, 0xa0}, 997)
			for remaining := size; remaining > 0; {
				n := min(remaining, len(block))
				if got, err := w.Write(block[:n]); err != nil || got != n {
					t.Fatalf("write=%d/%d error=%v", got, n, err)
				}
				remaining -= n
			}
			manifest, err := w.Seal()
			if err != nil || manifest.Bytes != int64(size) || manifest.Chunks != (size+ChunkBytes-1)/ChunkBytes {
				t.Fatalf("manifest=%+v error=%v", manifest, err)
			}
			for chunk := 0; chunk < manifest.Chunks; chunk++ {
				key := fmt.Sprintf("unique/%08d.enc", chunk)
				want := min(ChunkBytes, size-chunk*ChunkBytes)
				if len(objects.data[key]) != want {
					t.Fatalf("chunk=%d size=%d want=%d", chunk, len(objects.data[key]), want)
				}
			}
			again, err := w.Seal()
			if err != nil || again != manifest || objects.puts != manifest.Chunks {
				t.Fatal("Seal must be idempotent")
			}
			if _, err := w.Write([]byte("after seal")); err == nil {
				t.Fatal("write after Seal accepted")
			}
			r, err := NewReader(context.Background(), objects, manifest)
			if err != nil || objects.gets != 0 {
				t.Fatalf("constructor eagerly loaded objects: %v", err)
			}
			readBuffer := make([]byte, 1931)
			for position := 0; ; {
				n, err := r.Read(readBuffer)
				for i, value := range readBuffer[:n] {
					// Each Write restarts its block, including the final short one.
					want := block[((position + i) % len(block))]
					if value != want {
						t.Fatalf("byte mismatch at %d", position+i)
					}
				}
				position += n
				if err == io.EOF {
					if position != size {
						t.Fatalf("read=%d want=%d", position, size)
					}
					break
				}
				if err != nil {
					t.Fatal(err)
				}
			}
			if objects.gets != manifest.Chunks || objects.maxGet > ChunkBytes {
				t.Fatalf("gets=%d max=%d", objects.gets, objects.maxGet)
			}
		})
	}
}

func TestWriterLimitAndPutFailureNeverSealPartialSuccess(t *testing.T) {
	t.Parallel()
	objects := &memoryObjects{}
	w := NewWriter(context.Background(), objects, "limited/", 5)
	if n, err := w.Write([]byte("12345")); n != 5 || err != nil {
		t.Fatalf("exact maximum: n=%d error=%v", n, err)
	}
	if n, err := w.Write([]byte("6")); n != 0 || err == nil {
		t.Fatalf("over maximum: n=%d error=%v", n, err)
	}
	if _, err := w.Seal(); err == nil || objects.puts != 0 {
		t.Fatal("oversize writer sealed partial data")
	}
	for _, failAt := range []int{1, 2} {
		objects := &memoryObjects{putFailAt: failAt}
		w := NewWriter(context.Background(), objects, "failed/", 0)
		_, writeErr := w.Write(make([]byte, ChunkBytes))
		if failAt == 2 {
			if writeErr != nil {
				t.Fatal(writeErr)
			}
			_, writeErr = w.Write([]byte{1})
		}
		if _, err := w.Seal(); err == nil || err.Error() != "chat transfer write failed" {
			t.Fatalf("put failure was not sticky: %v", err)
		}
		if _, err := w.Seal(); err == nil || objects.puts != failAt {
			t.Fatal("failed Seal retried or succeeded")
		}
		if _, err := w.Write([]byte{2}); err == nil {
			t.Fatal("failed writer resumed")
		}
		// Successful chunks remain available for the durable-intent GC owner.
		if len(objects.data) != failAt-1 {
			t.Fatal("writer unexpectedly deleted chunks")
		}
	}
}

func TestReaderRejectsInvalidManifestAndWrongChunkLengths(t *testing.T) {
	t.Parallel()
	for _, manifest := range []Manifest{
		{}, {Prefix: "p/", Bytes: -1}, {Prefix: "p/", Chunks: -1},
		{Prefix: "p/", Bytes: 1}, {Prefix: "p/", Chunks: 1},
		{Prefix: "p/", Chunks: 1, Bytes: ChunkBytes + 1},
		{Prefix: "p/", Chunks: maxChunks + 1, Bytes: int64(maxChunks+1) * ChunkBytes},
	} {
		if _, err := NewReader(context.Background(), &memoryObjects{}, manifest); err == nil {
			t.Fatalf("accepted manifest %+v", manifest)
		}
	}
	for _, data := range [][]byte{nil, {}, {1}, {1, 2, 3}} {
		objects := &memoryObjects{data: map[string][]byte{}, ignoreMax: true}
		if data != nil {
			objects.data["p/00000000.enc"] = data
		}
		r, err := NewReader(context.Background(), objects, Manifest{Prefix: "p/", Chunks: 1, Bytes: 2})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := r.Read(make([]byte, 8)); err == nil || err.Error() != "chat transfer read failed" {
			t.Fatalf("accepted missing/short/extra bytes: %v", err)
		}
		if _, err := r.Read(make([]byte, 8)); err == nil || objects.gets != 1 {
			t.Fatal("reader retried after corrupt chunk")
		}
	}
	objects := &memoryObjects{data: map[string][]byte{"p/00000000.enc": make([]byte, ChunkBytes-1)}}
	r, _ := NewReader(context.Background(), objects, Manifest{Prefix: "p/", Chunks: 2, Bytes: ChunkBytes + 1})
	if _, err := r.Read(make([]byte, 1)); err == nil {
		t.Fatal("short non-final chunk accepted")
	}
}

func TestTransferCancellation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	objects := &memoryObjects{}
	w := NewWriter(ctx, objects, "canceled/", 0)
	_, _ = w.Write([]byte("buffered"))
	cancel()
	if _, err := w.Seal(); !errors.Is(err, context.Canceled) || objects.puts != 0 {
		t.Fatalf("seal ignored cancellation: %v", err)
	}
	if _, err := w.Write([]byte("more")); !errors.Is(err, context.Canceled) {
		t.Fatalf("write ignored cancellation: %v", err)
	}
	if _, err := NewReader(ctx, objects, Manifest{Prefix: "canceled/"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("constructor ignored cancellation: %v", err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	objects = &memoryObjects{data: map[string][]byte{"p/00000000.enc": {1, 2}}}
	r, _ := NewReader(ctx, objects, Manifest{Prefix: "p/", Chunks: 1, Bytes: 2})
	if n, err := r.Read(make([]byte, 1)); n != 1 || err != nil {
		t.Fatal("first read failed")
	}
	cancel()
	if _, err := r.Read(make([]byte, 1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("buffered read ignored cancellation: %v", err)
	}
}
