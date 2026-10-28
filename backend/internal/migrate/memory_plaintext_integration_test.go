//go:build integration

package migrate_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/migrate"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// This suite upgrades an actual nonempty V145 database. It deliberately does not
// use the store test bootstrap, which installs the newest SQL before seeding.
func TestMemoryPlaintextMigration(t *testing.T) {
	ctx := context.Background()
	baseDSN := plaintextTestDatabase(t)
	currentKey := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("c", 32)))
	previousKey := base64.StdEncoding.EncodeToString([]byte(strings.Repeat("p", 32)))
	previous, err := postgres.NewFieldCipher("memory", 1, previousKey)
	if err != nil {
		t.Fatal(err)
	}
	current, err := postgres.NewFieldCipherWithPrevious("memory", 2, currentKey, "memory", 1, previousKey)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("mixed_nonempty_paged_history_import_and_reentry", func(t *testing.T) {
		dsn, conn := plaintextClone(t, baseDSN, "mixed")
		want := plaintextFixture(t, conn, current, previous, 260)
		rlsBefore := plaintextQuery(t, conn, plaintextRLSSnapshot)
		if err := migrate.Run(ctx, migrate.Config{DSN: dsn, DecryptMemory: current.Decrypt}); err != nil {
			t.Fatal(err)
		}
		if got := plaintextQuery(t, conn, plaintextSnapshot); got != want {
			t.Fatal("migration changed metadata or did not convert every memory field across both owners and pages")
		}
		if got := plaintextQuery(t, conn, plaintextRLSSnapshot); got != rlsBefore {
			t.Fatal("migration changed FORCE RLS or ownership policies")
		}
		if got := plaintextQuery(t, conn, `SELECT count(*)::text FROM public.vc_schema_history WHERE version=146`); got != "1" {
			t.Fatalf("schema history count = %s", got)
		}
		if err := migrate.Run(ctx, migrate.Config{DSN: dsn, DecryptMemory: func(string) (string, error) {
			t.Error("completed migration decrypted a field again")
			return "", fmt.Errorf("must not run")
		}}); err != nil {
			t.Fatal(err)
		}
		if got := plaintextQuery(t, conn, plaintextSnapshot); got != want {
			t.Fatal("reentry changed stored data")
		}

		// The old archive restore path must copy the converted summary, not revive an envelope.
		tx := plaintextOwnerTx(t, conn, 1)
		var imported int
		if err := tx.QueryRow(ctx, `SELECT vc.import_memories_to_relationship(1,10)`).Scan(&imported); err != nil {
			t.Fatal(err)
		}
		if imported != 2 {
			t.Fatalf("imported %d records, want 2", imported)
		}
		var restored int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.memory_item WHERE owner_user_id=1 AND id>260 AND summary IN ('bundle 1/1 first','bundle 1/1 second')`).Scan(&restored); err != nil {
			t.Fatal(err)
		}
		if restored != 2 {
			t.Fatalf("restored plaintext records = %d", restored)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}

		// Real role checks: owner binding still gates plaintext source reads.
		tx = plaintextOwnerTx(t, conn, 1)
		plaintextExec(t, tx, `SET LOCAL ROLE vc_api`)
		var own, other int
		if err := tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE owner_user_id=1),count(*) FILTER(WHERE owner_user_id=2) FROM vc.st_message_source`).Scan(&own, &other); err != nil {
			t.Fatal(err)
		}
		if own != 260 || other != 0 {
			t.Fatalf("RLS source rows own=%d other=%d", own, other)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		tx, err = conn.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		plaintextExec(t, tx, `SET LOCAL ROLE vc_api`)
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM vc.st_message_source`).Scan(&own); err != nil {
			t.Fatal(err)
		}
		if own != 0 {
			t.Fatalf("missing owner exposed %d rows", own)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
	})

	for _, kind := range []string{"wrong_key", "unknown_previous_slot", "malformed_nested_envelope"} {
		t.Run(kind, func(t *testing.T) {
			dsn, conn := plaintextClone(t, baseDSN, kind)
			plaintextFixture(t, conn, current, previous, 3)
			decrypt := current.Decrypt
			if kind == "wrong_key" {
				wrong, err := postgres.NewFieldCipherWithPrevious("memory", 2, base64.StdEncoding.EncodeToString([]byte(strings.Repeat("w", 32))), "memory", 1, previousKey)
				if err != nil {
					t.Fatal(err)
				}
				decrypt = wrong.Decrypt
			}
			if kind == "unknown_previous_slot" {
				old, err := postgres.NewFieldCipher("retired", 7, previousKey)
				if err != nil {
					t.Fatal(err)
				}
				value, err := old.Encrypt("synthetic old slot")
				if err != nil {
					t.Fatal(err)
				}
				plaintextExec(t, conn, `UPDATE vc.memory_extract_attempt SET output_payload=$1 WHERE owner_user_id=2 AND id=3`, value)
			}
			if kind == "malformed_nested_envelope" {
				plaintextExec(t, conn, `UPDATE vc.memory_import_bundle SET payload=jsonb_set(payload,'{1,summary}','"enc2:memory:2:broken"') WHERE owner_user_id=2 AND persona_ref='archive-003'`)
			}
			before := plaintextQuery(t, conn, plaintextSnapshot)
			functions := plaintextQuery(t, conn, plaintextFunctionSnapshot)
			if err := migrate.Run(ctx, migrate.Config{DSN: dsn, DecryptMemory: decrypt}); err == nil {
				t.Fatal("invalid key/envelope migration succeeded")
			}
			if got := plaintextQuery(t, conn, plaintextSnapshot); got != before {
				t.Fatal("failed version left partial plaintext or changed metadata")
			}
			if got := plaintextQuery(t, conn, plaintextFunctionSnapshot); got != functions {
				t.Fatal("failed version did not roll back SQL function changes")
			}
			if got := plaintextQuery(t, conn, `SELECT count(*)::text FROM public.vc_schema_history WHERE version=146`); got != "0" {
				t.Fatal("failed version recorded schema history")
			}
		})
	}
	t.Run("deleting_owner_requires_existing_deletion_completion", func(t *testing.T) {
		dsn, conn := plaintextClone(t, baseDSN, "deletion")
		plaintextFixture(t, conn, current, previous, 3)
		tx := plaintextOwnerTx(t, conn, 2)
		plaintextExec(t, tx, `SELECT vc.request_account_deletion_current()`)
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		before := plaintextQuery(t, conn, plaintextSnapshot)
		if err := migrate.Run(ctx, migrate.Config{DSN: dsn, DecryptMemory: current.Decrypt}); err == nil {
			t.Fatal("migration bypassed pending account deletion")
		}
		if got := plaintextQuery(t, conn, plaintextSnapshot); got != before {
			t.Fatal("deletion-blocked version changed data")
		}
		if got := plaintextQuery(t, conn, `SELECT tgenabled::text FROM pg_trigger WHERE tgrelid='vc.memory_item'::regclass AND tgname='memory_item_deletion_intent_guard'`); got != "O" {
			t.Fatal("deletion barrier disabled")
		}
		tx = plaintextOwnerTx(t, conn, 2)
		var deleted bool
		if err := tx.QueryRow(ctx, `SELECT vc.identity_account_delete_current()`).Scan(&deleted); err != nil {
			t.Fatal(err)
		}
		if !deleted {
			t.Fatal("existing account deletion did not finish")
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if err := migrate.Run(ctx, migrate.Config{DSN: dsn, DecryptMemory: current.Decrypt}); err != nil {
			t.Fatal(err)
		}
		if got := plaintextQuery(t, conn, `SELECT status FROM vc.account_deletion_intent WHERE account_id=2`); got != "COMPLETED" {
			t.Fatalf("deletion status=%s", got)
		}
		if got := plaintextQuery(t, conn, `SELECT count(*)::text FROM vc.memory_item WHERE owner_user_id=2`); got != "0" {
			t.Fatal("deleted owner memory resurrected")
		}
	})
}

const plaintextSnapshot = `SELECT jsonb_build_object(
 'memory',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,id),'[]') FROM vc.memory_item t),
 'summary',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,id),'[]') FROM vc.conversation_summary t),
 'source',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,id),'[]') FROM vc.st_message_source t),
 'attempt',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,id),'[]') FROM vc.memory_extract_attempt t),
 'bundle',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,persona_ref),'[]') FROM vc.memory_import_bundle t),
 'jobs',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY owner_user_id,id),'[]') FROM vc.work_item t)
 )::text`
const plaintextRLSSnapshot = `SELECT jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'policy',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY c.relname,p.polname)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_policy p ON p.polrelid=c.oid WHERE n.nspname='vc' AND c.relname IN ('memory_item','conversation_summary','st_message_source','memory_extract_attempt','memory_import_bundle')`
const plaintextFunctionSnapshot = `SELECT jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid),'acl',p.proacl) ORDER BY p.proname,p.oid)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vc' AND p.proname IN ('set_memory_temporal','record_st_summary','record_encrypted_conversation_summary','record_conversation_summary','backfill_stale_cipher_summary_batch','backfill_replace_summary_cipher','conversation_summary_cipher_ready')`

