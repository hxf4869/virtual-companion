package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/hxf4869/virtual-companion/internal/blobstore"
	"github.com/hxf4869/virtual-companion/internal/chatmigration"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

// main registers companiond chat-migration before normal runtime startup.
func runChatMigration(args []string) int {
	if len(args) == 0 || len(args) == 1 && (args[0] == "--help" || args[0] == "-h") {
		fmt.Fprint(os.Stdout, chatMigrationUsage)
		return 0
	}
	cfg, err := chatMigrationConfig(args, os.Getenv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_INVALID")
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	s, err := postgres.Open(ctx, postgres.OpenConfig{DSN: cfg.dsn, OwnerBindingSecret: cfg.binding})
	if err != nil {
		fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_STORE_FAILED")
		return 1
	}
	defer s.Close()
	if cfg.Direction == "FINALIZE" {
		parent, err := filepath.EvalSymlinks(filepath.Dir(cfg.STRoot))
		if err != nil {
			fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_ARTIFACT_INVALID")
			return 1
		}
		cfg.STRoot = filepath.Join(parent, filepath.Base(cfg.STRoot))
		state, err := s.GetChatStorageState(ctx, cfg.Owner)
		if err != nil || state.Mode != "ST" || state.AuthorityEpoch != cfg.ExpectedEpoch+1 {
			fmt.Fprintln(os.Stderr, "CHAT_AUTHORITY_CHANGED")
			return 1
		}
		node := chatmigration.Node{Tool: cfg.tool, ServiceToken: cfg.token}
		input := chatmigration.SnapshotInput{Root: cfg.STRoot, OwnerAccountID: strconv.FormatInt(cfg.Owner, 10), MigrationRunID: cfg.RunID, FrozenAuthorityEpoch: strconv.FormatInt(cfg.ExpectedEpoch, 10), ActivatedAuthorityEpoch: strconv.FormatInt(state.AuthorityEpoch, 10)}
		if err := node.Run(ctx, "finalize", input); err != nil {
			fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_SNAPSHOT_FAILED")
			return 1
		}
		fmt.Fprintln(os.Stdout, `{"activated":true}`)
		return 0
	}
	cipher, err := postgres.NewFieldCipherWithPrevious(cfg.keyID, cfg.keyVersion, cfg.key, cfg.previousKeyID, cfg.previousKeyVersion, cfg.previousKey)
	if err != nil {
		fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_INVALID")
		return 2
	}
	s.UseCipher(cipher)
	runner := chatmigration.Runner{Store: s, Snapshot: chatmigration.Node{Tool: cfg.tool, ServiceToken: cfg.token}}
	if cfg.Direction == "ST_TO_GO" {
		gate, err := stsource.NewClient(cfg.STBaseURL, cfg.token)
		if err != nil {
			fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_INVALID")
			return 2
		}
		blobCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		objects, err := blobstore.New(blobCtx, cfg.objects, cipher)
		cancel()
		if err != nil {
			fmt.Fprintln(os.Stderr, "CHAT_MIGRATION_STAGING_FAILED")
			return 1
		}
		runner.Gate = gate
		runner.Objects = objects
	}
	result, err := runner.Run(ctx, cfg.Config)
	if err != nil {
		// Runner exposes fixed codes only. Never print raw pgx, filesystem or
		// child-process diagnostics, which can contain credentials/identifiers.
		code := err.Error()
		switch code {
		case "CHAT_MIGRATION_INVALID", "CHAT_MIGRATION_ARTIFACT_INVALID", "CHAT_MIGRATION_SNAPSHOT_FAILED", "CHAT_MIGRATION_STORE_FAILED", "CHAT_MIGRATION_DRAIN_FAILED", "CHAT_MIGRATION_CLEANUP_FAILED", "CHAT_TRANSFER_TIMEOUT", "REVISION_CONFLICT", "CHAT_AUTHORITY_CHANGED":
		case "CHAT_MIGRATION_SOURCE_UNAVAILABLE", "IDEMPOTENCY_KEY_REUSED", "CHAT_IMPORT_INVALID", "CHAT_PAYLOAD_TOO_LARGE", "CHAT_MIGRATION_CURRENT_GO_REQUIRED", "CHAT_MIGRATION_NOT_DRAINED", "CHAT_MIGRATION_PATH_INVALID", "CHAT_MIGRATION_TARGET_NOT_EMPTY", "CHAT_MIGRATION_RESOURCE_MAPPING_REQUIRED", "CHAT_MIGRATION_JSONL_INVALID", "CHAT_MIGRATION_ST_REVISION_LIMIT":
		default:
			code = "CHAT_MIGRATION_FAILED"
		}
		fmt.Fprintln(os.Stderr, code)
		return 1
	}
	_ = json.NewEncoder(os.Stdout).Encode(result)
	return 0
}

const chatMigrationUsage = `companiond chat-migration forward|reverse [options]
  --synthetic-isolated       Confirm synthetic data and isolated targets only
  --owner ID                 Controlled owner mapping, independently bound in PG
  --run UUID                 Reuse this run and original expected epoch to resume
  --expected-epoch N         Authority epoch before freeze
  --st-root DIRECTORY        Source ST root; reverse requires a new target root
  --artifact-root DIRECTORY  Private CLI directory retaining one current snapshot
  --snapshot-tool FILE       Local chat-migration-snapshot.mjs
  --account-handle HANDLE    Forward: explicit ST owner mapping
  --character-directories JSON  Reverse: logical characterRef to ST directory map
  --latest-rights-manifest FILE  Shared manifest containing latest external rights
  --activate                 Explicitly CAS verified synthetic run to GO or ST

Without --activate, runs remain FROZEN after verification.
finalize uses --owner, --run, --expected-epoch (FROZEN epoch), --st-root,
--snapshot-tool and --synthetic-isolated after a successful reverse CAS.
Configuration: VC_WORKER_DB_DSN, VC_OWNER_BINDING_SECRET; transfer requires
VC_CRYPTO_REST_KEY and its existing current/previous key settings. Forward also
requires VC_ST_HOST_BASE_URL, VC_ST_PLUGIN_SERVICE_TOKEN and VC_EXPORT_S3_*.
Only fixed errors and aggregate counts are printed. No real cutover is authorized.
`
