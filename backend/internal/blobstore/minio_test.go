package blobstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"iter"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/minio/minio-go/v7"
)

const testRestKey = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="

type fakeObjectClient struct {
	exists bool
	data   map[string][]byte
	err    error
}

func (f *fakeObjectClient) BucketExists(context.Context, string) (bool, error) {
	return f.exists, f.err
}

func (f *fakeObjectClient) Put(_ context.Context, bucket, key string, body io.Reader, size int64) (int64, error) {
	if f.err != nil {
		return 0, f.err
	}
	data, err := io.ReadAll(body)
	if err != nil {
		return 0, err
	}
	if int64(len(data)) != size {
		return 0, errors.New("wrong size")
	}
	f.data[bucket+"/"+key] = data
	return int64(len(data)), nil
}

func (f *fakeObjectClient) Get(_ context.Context, bucket, key string) (io.ReadCloser, error) {
	if f.err != nil {
		return nil, f.err
	}
	data, ok := f.data[bucket+"/"+key]
	if !ok {
		return nil, errors.New("missing")
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

func (f *fakeObjectClient) Delete(_ context.Context, bucket, key string) error {
	if f.err != nil {
		return f.err
	}
	delete(f.data, bucket+"/"+key)
	return nil
}

func TestStoreEncryptsPutDecryptsGetAndDeletes(t *testing.T) {
	t.Parallel()
	cipher, err := postgres.NewDefaultFieldCipher(testRestKey)
	if err != nil {
		t.Fatal(err)
	}
	client := &fakeObjectClient{exists: true, data: map[string][]byte{}}
	store, err := newStore(context.Background(), client, "exports", cipher)
	if err != nil {
		t.Fatal(err)
	}
	plain := []byte(`{"message":"private export"}`)
	storedBytes, err := store.Put(context.Background(), "exports/7/9-a.json", plain)
	if err != nil {
		t.Fatal(err)
	}
	stored := client.data["exports/exports/7/9-a.json"]
	if storedBytes != int64(len(stored)) || !bytes.HasPrefix(stored, []byte("enc2:default:1:")) {
		t.Fatalf("stored envelope size=%d body=%q", storedBytes, stored)
	}
	if bytes.Contains(stored, plain) {
		t.Fatal("stored object contains plaintext export")
	}
	got, err := store.Get(context.Background(), "exports/7/9-a.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, plain) {
		t.Fatalf("get %q want %q", got, plain)
	}
	if err := store.Delete(context.Background(), "exports/7/9-a.json"); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), "exports/7/9-a.json"); err != nil {
		t.Fatalf("repeat delete must be idempotent: %v", err)
	}
}

func TestStoreFailsClosedWhenBucketUnavailable(t *testing.T) {
	t.Parallel()
	cipher, err := postgres.NewDefaultFieldCipher(testRestKey)
	if err != nil {
		t.Fatal(err)
	}
	_, err = newStore(context.Background(), &fakeObjectClient{data: map[string][]byte{}}, "exports", cipher)
	if err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("expected unavailable bucket error, got %v", err)
	}
}

func TestStoreErrorsDoNotLeakClientDetails(t *testing.T) {
	t.Parallel()
	cipher, err := postgres.NewDefaultFieldCipher(testRestKey)
	if err != nil {
		t.Fatal(err)
	}
	client := &fakeObjectClient{exists: true, data: map[string][]byte{}}
	store, err := newStore(context.Background(), client, "exports", cipher)
	if err != nil {
		t.Fatal(err)
	}
	client.err = errors.New("access-key secret-key https://minio.internal")
	for _, call := range []func() error{
		func() error { _, err := store.Put(context.Background(), "object", []byte("body")); return err },
		func() error { _, err := store.Get(context.Background(), "object"); return err },
		func() error { _, err := store.GetLimited(context.Background(), "object", 100); return err },
		func() error { return store.Delete(context.Background(), "object") },
	} {
		err := call()
		if err == nil {
			t.Fatal("expected operation error")
		}
		if strings.Contains(err.Error(), "access-key") || strings.Contains(err.Error(), "secret-key") || strings.Contains(err.Error(), "minio.internal") {
			t.Fatalf("client details leaked: %v", err)
		}
	}
}

func TestGetLimitedAcceptsExactLimitAndRejectsOtherEnvelopes(t *testing.T) {
	t.Parallel()
	cipher, err := postgres.NewFieldCipherWithPrevious("current", 2, testRestKey, "previous", 1, testRestKey)
	if err != nil {
		t.Fatal(err)
	}
	client := &fakeObjectClient{exists: true, data: map[string][]byte{}}
	store, err := newStore(context.Background(), client, "exports", cipher)
	if err != nil {
		t.Fatal(err)
	}
	previous, _ := postgres.NewFieldCipher("previous", 1, testRestKey)
	envelope, _ := previous.Encrypt("abcd")
	client.data["exports/key"] = []byte(envelope)
	got, err := store.GetLimited(context.Background(), "key", 4)
	if err != nil || string(got) != "abcd" {
		t.Fatalf("exact limit / previous slot: got %q, error %v", got, err)
	}
	if _, err := store.GetLimited(context.Background(), "key", 3); err == nil {
		t.Fatal("oversized plaintext accepted")
	}
	for _, data := range []string{"abcd", "", "enc1:legacy", "enc2:malformed"} {
		client.data["exports/key"] = []byte(data)
		if _, err := store.GetLimited(context.Background(), "key", 4); err == nil {
			t.Fatalf("accepted invalid envelope %q", data)
		}
	}
	empty, _ := cipher.Encrypt("")
	client.data["exports/key"] = []byte(empty)
	if got, err := store.GetLimited(context.Background(), "key", 0); err != nil || len(got) != 0 {
		t.Fatalf("empty encrypted object: %q, %v", got, err)
	}
}

