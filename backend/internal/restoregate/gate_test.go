package restoregate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClosedWhileMarkerBlocksAndOpensWhenRemoved(t *testing.T) {
	t.Parallel()
	if Closed("") {
		t.Fatal("unset path is the normal running process")
	}
	dir := t.TempDir()
	file := filepath.Join(dir, "restore-gate.json")
	if err := os.WriteFile(file, []byte(`{"blocked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !Closed(file) {
		t.Fatal("blocked marker must keep jobs and retrieval closed")
	}
	if err := os.WriteFile(file, []byte(`{"blocked":false}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if Closed(file) {
		t.Fatal("explicit open marker must allow jobs and retrieval")
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	if Closed(file) {
		t.Fatal("removing the marker is how restore.sh opens the gate")
	}
	if err := os.WriteFile(file, []byte(`not-json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !Closed(file) {
		t.Fatal("unreadable marker must fail closed")
	}
}
