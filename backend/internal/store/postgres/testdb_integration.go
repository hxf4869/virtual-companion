//go:build integration

package postgres

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	testImage              = "pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
	testOwnerBindingSecret = "vc-test-owner-binding-secret-0123456789abcdef"
	testSuperUser          = "postgres"
	testSuperPassword      = "vc"
	testRuntimeUser        = "vc_runtime_login"
	testRuntimePassword    = "g3-test-runtime"
	testDBName             = "vc"
)

var testEnv struct {
	containerID string
	port        int
	store       *Store
	superDSN    string
	runtimeDSN  string
}

// StartIsolation starts the synthetic PostgreSQL used by G3/G7 isolation
// tests. It never connects a provider and never uses a production DSN.
func StartIsolation() error { return startTestDB() }

// StopIsolation tears down the synthetic PostgreSQL.
func StopIsolation() { stopTestDB() }

// IsolationStore is the runtime-role owner-bound store.
func IsolationStore() *Store { return testEnv.store }

// IsolationRuntimeDSN is the least-privilege DSN for the synthetic replica.
func IsolationRuntimeDSN() string { return testEnv.runtimeDSN }

// IsolationSuperDSN is the superuser DSN for fixture setup only.
func IsolationSuperDSN() string { return testEnv.superDSN }

// IsolationOwnerBindingSecret is the synthetic HMAC key (not a production secret).
func IsolationOwnerBindingSecret() string { return testOwnerBindingSecret }

// IsolationSuperExec runs parameterized SQL as the synthetic superuser.
// Arguments must be synthetic fixture values, never real conversation bodies.
func IsolationSuperExec(ctx context.Context, sql string, args ...any) error {
	pool, err := pgxpool.New(ctx, testEnv.superDSN)
	if err != nil {
		return err
	}
	defer pool.Close()
	_, err = pool.Exec(ctx, sql, args...)
	return err
}

func startTestDB() error {
	if _, err := exec.LookPath("docker"); err != nil {
		return fmt.Errorf("docker is required for integration tests: %w", err)
	}
	name := fmt.Sprintf("vc-g3-pg-%d", os.Getpid())
	out, err := exec.Command("docker", "run", "-d", "--rm",
		"--name", name,
		"-e", "POSTGRES_PASSWORD="+testSuperPassword,
		"-e", "POSTGRES_DB="+testDBName,
		"-p", "127.0.0.1::5432",
		testImage,
	).CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker run: %s (%w)", strings.TrimSpace(string(out)), err)
	}
	testEnv.containerID = strings.TrimSpace(string(out))
	if err := waitReady(); err != nil {
		stopTestDB()
		return err
	}
	portOut, err := exec.Command("docker", "port", testEnv.containerID, "5432/tcp").Output()
	if err != nil {
		stopTestDB()
		return fmt.Errorf("docker port: %w", err)
	}
	line := strings.TrimSpace(strings.Split(string(portOut), "\n")[0])
	i := strings.LastIndex(line, ":")
	if i < 0 {
		stopTestDB()
		return fmt.Errorf("docker port parse %q", line)
	}
	port, err := strconv.Atoi(line[i+1:])
	if err != nil {
		stopTestDB()
		return err
	}
	testEnv.port = port
	if err := applyMigrations(); err != nil {
		stopTestDB()
		return err
	}
	if err := seedAndRoles(); err != nil {
		stopTestDB()
		return err
	}
	testEnv.superDSN = fmt.Sprintf("postgres://%s:%s@127.0.0.1:%d/%s?sslmode=disable",
		testSuperUser, testSuperPassword, port, testDBName)
	testEnv.runtimeDSN = fmt.Sprintf("postgres://%s:%s@127.0.0.1:%d/%s?sslmode=disable",
		testRuntimeUser, testRuntimePassword, port, testDBName)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store, err := Open(ctx, OpenConfig{
		DSN:                testEnv.runtimeDSN,
		MaxConns:           4,
		TxTimeout:          8 * time.Second,
		OwnerBindingSecret: testOwnerBindingSecret,
	})
	if err != nil {
		stopTestDB()
		return err
	}
	testEnv.store = store
	return nil
}

