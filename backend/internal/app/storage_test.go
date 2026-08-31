package app

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/config"
	"github.com/hxf4869/virtual-companion/internal/observability"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const runtimeTestRestKey = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4="

type runtimeTestBlobs struct{}

func (*runtimeTestBlobs) Put(context.Context, string, []byte) (int64, error) { return 1, nil }
func (*runtimeTestBlobs) Get(context.Context, string) ([]byte, error)        { return nil, nil }
func (*runtimeTestBlobs) Delete(context.Context, string) error               { return nil }

func TestRuntimeRequiresAndSharesConfiguredCipherAndBlobs(t *testing.T) {
	t.Parallel()
	cfg := runtimeStorageConfig(t)
	cipher, err := postgres.NewDefaultFieldCipher(runtimeTestRestKey)
	if err != nil {
		t.Fatal(err)
	}
	blobs := &runtimeTestBlobs{}

	for _, tc := range []struct {
		name string
		deps Deps
		want string
	}{
		{name: "missing cipher", deps: Deps{Blobs: blobs}, want: "rest cipher"},
		{name: "missing blobs", deps: Deps{Cipher: cipher}, want: "export object store"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := New(cfg, observability.NewLogger("error", io.Discard), tc.deps)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %q error, got %v", tc.want, err)
			}
		})
	}

	rt, err := New(cfg, observability.NewLogger("error", io.Discard), Deps{Cipher: cipher, Blobs: blobs})
	if err != nil {
		t.Fatal(err)
	}
	if rt.deps.Cipher != cipher || rt.deps.Blobs != blobs {
		t.Fatal("runtime did not preserve the configured singleton dependencies")
	}
	rt.store = &postgres.Store{}
	core, err := rt.buildCore()
	if err != nil {
		t.Fatal(err)
	}
	if core == nil || core.Blobs != blobs {
		t.Fatal("HTTP Core did not receive the runtime blob store instance")
	}
}

func runtimeStorageConfig(t *testing.T) config.Config {
	t.Helper()
	cfg, err := config.LoadEnv(func(key string) string {
		values := map[string]string{
			"VC_MODE":                     "full",
			"VC_DB_DSN":                   "postgres://runtime.invalid/vc",
			"VC_OWNER_BINDING_SECRET":     "0123456789abcdef0123456789abcdef",
			"VC_CRYPTO_REST_KEY":          runtimeTestRestKey,
			"VC_EXPORT_S3_ENDPOINT":       "http://minio:9000",
			"VC_EXPORT_S3_ACCESS_KEY":     "access-key",
			"VC_EXPORT_S3_SECRET_KEY":     "secret-key",
			"VC_EXPORT_S3_BUCKET":         "exports",
			"VC_HTTP_TRUST_PROXY_HEADERS": "true",
		}
		return values[key]
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}
