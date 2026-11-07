package chatmigration

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNodeUsesPrivateStdinAndDoesNotInheritDatabaseSecrets(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal("node required for snapshot subprocess test")
	}
	t.Setenv("VC_DB_DSN", "must-not-reach-node")
	tool := filepath.Join(t.TempDir(), "snapshot.cjs")
	script := `let raw='';process.stdin.on('data',b=>raw+=b);process.stdin.on('end',()=>{const v=JSON.parse(raw);if(v.ownerAccountId!=='101'||process.env.VC_DB_DSN||process.env.VC_ST_PLUGIN_SERVICE_TOKEN.length!==32)process.exit(1);process.stdout.write('private path, owner, body');process.stderr.write('private token');});`
	if err := os.WriteFile(tool, []byte(script), 0600); err != nil {
		t.Fatal(err)
	}
	n := Node{Tool: tool, ServiceToken: strings.Repeat("t", 32)}
	if err := n.Run(context.Background(), "export", SnapshotInput{OwnerAccountID: "101"}); err != nil {
		t.Fatal(err)
	}
}

func TestNodeCancellationAndFailuresExposeOnlyFixedErrors(t *testing.T) {
	tool := filepath.Join(t.TempDir(), "snapshot.cjs")
	if err := os.WriteFile(tool, []byte(`process.stderr.write('private body and credential');process.exit(2)`), 0600); err != nil {
		t.Fatal(err)
	}
	n := Node{Tool: tool}
	if err := n.Run(context.Background(), "restore", SnapshotInput{}); !errors.Is(err, ErrSnapshot) {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if err := n.Run(ctx, "restore", SnapshotInput{}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}
