package main

import (
	"encoding/json"
	"flag"
	"io"
	"strconv"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/blobstore"
	"github.com/hxf4869/virtual-companion/internal/chatmigration"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type migrationCLIConfig struct {
	chatmigration.Config
	dsn, binding, token, tool              string
	keyID, key, previousKeyID, previousKey string
	keyVersion, previousKeyVersion         int
	objects                                blobstore.Config
}

func chatMigrationConfig(args []string, getenv func(string) string) (migrationCLIConfig, error) {
	var c migrationCLIConfig
	if len(args) == 0 || args[0] != "forward" && args[0] != "reverse" && args[0] != "finalize" {
		return c, chatmigration.ErrInvalid
	}
	c.Direction = "ST_TO_GO"
	if args[0] == "reverse" {
		c.Direction = "GO_TO_ST"
	}
	if args[0] == "finalize" {
		c.Direction = "FINALIZE"
	}
	fs := flag.NewFlagSet("chat-migration", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.Int64Var(&c.Owner, "owner", 0, "")
	fs.StringVar(&c.RunID, "run", "", "")
	fs.Int64Var(&c.ExpectedEpoch, "expected-epoch", 0, "")
	fs.StringVar(&c.STRoot, "st-root", "", "")
	fs.StringVar(&c.ArtifactRoot, "artifact-root", "", "")
	fs.StringVar(&c.LatestRightsManifest, "latest-rights-manifest", "", "")
	fs.StringVar(&c.tool, "snapshot-tool", "", "")
	fs.BoolVar(&c.Activate, "activate", false, "")
	var handles string
	fs.StringVar(&handles, "account-handle", "", "")
	var directories string
	fs.StringVar(&directories, "character-directories", "", "")
	var synthetic bool
	fs.BoolVar(&synthetic, "synthetic-isolated", false, "")
	if fs.Parse(args[1:]) != nil || fs.NArg() != 0 || !synthetic || c.Owner <= 0 || !stsource.ValidIdentity(c.RunID) || c.ExpectedEpoch < 1 || c.STRoot == "" || (c.ArtifactRoot == "" && c.Direction != "FINALIZE") || c.tool == "" {
		return c, chatmigration.ErrInvalid
	}
	if directories != "" {
		if json.Unmarshal([]byte(directories), &c.CharacterDirectories) != nil || c.CharacterDirectories == nil {
			return c, chatmigration.ErrInvalid
		}
	}
	if handles != "" {
		c.AccountHandles = map[string]string{strconv.FormatInt(c.Owner, 10): handles}
		if strings.TrimSpace(handles) == "" {
			return c, chatmigration.ErrInvalid
		}
	}
	c.dsn = getenv("VC_WORKER_DB_DSN")
	c.binding = getenv("VC_OWNER_BINDING_SECRET")
	c.token = getenv("VC_ST_PLUGIN_SERVICE_TOKEN")
	c.STBaseURL = getenv("VC_ST_HOST_BASE_URL")
	c.keyID = getenv("VC_CRYPTO_REST_KEY_ID")
	if c.keyID == "" {
		c.keyID = "default"
	}
	c.key = getenv("VC_CRYPTO_REST_KEY")
	c.previousKeyID = getenv("VC_CRYPTO_PREVIOUS_REST_KEY_ID")
	c.previousKey = getenv("VC_CRYPTO_PREVIOUS_REST_KEY")
	c.keyVersion = 1
	for _, slot := range []struct {
		name  string
		value *int
	}{{"VC_CRYPTO_REST_KEY_VERSION", &c.keyVersion}, {"VC_CRYPTO_PREVIOUS_REST_KEY_VERSION", &c.previousKeyVersion}} {
		if raw := getenv(slot.name); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 {
				return c, chatmigration.ErrInvalid
			}
			*slot.value = n
		}
	}
	c.objects = blobstore.Config{Endpoint: getenv("VC_EXPORT_S3_ENDPOINT"), AccessKey: getenv("VC_EXPORT_S3_ACCESS_KEY"), SecretKey: getenv("VC_EXPORT_S3_SECRET_KEY"), Bucket: getenv("VC_EXPORT_S3_BUCKET")}
	if c.dsn == "" || len(c.binding) < 32 || (c.Direction != "FINALIZE" && c.key == "") {
		return c, chatmigration.ErrInvalid
	}
	if c.Direction == "ST_TO_GO" && (len(c.token) < 32 || c.STBaseURL == "" || handles == "" || c.objects.Endpoint == "" || c.objects.AccessKey == "" || c.objects.SecretKey == "" || c.objects.Bucket == "") {
		return c, chatmigration.ErrInvalid
	}
	return c, nil
}
