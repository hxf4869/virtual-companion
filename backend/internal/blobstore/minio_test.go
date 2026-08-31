package blobstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
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
