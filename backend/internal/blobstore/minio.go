package blobstore

import (
	"bytes"
	"context"
	"errors"
	"io"
	"iter"
	"math"
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

// Store encrypts private objects with the runtime FieldCipher before handing
// them to MinIO.
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

// Listing is optional for existing read/write-only consumers and test clients.
type objectLister interface {
	ListObjects(context.Context, string, minio.ListObjectsOptions) iter.Seq[minio.ObjectInfo]
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

// GetLimited reads only enc2 objects and bounds both the encrypted envelope and
// its plaintext. Unlike Get, it does not accept migration-window plaintext.
func (s *Store) GetLimited(ctx context.Context, key string, maxPlainBytes int64) ([]byte, error) {
	failed := errors.New("export object get failed")
	// enc2:<key ID up to 32 bytes>:<positive int version>: plus padded
	// base64(12-byte IV || plaintext || 16-byte GCM tag). Reserve one extra
	// byte for detecting an oversized object without reading the rest.
	const maxHeaderBytes int64 = 5 + 32 + 1 + 19 + 1
	if s == nil || s.client == nil || s.cipher == nil || ctx == nil ||
		maxPlainBytes < 0 || maxPlainBytes > (math.MaxInt64-maxHeaderBytes-1)/4*3-30 || ctx.Err() != nil {
		return nil, failed
	}
	envelopeLimit := maxHeaderBytes + (maxPlainBytes+28+2)/3*4
	object, err := s.client.Get(ctx, s.bucket, key)
	if err != nil {
		return nil, failed
	}
	defer object.Close()
	envelope, err := io.ReadAll(io.LimitReader(contextReader{ctx: ctx, reader: object}, envelopeLimit+1))
	if err != nil || int64(len(envelope)) > envelopeLimit || ctx.Err() != nil || !bytes.HasPrefix(envelope, []byte("enc2:")) {
		return nil, failed
	}
	plain, err := s.cipher.Decrypt(string(envelope))
	if err != nil || int64(len(plain)) > maxPlainBytes || ctx.Err() != nil {
		return nil, failed
	}
	return []byte(plain), nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

// ListKeys returns at most 256 keys in lexical order after the exclusive cursor.
// The supplied prefix confines cleanup to its owned object namespace.
func (s *Store) ListKeys(ctx context.Context, prefix, after string, limit int) ([]string, error) {
	failed := errors.New("export object list failed")
	if s == nil || s.client == nil || ctx == nil || ctx.Err() != nil || prefix == "" || limit <= 0 || limit > 256 {
		return nil, failed
	}
	lister, ok := s.client.(objectLister)
	if !ok {
		return nil, failed
	}
	listCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	keys := make([]string, 0, limit)
	for object := range lister.ListObjects(listCtx, s.bucket, minio.ListObjectsOptions{
		Prefix: prefix, StartAfter: after, Recursive: true, MaxKeys: limit,
	}) {
		if object.Err != nil || ctx.Err() != nil || !strings.HasPrefix(object.Key, prefix) || object.Key <= after ||
			(len(keys) > 0 && object.Key <= keys[len(keys)-1]) {
			return nil, failed
		}
		keys = append(keys, object.Key)
		if len(keys) == limit {
			cancel()
			break
		}
	}
	if ctx.Err() != nil {
		return nil, failed
	}
	return keys, nil
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

func (c minioClient) ListObjects(ctx context.Context, bucket string, opts minio.ListObjectsOptions) iter.Seq[minio.ObjectInfo] {
	return c.client.ListObjectsIter(ctx, bucket, opts)
}