type plaintextExecer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func plaintextExec(t *testing.T, conn plaintextExecer, query string, args ...any) {
	t.Helper()
	if _, err := conn.Exec(context.Background(), query, args...); err != nil {
		t.Fatal(err)
	}
}
func plaintextQuery(t *testing.T, conn *pgx.Conn, query string) string {
	t.Helper()
	var result string
	if err := conn.QueryRow(context.Background(), query).Scan(&result); err != nil {
		t.Fatal(err)
	}
	return result
}
func plaintextOwnerTx(t *testing.T, conn *pgx.Conn, owner int) pgx.Tx {
	t.Helper()
	tx, err := conn.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	plaintextExec(t, tx, `SELECT vc.set_owner_context($1,'migration-test',vc._owner_binding_expected($1,'migration-test'))`, owner)
	return tx
}

func plaintextFixture(t *testing.T, conn *pgx.Conn, current, previous *postgres.FieldCipher, count int) string {
	t.Helper()
	plaintextExec(t, conn, `INSERT INTO vc._owner_binding_secret VALUES(1,'synthetic-migration-owner-binding-secret');
 INSERT INTO vc.vc_user(id,display_name) VALUES(1,'migration-one'),(2,'migration-two');
 INSERT INTO vc.identity_account(id,username,password_hash,role,display_name) VALUES(1,'migration-one','synthetic','USER','one'),(2,'migration-two','synthetic','USER','two');
 INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(1,10,'archive-001'),(2,10,'archive-001');
 INSERT INTO vc.conversation(owner_user_id,id,relationship_id) VALUES(1,20,10),(2,20,10);`)
	plaintextExec(t, conn, `INSERT INTO vc.memory_item(owner_user_id,id,relationship_id,scope,summary,status,created_at,temporal_cipher,event_at,event_status,event_expires_at,deleted_at,source_invalidated_at)
 SELECT o,i,10,'RELATIONSHIP','memory '||o||'/'||i,CASE WHEN i=3 THEN 'EXPIRED' ELSE 'ACCEPTED' END,'2026-09-10T01:02:03Z',CASE WHEN i%7=0 THEN NULL ELSE '{"sourceExpression":"next Friday","eventDate":"2026-10-30","sourceTimezone":"Asia/Shanghai"}' END,'2026-10-30T01:00:00Z','PLANNED','2026-10-31T01:00:00Z',CASE WHEN i=2 THEN '2026-10-01T00:00:00Z'::timestamptz END,CASE WHEN i=3 THEN '2026-10-02T00:00:00Z'::timestamptz END
 FROM generate_series(1,2)o CROSS JOIN generate_series(1,$1::int)i`, count)
	plaintextExec(t, conn, `UPDATE vc.memory_item SET superseded_at='2026-10-03T00:00:00Z',superseded_by_memory_id=2 WHERE id=1;
 SELECT setval('vc.memory_id_seq',10000);`)
	plaintextExec(t, conn, `INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,valid,prev_id,created_at)
 SELECT o,i,20,'summary '||o||'/'||i,'synthetic','1','1',1,'ECONOMY',i%2=0,CASE WHEN i>1 THEN i-1 END,'2026-09-10T01:02:03Z' FROM generate_series(1,2)o CROSS JOIN generate_series(1,$1::int)i`, count)
	plaintextExec(t, conn, `INSERT INTO vc.st_message_source(owner_user_id,id,conversation_id,message_id,candidate_id,source_revision,source_generation,source_ref,role,content_cipher,present,settled,eligible,suppressed,source_timestamp,source_timezone,source_position)
 SELECT o,i,20,('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('00000000-0000-4000-8001-'||lpad(i::text,12,'0'))::uuid,7,4,'synthetic-source-'||i,'user','source '||o||'/'||i,i%2=0,true,true,i%3=0,'2026-09-10T01:02:03Z','Asia/Shanghai',i FROM generate_series(1,2)o CROSS JOIN generate_series(1,$1::int)i`, count)
	plaintextExec(t, conn, `INSERT INTO vc.memory_extract_attempt(owner_user_id,id,work_item_id,generation_id,attempt_no,provider_id,supplier_name,model_id,allowed_categories,status,billing_disposition,output_payload,attempt_started_at,terminal_at)
 SELECT o,i,100+i,200+i,1,'synthetic','synthetic','synthetic',ARRAY['MEMORY_SNIPPET'],'SUCCEEDED','USAGE_REPORTED',CASE WHEN i%8=0 THEN NULL ELSE '{"items":[{"summary":"attempt '||o||'/'||i||'"}]}' END,'2026-09-10T01:02:03Z','2026-09-10T01:02:04Z' FROM generate_series(1,2)o CROSS JOIN generate_series(1,$1::int)i`, count)
	plaintextExec(t, conn, `INSERT INTO vc.memory_import_bundle(owner_user_id,persona_ref,item_count,payload,created_at)
 SELECT o,'archive-'||lpad(i::text,3,'0'),2,jsonb_build_array(jsonb_build_object('summary','bundle '||o||'/'||i||' first','ordinal',1,'extra',jsonb_build_object('keep',true)),jsonb_build_object('summary','bundle '||o||'/'||i||' second','ordinal',2)),'2026-09-10T01:02:03Z' FROM generate_series(1,2)o CROSS JOIN generate_series(1,$1::int)i`, count)
	want := plaintextQuery(t, conn, plaintextSnapshot)
	encode := func(s string, mode int) string {
		if mode%4 == 0 {
			return s
		}
		c := current
		if mode%4 != 1 {
			c = previous
		}
		v, err := c.Encrypt(s)
		if err != nil {
			t.Fatal(err)
		}
		if mode%4 == 3 {
			v = "enc1:" + strings.TrimPrefix(v, previous.CurrentPrefix())
		}
		return v
	}
	for _, column := range []struct{ table, field string }{{"memory_item", "summary"}, {"memory_item", "temporal_cipher"}, {"conversation_summary", "summary"}, {"st_message_source", "content_cipher"}, {"memory_extract_attempt", "output_payload"}} {
		rows, err := conn.Query(context.Background(), fmt.Sprintf("SELECT owner_user_id,id,%s FROM vc.%s WHERE %s IS NOT NULL ORDER BY owner_user_id,id", column.field, column.table, column.field))
		if err != nil {
			t.Fatal(err)
		}
		batch := &pgx.Batch{}
		for rows.Next() {
			var owner, id int
			var value string
			if err := rows.Scan(&owner, &id, &value); err != nil {
				t.Fatal(err)
			}
			batch.Queue(fmt.Sprintf("UPDATE vc.%s SET %s=$3 WHERE owner_user_id=$1 AND id=$2", column.table, column.field), owner, id, encode(value, id+owner))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		rows.Close()
		br := conn.SendBatch(context.Background(), batch)
		if err := br.Close(); err != nil {
			t.Fatal(err)
		}
	}
	rows, err := conn.Query(context.Background(), `SELECT owner_user_id,persona_ref,payload FROM vc.memory_import_bundle ORDER BY owner_user_id,persona_ref`)
	if err != nil {
		t.Fatal(err)
	}
	batch := &pgx.Batch{}
	for rows.Next() {
		var owner int
		var persona string
		var payload []byte
		if err := rows.Scan(&owner, &persona, &payload); err != nil {
			t.Fatal(err)
		}
		var items []map[string]any
		if err := json.Unmarshal(payload, &items); err != nil {
			t.Fatal(err)
		}
		for i, item := range items {
			item["summary"] = encode(item["summary"].(string), i+owner+1)
		}
		data, err := json.Marshal(items)
		if err != nil {
			t.Fatal(err)
		}
		batch.Queue(`UPDATE vc.memory_import_bundle SET payload=$3::jsonb WHERE owner_user_id=$1 AND persona_ref=$2`, owner, persona, string(data))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	br := conn.SendBatch(context.Background(), batch)
	if err := br.Close(); err != nil {
		t.Fatal(err)
	}
	return want
}

func plaintextTestDatabase(t *testing.T) string {
	t.Helper()
	const image = "pgvector/pgvector:0.8.5-pg18@sha256:12a379b47ad65289572ea0756efc11b7c241a6662833e8af7038cd3b73d647e0"
	out, err := exec.Command("docker", "--context", "orbstack", "run", "-d", "--rm", "--name", fmt.Sprintf("vc-w08-migration-%d", os.Getpid()), "-e", "POSTGRES_PASSWORD=vc", "-e", "POSTGRES_DB=baseline", "-p", "127.0.0.1::5432", image).CombinedOutput()
	if err != nil {
		t.Fatalf("start migration test database: %s: %v", out, err)
	}
	id := strings.TrimSpace(string(out))
	t.Cleanup(func() {
		if out, err := exec.Command("docker", "--context", "orbstack", "rm", "-f", id).CombinedOutput(); err != nil {
			t.Errorf("remove migration test container: %s: %v", out, err)
		}
	})
	out, err = exec.Command("docker", "--context", "orbstack", "port", id, "5432/tcp").Output()
	if err != nil {
		t.Fatal(err)
	}
	address := strings.TrimSpace(strings.Split(string(out), "\n")[0])
	dsn := "postgres://postgres:vc@" + address + "/baseline?sslmode=disable"
	var conn *pgx.Conn
	deadline := time.Now().Add(45 * time.Second)
	for time.Now().Before(deadline) {
		conn, err = pgx.Connect(context.Background(), dsn)
		if err == nil {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		t.Fatal("migration test database did not become ready")
	}
	defer conn.Close(context.Background())
	files, err := filepath.Glob("sql/V*.sql")
	if err != nil {
		t.Fatal(err)
	}
	version := func(path string) int {
		base := filepath.Base(path)
		cut := strings.Index(base, "__")
		n, err := strconv.Atoi(base[1:cut])
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	sort.Slice(files, func(i, j int) bool { return version(files[i]) < version(files[j]) })
	plaintextExec(t, conn, `CREATE TABLE public.vc_schema_history(version bigint PRIMARY KEY,name text NOT NULL,applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),execution_ms bigint NOT NULL)`)
	applied := 0
	for _, file := range files {
		n := version(file)
		if n > 145 {
			continue
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := conn.Exec(context.Background(), string(raw)); err != nil {
			t.Fatalf("V%d baseline: %v", n, err)
		}
		plaintextExec(t, conn, `INSERT INTO public.vc_schema_history(version,name,execution_ms) VALUES($1,$2,0)`, n, filepath.Base(file))
		applied++
	}
	if applied != 145 {
		t.Fatalf("baseline migrations=%d", applied)
	}
	return dsn
}
func plaintextClone(t *testing.T, baseDSN, name string) (string, *pgx.Conn) {
	t.Helper()
	ctx := context.Background()
	base, err := pgx.Connect(ctx, baseDSN)
	if err != nil {
		t.Fatal(err)
	}
	db := "w08_" + name
	plaintextExec(t, base, `CREATE DATABASE `+pgx.Identifier{db}.Sanitize()+` TEMPLATE baseline`)
	if err := base.Close(ctx); err != nil {
		t.Fatal(err)
	}
	dsn := strings.Replace(baseDSN, "/baseline?", "/"+db+"?", 1)
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := conn.Close(context.Background()); err != nil {
			t.Error(err)
		}
	})
	return dsn, conn
}