func stopTestDB() {
	if testEnv.store != nil {
		testEnv.store.Close()
		testEnv.store = nil
	}
	if testEnv.containerID != "" {
		_ = exec.Command("docker", "rm", "-f", testEnv.containerID).Run()
		testEnv.containerID = ""
	}
}

func waitReady() error {
	deadline := time.Now().Add(60 * time.Second)
	stable := 0
	for time.Now().Before(deadline) {
		cmd := exec.Command("docker", "exec", testEnv.containerID,
			"psql", "-U", testSuperUser, "-d", testDBName, "-c", "SELECT 1")
		if err := cmd.Run(); err == nil {
			stable++
			if stable >= 3 {
				return nil
			}
		} else {
			stable = 0
		}
		time.Sleep(400 * time.Millisecond)
	}
	return fmt.Errorf("postgres did not become ready")
}

func applyMigrations() error {
	root, err := findRepoRoot()
	if err != nil {
		return err
	}
	dir := filepath.Join(root, "backend", "internal", "migrate", "sql")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	type mig struct {
		version int
		path    string
	}
	var files []mig
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "V") || !strings.HasSuffix(name, ".sql") {
			continue
		}
		cut := strings.Index(name, "__")
		if cut < 0 {
			continue
		}
		n, err := strconv.Atoi(name[1:cut])
		if err != nil {
			continue
		}
		files = append(files, mig{version: n, path: filepath.Join(dir, name)})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].version < files[j].version })
	if len(files) == 0 {
		return fmt.Errorf("no migrations in %s", dir)
	}
	for _, f := range files {
		if err := psqlFile(f.path); err != nil {
			return fmt.Errorf("%s: %w", filepath.Base(f.path), err)
		}
	}
	return nil
}

func seedAndRoles() error {
	sql := `
INSERT INTO vc._owner_binding_secret(id, secret)
VALUES (1, '` + testOwnerBindingSecret + `')
ON CONFLICT (id) DO NOTHING;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_runtime_login') THEN
    CREATE ROLE vc_runtime_login LOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '` + testRuntimePassword + `';
  END IF;
END $$;
ALTER ROLE vc_runtime_login LOGIN INHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER NOBYPASSRLS PASSWORD '` + testRuntimePassword + `';
GRANT vc_api, vc_worker, vc_job_coordinator, vc_dispatcher TO vc_runtime_login;
`
	return psqlStdin(sql)
}

func psqlFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	cmd := exec.Command("docker", "exec", "-i", testEnv.containerID,
		"psql", "-U", testSuperUser, "-d", testDBName, "-v", "ON_ERROR_STOP=1", "-q")
	cmd.Stdin = f
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", firstErrorLine(out))
	}
	return nil
}

func psqlStdin(sql string) error {
	cmd := exec.Command("docker", "exec", "-i", testEnv.containerID,
		"psql", "-U", testSuperUser, "-d", testDBName, "-v", "ON_ERROR_STOP=1", "-q")
	cmd.Stdin = strings.NewReader(sql)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s", firstErrorLine(out))
	}
	return nil
}

func psqlSuper(sql string) (string, error) {
	cmd := exec.Command("docker", "exec", "-i", testEnv.containerID,
		"psql", "-U", testSuperUser, "-d", testDBName, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-q")
	cmd.Stdin = strings.NewReader(sql)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s", firstErrorLine(out))
	}
	return strings.TrimSpace(string(out)), nil
}

func firstErrorLine(out []byte) string {
	text := strings.TrimSpace(string(out))
	for _, line := range strings.Split(text, "\n") {
		if strings.Contains(line, "ERROR") {
			return line
		}
	}
	if text == "" {
		return "psql failed"
	}
	return text
}

func findRepoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	dir := wd
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "backend", "internal", "migrate", "sql")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("repo root not found above %s", wd)
}
