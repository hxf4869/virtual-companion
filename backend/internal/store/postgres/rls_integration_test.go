//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMain(m *testing.M) {
	if err := startTestDB(); err != nil {
		fmt.Fprintf(os.Stderr, "g3 postgres harness: %v\n", err)
		os.Exit(1)
	}
	code := m.Run()
	stopTestDB()
	os.Exit(code)
}

func TestOwnerBoundReadSeesOnlyOwnRows(t *testing.T) {
	ctx := context.Background()
	resetFixtures(t)
	var seen []int64
	err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id FROM vc.relationship ORDER BY id`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return err
			}
			seen = append(seen, id)
		}
		return rows.Err()
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(seen) != 1 || seen[0] != 10 {
		t.Fatalf("owner 1 rows %v", seen)
	}

	var bobID int64
	err = testEnv.store.WithOwner(ctx, 2, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM vc.relationship`).Scan(&bobID)
	})
	if err != nil {
		t.Fatal(err)
	}
	if bobID != 20 {
		t.Fatalf("owner 2 id %d", bobID)
	}
}

func TestMissingOwnerContextMatchesNothing(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testEnv.runtimeDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM vc.relationship`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("missing owner context leaked %d rows", n)
	}
}

func TestForgedOwnerProofRejected(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testEnv.runtimeDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `SELECT vc.set_owner_context(1, 'n1', '0000000000000000000000000000000000000000000000000000000000000000')`)
	if err == nil {
		t.Fatal("forged proof must be rejected")
	}
}

func TestRuntimeRoleCannotBypassRLSOrReadSecretOrDDL(t *testing.T) {
	attrs, err := psqlSuper(`
SELECT rolname||'|'||rolsuper::text||'|'||rolbypassrls::text||'|'||rolcreatedb::text||'|'||rolcreaterole::text
  FROM pg_roles WHERE rolname='vc_runtime_login'`)
	if err != nil {
		t.Fatal(err)
	}
	if attrs != "vc_runtime_login|false|false|false|false" {
		t.Fatalf("runtime role attributes %q", attrs)
	}
	apiAttrs, err := psqlSuper(`
SELECT rolname||'|'||rolbypassrls::text||'|'||rolcanlogin::text
  FROM pg_roles WHERE rolname='vc_api'`)
	if err != nil {
		t.Fatal(err)
	}
	if apiAttrs != "vc_api|false|false" {
		t.Fatalf("vc_api attributes %q", apiAttrs)
	}

	expectDenied(t, `SELECT secret FROM vc._owner_binding_secret`)
	expectDenied(t, `CREATE TABLE vc.runtime_must_not_create(id int)`)
	expectDenied(t, `INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 99, 'x', true)`)
}

func expectDenied(t *testing.T, sql string) {
	t.Helper()
	err := testEnv.store.WithOwner(context.Background(), 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, sql)
		return err
	})
	if err == nil {
		t.Fatalf("runtime unexpectedly succeeded: %s", sql)
	}
	if !isPrivilegeDenied(err) {
		t.Fatalf("expected privilege denial for %s: %v", sql, err)
	}
}

func TestShortTransactionsDoNotWrapCaller(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	var xact1, xact2 string
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT pg_current_xact_id()::text`).Scan(&xact1)
	}); err != nil {
		t.Fatal(err)
	}
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT pg_current_xact_id()::text`).Scan(&xact2)
	}); err != nil {
		t.Fatal(err)
	}
	if xact1 == "" || xact1 == xact2 {
		t.Fatalf("each WithOwner must use its own transaction, got %q %q", xact1, xact2)
	}
	st := testEnv.store.Stats()
	if st.Acquired != 0 {
		t.Fatalf("transaction must be released, acquired=%d", st.Acquired)
	}
	if st.TxCount < 2 {
		t.Fatalf("tx count %d", st.TxCount)
	}
}

func TestOpenRejectsMissingBindingSecret(t *testing.T) {
	ctx := context.Background()
	_, err := Open(ctx, OpenConfig{DSN: testEnv.runtimeDSN, OwnerBindingSecret: "short"})
	if err == nil {
		t.Fatal("short secret")
	}
}

func TestWrongBindingSecretRejectedByDatabase(t *testing.T) {
	ctx := context.Background()
	store, err := Open(ctx, OpenConfig{
		DSN:                testEnv.runtimeDSN,
		MaxConns:           2,
		TxTimeout:          5 * time.Second,
		OwnerBindingSecret: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxWRONG",
	})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return nil
	})
	if !errors.Is(err, ErrOwnerContextRejected) {
		t.Fatalf("want ErrOwnerContextRejected, got %v", err)
	}
}

func resetFixtures(t *testing.T) {
	t.Helper()
	_, err := psqlSuper(`
TRUNCATE vc.account_deletion_intent, vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 10, 'persona-a', true), (2, 20, 'persona-bob', true);
INSERT INTO vc.provider_deployment(provider_id, protocol, capabilities, admission_state)
VALUES ('openai-compatible', 'OPENAI_CHAT_COMPLETIONS', '{}', 'ADMITTED')
ON CONFLICT (provider_id) DO UPDATE
   SET protocol = EXCLUDED.protocol, admission_state = EXCLUDED.admission_state;
`)
	if err != nil {
		t.Fatal(err)
	}
}

func isPrivilegeDenied(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "permission denied") ||
		strings.Contains(msg, "insufficient_privilege") ||
		strings.Contains(msg, "must be owner")
}
