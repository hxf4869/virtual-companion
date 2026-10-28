//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

// This transport double ranks only the trusted allowlist. SQLite/search/model
// behavior is covered separately by memorycore-native; these tests exercise the
// production Go source, date, branch and final-publication gates.
func memoryEngineFixture(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES(1,'memory-owner','synthetic','USER','ACTIVE','owner') ON CONFLICT(id) DO UPDATE SET status='ACTIVE';
 INSERT INTO vc.embedding_config(singleton,model,artifact_version,dimensions,query_preprocessing,document_preprocessing,normalization,state,revision,space_id,updated_by)
 VALUES(true,'synthetic','fixture',2,'identity-v1','identity-v1','l2','ENABLED',1,'11111111-1111-4111-8111-111111111111',1)
 ON CONFLICT(singleton) DO UPDATE SET state='ENABLED';`); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/internal/search" {
			w.WriteHeader(404)
			return
		}
		var input struct {
			Allowed []string `json:"allowedRecordIds"`
			Limit   int      `json:"topK"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		sort.Strings(input.Allowed)
		out := []map[string]string{}
		for _, id := range input.Allowed {
			out = append(out, map[string]string{"record_id": id})
			if input.Limit > 0 && len(out) >= input.Limit {
				break
			}
		}
		json.NewEncoder(w).Encode(out)
	}))
	client, err := memoryengine.New(server.URL, "synthetic-memory-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	t.Cleanup(func() { testEnv.store.UseMemoryEngine(nil); server.Close() })
}
func projectEngineFixture(t *testing.T, m Memory) {
	t.Helper()
	if err := IsolationSuperExec(context.Background(), `INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(1,$1,0) ON CONFLICT DO NOTHING`, m.RelationshipID); err != nil {
		t.Fatal(err)
	}
	if err := IsolationSuperExec(context.Background(), `UPDATE vc.memory_item SET engine_record_id=$2,engine_version=1,engine_operation_id=$3 WHERE owner_user_id=1 AND id=$1`, m.ID, fmt.Sprintf("fixture-record-%d", m.ID), fmt.Sprintf("fixture-op-%d", m.ID)); err != nil {
		t.Fatal(err)
	}
}
func profileEngineFixture(t *testing.T, b STBinding, ref, text string) {
	t.Helper()
	ctx := context.Background()
	var source, job, revision int64
	err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT s.id,COALESCE(mc.revision,0) FROM vc.st_message_source s LEFT JOIN vc.memorycore_scope mc ON mc.owner_user_id=s.owner_user_id AND mc.relationship_id=$2 WHERE s.owner_user_id=1 AND s.source_ref=$1`, ref, b.RelationshipID).Scan(&source, &revision)
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `INSERT INTO vc.work_item(owner_user_id,id,kind,ref_id,st_source_ref,status,claim_token,claim_fence,lease_expires_at) VALUES(1,nextval('vc.work_item_id_seq'),'ST_MEMORY_EXTRACT',$1,$2,'CLAIMED','profile-token','profile-fence',now()+interval '1 hour') ON CONFLICT(owner_user_id,st_source_ref) WHERE kind='ST_MEMORY_EXTRACT' DO UPDATE SET status='CLAIMED',claim_token='profile-token',claim_fence='profile-fence',lease_expires_at=now()+interval '1 hour'`, source, ref); err != nil {
		t.Fatal(err)
	}
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT id FROM vc.work_item WHERE owner_user_id=1 AND kind='ST_MEMORY_EXTRACT' AND st_source_ref=$1`, ref).Scan(&job)
	}); err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(1,$1,$2) ON CONFLICT DO NOTHING`, b.RelationshipID, revision); err != nil {
		t.Fatal(err)
	}
	if err = IsolationSuperExec(ctx, `INSERT INTO vc.memorycore_operation(owner_user_id,job_id,relationship_id,source_id,operation_id,scope,revision,state) VALUES(1,$1,$2,$3,$4,'{}',$5,'PUBLISHED') ON CONFLICT(owner_user_id,job_id) DO UPDATE SET state='PUBLISHED',revision=excluded.revision`, job, b.RelationshipID, source, fmt.Sprintf("fixture-profile-%d", job), revision); err != nil {
		t.Fatal(err)
	}
	err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `SELECT vc.go_record_memorycore_profile(1,$1,'profile-token','profile-fence',$2,$3)`, job, []string{ref}, text)
		return e
	})
	if err != nil {
		t.Fatal(err)
	}
}
func nativeSourceRecall(ctx context.Context, b STBinding, revision int64) ([]Memory, error) {
	result, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: b.ChatIdentity, Revision: revision, Enabled: true, BudgetTokens: 1024})
	if err != nil {
		return nil, err
	}
	out := []Memory{}
	for _, raw := range result.MemoryIDs {
		id, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			return nil, err
		}
		m, err := testEnv.store.GetMemory(ctx, 1, id)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, nil
}
