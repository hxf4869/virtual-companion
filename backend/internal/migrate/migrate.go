package migrate

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const advisoryLockID int64 = 0x56435F4D49475241

var migrationName = regexp.MustCompile(`^V([1-9][0-9]*)__([A-Za-z0-9_]+)\.sql$`)

//go:embed sql/*.sql
var migrationFiles embed.FS

// Config belongs to the one-shot migration command. The steady-state runtime
// never receives schema-owner credentials.
type Config struct {
	DSN string
}

type migration struct {
	Version int64
	File    string
	Name    string
	SQL     string
}

func LoadEnv(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, fmt.Errorf("environment reader is required")
	}
	cfg := Config{DSN: strings.TrimSpace(getenv("VC_MIGRATE_DB_DSN"))}
	if cfg.DSN == "" {
		return Config{}, fmt.Errorf("VC_MIGRATE_DB_DSN is required")
	}
	return cfg, nil
}

func Run(ctx context.Context, cfg Config) error {
	if strings.TrimSpace(cfg.DSN) == "" {
		return fmt.Errorf("VC_MIGRATE_DB_DSN is required")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	migrations, err := loadMigrations()
	if err != nil {
		return err
	}
	conn, err := pgx.Connect(ctx, cfg.DSN)
	if err != nil {
		return fmt.Errorf("migration database connection failed")
	}
	defer conn.Close(context.Background())

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, advisoryLockID); err != nil {
		return fmt.Errorf("migration lock failed")
	}
	defer func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, advisoryLockID)
	}()

	if err := prepareHistory(ctx, conn); err != nil {
		return err
	}
	applied, err := appliedVersions(ctx, conn)
	if err != nil {
		return err
	}
	for _, item := range migrations {
		if _, ok := applied[item.Version]; ok {
			continue
		}
		if err := applyOne(ctx, conn, item); err != nil {
			return err
		}
	}
	return nil
}

func prepareHistory(ctx context.Context, conn *pgx.Conn) error {
	if _, err := conn.Exec(ctx, `
CREATE TABLE IF NOT EXISTS public.vc_schema_history (
  version bigint PRIMARY KEY CHECK (version > 0),
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  execution_ms bigint NOT NULL CHECK (execution_ms >= 0)
);
REVOKE ALL ON TABLE public.vc_schema_history FROM PUBLIC;
`); err != nil {
		return fmt.Errorf("migration history initialization failed")
	}
	return nil
}

func appliedVersions(ctx context.Context, conn *pgx.Conn) (map[int64]string, error) {
	rows, err := conn.Query(ctx, `SELECT version, name FROM public.vc_schema_history ORDER BY version`)
	if err != nil {
		return nil, fmt.Errorf("migration history read failed")
	}
	defer rows.Close()
	out := make(map[int64]string)
	for rows.Next() {
		var version int64
		var name string
		if err := rows.Scan(&version, &name); err != nil {
			return nil, fmt.Errorf("migration history read failed")
		}
		out[version] = name
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("migration history read failed")
	}
	return out, nil
}

func applyOne(ctx context.Context, conn *pgx.Conn, item migration) error {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("migration %s transaction failed", item.File)
	}
	defer tx.Rollback(context.Background())
	started := time.Now()
	if _, err := tx.Exec(ctx, item.SQL); err != nil {
		return fmt.Errorf("migration %s failed: %w", item.File, err)
	}
	executionMillis := time.Since(started).Milliseconds()
	if _, err := tx.Exec(ctx, `
INSERT INTO public.vc_schema_history(version, name, execution_ms)
VALUES ($1, $2, $3)
`, item.Version, item.File, executionMillis); err != nil {
		return fmt.Errorf("migration %s history write failed", item.File)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("migration %s commit failed", item.File)
	}
	return nil
}

func loadMigrations() ([]migration, error) {
	entries, err := fs.ReadDir(migrationFiles, "sql")
	if err != nil {
		return nil, fmt.Errorf("embedded migrations unavailable")
	}
	out := make([]migration, 0, len(entries))
	seen := make(map[int64]string)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := migrationName.FindStringSubmatch(entry.Name())
		if match == nil {
			return nil, fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		version, err := strconv.ParseInt(match[1], 10, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid migration filename %q", entry.Name())
		}
		if previous, ok := seen[version]; ok {
			return nil, fmt.Errorf("duplicate migration version %d in %s and %s", version, previous, entry.Name())
		}
		raw, err := migrationFiles.ReadFile(filepath.ToSlash(filepath.Join("sql", entry.Name())))
		if err != nil {
			return nil, fmt.Errorf("migration %s cannot be read", entry.Name())
		}
		if len(strings.TrimSpace(string(raw))) == 0 {
			return nil, fmt.Errorf("migration %s is empty", entry.Name())
		}
		seen[version] = entry.Name()
		out = append(out, migration{
			Version: version,
			File:    entry.Name(),
			Name:    strings.ReplaceAll(match[2], "_", " "),
			SQL:     string(raw),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	if len(out) == 0 {
		return nil, errors.New("no embedded migrations")
	}
	return out, nil
}