type endlessObject struct {
	read   int64
	closed bool
	cancel context.CancelFunc
}

func (r *endlessObject) Read(p []byte) (int, error) {
	clear(p)
	r.read += int64(len(p))
	if r.cancel != nil {
		r.cancel()
	}
	return len(p), nil
}

func (r *endlessObject) Close() error { r.closed = true; return nil }

type streamingObjectClient struct {
	*fakeObjectClient
	body io.ReadCloser
}

func (c *streamingObjectClient) Get(context.Context, string, string) (io.ReadCloser, error) {
	return c.body, nil
}

func TestGetLimitedBoundsReadsAndClosesOnOversizeOrCancellation(t *testing.T) {
	t.Parallel()
	cipher, _ := postgres.NewDefaultFieldCipher(testRestKey)
	for _, cancelDuringRead := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		body := &endlessObject{}
		if cancelDuringRead {
			body.cancel = cancel
		}
		store, err := newStore(ctx, &streamingObjectClient{fakeObjectClient: &fakeObjectClient{exists: true}, body: body}, "exports", cipher)
		if err != nil {
			t.Fatal(err)
		}
		const maxPlain = 1 << 20
		if _, err := store.GetLimited(ctx, "private-path", maxPlain); err == nil || err.Error() != "export object get failed" {
			t.Fatalf("expected fixed bounded-read error, got %v", err)
		}
		const maxRead = 5 + 32 + 1 + 19 + 1 + (maxPlain+28+2)/3*4 + 1
		if body.read > maxRead || !body.closed {
			t.Fatalf("read=%d (max=%d), closed=%v", body.read, maxRead, body.closed)
		}
		cancel()
	}
}

type listingObjectClient struct {
	*fakeObjectClient
	entries []minio.ObjectInfo
	opts    minio.ListObjectsOptions
	ctx     context.Context
	yielded int
	stopped bool
	cancel  context.CancelFunc
}

func (c *listingObjectClient) ListObjects(ctx context.Context, _ string, opts minio.ListObjectsOptions) iter.Seq[minio.ObjectInfo] {
	c.ctx, c.opts = ctx, opts
	return func(yield func(minio.ObjectInfo) bool) {
		defer func() { c.stopped = true }()
		for _, entry := range c.entries {
			if c.cancel != nil {
				c.cancel()
			}
			c.yielded++
			if !yield(entry) {
				return
			}
		}
	}
}

func TestListKeysBoundsAndCancelsUnderlyingIterator(t *testing.T) {
	t.Parallel()
	cipher, _ := postgres.NewDefaultFieldCipher(testRestKey)
	client := &listingObjectClient{fakeObjectClient: &fakeObjectClient{exists: true}, entries: []minio.ObjectInfo{
		{Key: "owned/00000001.enc"}, {Key: "owned/00000002.enc"}, {Key: "owned/00000003.enc"},
	}}
	store, _ := newStore(context.Background(), client, "exports", cipher)
	keys, err := store.ListKeys(context.Background(), "owned/", "owned/00000000.enc", 2)
	if err != nil || len(keys) != 2 || keys[1] != "owned/00000002.enc" {
		t.Fatalf("keys=%v error=%v", keys, err)
	}
	if client.opts.Prefix != "owned/" || client.opts.StartAfter != "owned/00000000.enc" || !client.opts.Recursive || client.opts.MaxKeys != 2 {
		t.Fatalf("incorrect SDK options: %+v", client.opts)
	}
	if !client.stopped || client.yielded != 2 || client.ctx.Err() != context.Canceled {
		t.Fatalf("iterator not canceled: stopped=%v yielded=%d ctx=%v", client.stopped, client.yielded, client.ctx.Err())
	}
	for _, limit := range []int{0, -1, 257} {
		if _, err := store.ListKeys(context.Background(), "owned/", "", limit); err == nil {
			t.Fatalf("invalid limit %d accepted", limit)
		}
	}
	client.entries = make([]minio.ObjectInfo, 256)
	for i := range client.entries {
		client.entries[i].Key = fmt.Sprintf("owned/%08d.enc", i)
	}
	if keys, err := store.ListKeys(context.Background(), "owned/", "", 256); err != nil || len(keys) != 256 {
		t.Fatalf("max listing: length=%d, error=%v", len(keys), err)
	}
}

func TestListKeysFailsClosedOnWrongPrefixCursorOrderErrorsAndCancellation(t *testing.T) {
	t.Parallel()
	cipher, _ := postgres.NewDefaultFieldCipher(testRestKey)
	for _, entries := range [][]minio.ObjectInfo{
		{{Key: "other/private"}}, {{Key: "owned/0"}},
		{{Key: "owned/2"}, {Key: "owned/1"}},
		{{Err: errors.New("secret-token/private-path")}},
	} {
		client := &listingObjectClient{fakeObjectClient: &fakeObjectClient{exists: true}, entries: entries}
		store, _ := newStore(context.Background(), client, "exports", cipher)
		if _, err := store.ListKeys(context.Background(), "owned/", "owned/0", 256); err == nil || err.Error() != "export object list failed" {
			t.Fatalf("expected fixed list error, got %v", err)
		}
		if !client.stopped || client.ctx.Err() != context.Canceled {
			t.Fatal("error did not stop and cancel iterator")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	client := &listingObjectClient{fakeObjectClient: &fakeObjectClient{exists: true}, entries: []minio.ObjectInfo{{Key: "owned/1"}}, cancel: cancel}
	store, _ := newStore(ctx, client, "exports", cipher)
	if _, err := store.ListKeys(ctx, "owned/", "", 1); err == nil {
		t.Fatal("cancellation accepted as a successful listing")
	}
}
