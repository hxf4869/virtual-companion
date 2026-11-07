package chatmigration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
)

// SnapshotInput travels over stdin. Neither account mapping nor service secrets
// are passed in process arguments or included in subprocess output.
type SnapshotInput struct {
	Root                    string            `json:"root"`
	ArtifactRoot            string            `json:"artifactRoot"`
	SupplementFile          string            `json:"supplementFile,omitempty"`
	OwnerAccountID          string            `json:"ownerAccountId"`
	MigrationRunID          string            `json:"migrationRunId"`
	FrozenAuthorityEpoch    string            `json:"frozenAuthorityEpoch"`
	STBaseURL               string            `json:"stBaseUrl,omitempty"`
	AccountHandles          map[string]string `json:"accountHandles,omitempty"`
	CharacterDirectories    map[string]string `json:"characterDirectories,omitempty"`
	ActivatedAuthorityEpoch string            `json:"activatedAuthorityEpoch,omitempty"`
	CurrentGoExport         *CurrentGoExport  `json:"currentGoExport,omitempty"`
}

type CurrentGoExport struct {
	MigrationRunID       string `json:"migrationRunId"`
	OwnerAccountID       string `json:"ownerAccountId"`
	FrozenAuthorityEpoch string `json:"frozenAuthorityEpoch"`
	ManifestSHA256       string `json:"manifestSha256"`
}

type Snapshotter interface {
	Run(context.Context, string, SnapshotInput) error
}

type Node struct{ Executable, Tool, ServiceToken string }

func (n Node) Run(ctx context.Context, operation string, input SnapshotInput) error {
	if operation != "export" && operation != "restore" && operation != "finalize" {
		return ErrInvalid
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return ErrInvalid
	}
	executable := n.Executable
	if executable == "" {
		executable = "node"
	}
	cmd := exec.CommandContext(ctx, executable, n.Tool, operation)
	cmd.Stdin = bytes.NewReader(raw)
	var output boundedOutput
	cmd.Stdout, cmd.Stderr = &output, io.Discard
	// Do not hand database, encryption or unrelated runtime credentials to Node.
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "VC_ST_PLUGIN_SERVICE_TOKEN=" + n.ServiceToken}
	if cmd.Run() != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var failure struct {
			Status string `json:"status"`
			Code   string `json:"code"`
		}
		if json.Unmarshal(output.data, &failure) == nil && failure.Status == "UNAVAILABLE" {
			switch failure.Code {
			case "CHAT_MIGRATION_SOURCE_UNAVAILABLE", "CHAT_MIGRATION_CURRENT_GO_REQUIRED", "CHAT_MIGRATION_NOT_DRAINED", "CHAT_MIGRATION_PATH_INVALID", "CHAT_MIGRATION_TARGET_NOT_EMPTY", "CHAT_MIGRATION_RESOURCE_MAPPING_REQUIRED", "CHAT_MIGRATION_JSONL_INVALID", "CHAT_MIGRATION_ST_REVISION_LIMIT":
				return errors.New(failure.Code)
			}
		}
		return ErrSnapshot
	}
	return nil
}

// Bound arbitrary child output; only whitelisted fixed failure codes above
// cross the subprocess boundary. Other output is never forwarded or logged.
type boundedOutput struct{ data []byte }

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := 4096 - len(b.data)
	if remaining > 0 {
		b.data = append(b.data, p[:min(len(p), remaining)]...)
	}
	return n, nil
}
