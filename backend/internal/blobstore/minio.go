package blobstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/url"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Config is the fixed private MinIO target used for export objects.
type Config struct {
	Endpoint  string
	AccessKey string
	SecretKey string
	Bucket    string
}

// Store encrypts export bodies with the runtime FieldCipher before handing
// them to MinIO. It intentionally implements only the three operations used by
// the jobs and HTTP export paths.
type Store struct {
	client objectClient
	bucket string
	cipher *postgres.FieldCipher
}

type objectClient interface {
	BucketExists(context.Context, string) (bool, error)
	Put(context.Context, string, string, io.Reader, int64) (int64, error)
	Get(context.Context, string, string) (io.ReadCloser, error)
	Delete(context.Context, string, string) error
}

type minioClient struct{ client *minio.Client }

// New constructs the concrete MinIO adapter and verifies that minio-init has
// already created the private bucket. Runtime never creates buckets or policy.
func New(ctx context.Context, cfg Config, cipher *postgres.FieldCipher) (*Store, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if cipher == nil || strings.TrimSpace(cfg.Endpoint) == "" ||
		strings.TrimSpace(cfg.AccessKey) == "" || strings.TrimSpace(cfg.SecretKey) == "" ||
		strings.TrimSpace(cfg.Bucket) == "" {
		return nil, errors.New("export object store configuration is invalid")
	}
	u, err := url.Parse(cfg.Endpoint)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, errors.New("export object store configuration is invalid")
	}
	client, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https",
	})
	if err != nil {
		return nil, errors.New("export object store configuration is invalid")
	}
	return newStore(ctx, minioClient{client: client}, cfg.Bucket, cipher)
}

func newStore(ctx context.Context, client objectClient, bucket string, cipher *postgres.FieldCipher) (*Store, error) {
	if client == nil || cipher == nil || strings.TrimSpace(bucket) == "" {
		return nil, errors.New("export object store configuration is invalid")
	}
	ok, err := client.BucketExists(ctx, bucket)
	if err != nil || !ok {
		return nil, errors.New("export object store bucket is unavailable")
	}
	return &Store{client: client, bucket: bucket, cipher: cipher}, nil
}

// Put returns the exact encrypted envelope size stored in MinIO.
func (s *Store) Put(ctx context.Context, key string, data []byte) (int64, error) {
	if s == nil || s.client == nil || s.cipher == nil {
		return 0, errors.New("export object put failed")
	}
	envelope, err := s.cipher.Encrypt(string(data))
	if err != nil {
		return 0, errors.New("export object put failed")
	}
	stored := []byte(envelope)
	written, err := s.client.Put(ctx, s.bucket, key, bytes.NewReader(stored), int64(len(stored)))
	if err != nil || written != int64(len(stored)) {
		return 0, errors.New("export object put failed")
	}
	return written, nil
}

func (s *Store) Get(ctx context.Context, key string) ([]byte, error) {
	if s == nil || s.client == nil || s.cipher == nil {
		return nil, errors.New("export object get failed")
	}
	object, err := s.client.Get(ctx, s.bucket, key)
	if err != nil {
		return nil, errors.New("export object get failed")
	}
	defer object.Close()
	envelope, err := io.ReadAll(object)
	if err != nil {
		return nil, errors.New("export object get failed")
	}
	plain, err := s.cipher.Decrypt(string(envelope))
	if err != nil {
		return nil, errors.New("export object get failed")
	}
	return []byte(plain), nil
}

// Delete is idempotent under MinIO/S3 semantics.
func (s *Store) Delete(ctx context.Context, key string) error {
	if s == nil || s.client == nil {
		return errors.New("export object delete failed")
	}
	if err := s.client.Delete(ctx, s.bucket, key); err != nil {
		return errors.New("export object delete failed")
	}
	return nil
}

func (c minioClient) BucketExists(ctx context.Context, bucket string) (bool, error) {
	return c.client.BucketExists(ctx, bucket)
}

func (c minioClient) Put(ctx context.Context, bucket, key string, body io.Reader, size int64) (int64, error) {
	info, err := c.client.PutObject(ctx, bucket, key, body, size, minio.PutObjectOptions{
		ContentType:      "application/octet-stream",
		DisableMultipart: true,
	})
	return info.Size, err
}

func (c minioClient) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	object, err := c.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err := object.Stat(); err != nil {
		_ = object.Close()
		return nil, err
	}
	return object, nil
}

func (c minioClient) Delete(ctx context.Context, bucket, key string) error {
	return c.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}
