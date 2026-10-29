//go:build integration

package jobs

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentDeletionSQLMatchesSchema(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "..", "integrations", "sillytavern", "scripts", "lib", "deletion-state.py"))
	if err != nil {
		t.Fatal(err)
	}
	const marker = "DELETION_SQL = \"\"\""
	start := strings.Index(string(body), marker)
	if start < 0 {
		t.Fatal("deletion SQL marker missing")
	}
	rest := string(body)[start+len(marker):]
	end := strings.Index(rest, "\"\"\"")
	if end < 0 {
		t.Fatal("deletion SQL terminator missing")
	}
	sql := strings.TrimSpace(rest[:end])
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, postgres.IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var raw string
	if err := pool.QueryRow(ctx, sql).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Version       int              `json:"version"`
		Accounts      []map[string]any `json:"accounts"`
		Conversations []map[string]any `json:"conversations"`
		Relationships []map[string]any `json:"relationships"`
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Version != 1 || doc.Accounts == nil || doc.Conversations == nil || doc.Relationships == nil {
		t.Fatalf("deletion query shape %+v", doc)
	}
}
