//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

type rightsEngineFixture struct {
	unavailable     bool
	pending         bool
	withholdErasure bool
	calls           int
	owners          []string
}

func installRightsEngine(t *testing.T, s *Store) *rightsEngineFixture {
	t.Helper()
	f := &rightsEngineFixture{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Scope struct {
				OwnerID string `json:"ownerId"`
			} `json:"scope"`
			AccountDeletion bool `json:"accountDeletion"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil {
			t.Error("invalid engine request")
			w.WriteHeader(400)
			return
		}
		f.calls++
		f.owners = append(f.owners, in.Scope.OwnerID)
		if f.unavailable {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/export-owner":
			json.NewEncoder(w).Encode(map[string]any{"records": []any{map[string]string{"id": "engine-record", "content": "引擎域内容", "ownerId": in.Scope.OwnerID}}, "sources": []any{}, "profiles": []any{}, "operations": []any{}, "jsonl": []any{}})
		case "/internal/clear-owner":
			if !in.AccountDeletion {
				t.Error("missing account deletion fence")
			}
			status := "cleared"
			if f.pending {
				status = "pending"
			}
			json.NewEncoder(w).Encode(map[string]any{"status": status, "physicalErasure": status == "cleared" && !f.withholdErasure})
		default:
			t.Errorf("unexpected engine action %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	client, err := memoryengine.New(server.URL, "synthetic-memorycore-token")
	if err != nil {
		t.Fatal(err)
	}
	s.UseMemoryEngine(client)
	t.Cleanup(func() { s.UseMemoryEngine(nil); server.Close() })
	return f
}
func TestMemoryCoreAccountDeletionBlocksCascadeUntilOnlineDomainCompletes(t *testing.T) {
	s, _ := rightsFixture(t)
	engine := installRightsEngine(t, s)
	ctx := context.Background()
	engine.unavailable = true
	if err := s.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if done, err := s.ClearSTAccountData(ctx, 1); err != nil || !done {
		t.Fatalf("ST=%v %v", done, err)
	}
	if done, err := s.ClearMemoryCoreAccountData(ctx, 1); err != nil || done {
		t.Fatalf("engine unavailable=%v %v", done, err)
	}
	if err := s.DeleteAccount(ctx, 1); err == nil {
		t.Fatal("Go deletion bypassed engine pending")
	}
	engine.unavailable = false
	engine.pending = true
	if done, err := s.ClearMemoryCoreAccountData(ctx, 1); err != nil || done {
		t.Fatalf("partial engine=%v %v", done, err)
	}
	engine.pending = false
	if done, err := s.ClearMemoryCoreAccountData(ctx, 1); err != nil || !done {
		t.Fatalf("engine completion=%v %v", done, err)
	}
	if done, err := s.ClearMemoryCoreAccountData(ctx, 1); err != nil || !done || engine.calls != 3 {
		t.Fatalf("receipt replay=%v %v calls=%d", done, err, engine.calls)
	}
	if err := s.DeleteAccount(ctx, 1); err != nil {
		t.Fatal(err)
	}
	for _, owner := range engine.owners {
		if owner != "1" {
			t.Fatalf("engine crossed owner: %s", owner)
		}
	}
	if _, found, err := s.LookupIdentity(ctx, "disabled"); err != nil || !found {
		t.Fatal("other account deleted")
	}
}
func TestMemoryCoreAccountDeletionStaysPendingWithoutPhysicalErasure(t *testing.T) {
	s, _ := rightsFixture(t)
	engine := installRightsEngine(t, s)
	engine.withholdErasure = true
	ctx := context.Background()
	if err := s.RequestAccountDeletion(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if done, err := s.ClearSTAccountData(ctx, 1); err != nil || !done {
		t.Fatalf("ST=%v %v", done, err)
	}
	if done, err := s.ClearMemoryCoreAccountData(ctx, 1); err != nil || done {
		t.Fatalf("cleared without erasure completed=%v %v", done, err)
	}
	if engine.calls != 2 {
		t.Fatalf("same deletion task did not retry the engine: calls=%d", engine.calls)
	}
	var status string
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.get_memorycore_account_deletion_current()`).Scan(&status)
	}); err != nil {
		t.Fatal(err)
	}
	if status != "PENDING" {
		t.Fatalf("deletion receipt %s", status)
	}
	if err := s.DeleteAccount(ctx, 1); err == nil {
		t.Fatal("account deleted before physical erasure")
	}
}
func TestMemoryCoreExportIncludesEngineDomainAndRejectsConfigurationLoss(t *testing.T) {
	s, _ := rightsFixture(t)
	engine := installRightsEngine(t, s)
	ctx := context.Background()
	out, err := s.ExportV2OwnerData(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(out.MemoryCore["records"].([]any)) != 1 {
		t.Fatal("engine domain omitted")
	}
	found := false
	for _, d := range out.Domains {
		if d.System == "EXTERNAL_MEMORY_ENGINE" && d.State == "COMPLETE" {
			found = true
		}
	}
	if !found {
		t.Fatal("engine manifest not complete")
	}
	engine.unavailable = true
	if _, err := s.ExportV2OwnerData(ctx, 1); !errors.Is(err, stsource.ErrUnavailable) {
		t.Fatalf("engine failure=%v", err)
	}
	s.UseMemoryEngine(nil)
	if _, err := s.ExportV2OwnerData(ctx, 1); !errors.Is(err, stsource.ErrUnavailable) {
		t.Fatalf("missing engine=%v", err)
	}
}

func TestMemoryCoreBackupRightsSQLUsesCurrentSuppressionWithoutRuntimeOwnerContext(t *testing.T) {
	s, _ := rightsFixture(t)
	ctx := context.Background()
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "backup-rights", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "synthetic backup", Eligible: true, Settled: true}}}
	s.UseSTSourceReader(sourceReaderFunc(func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
		return []stsource.Snapshot{snapshot}, nil
	}))
	if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	m := acceptedSourceMemory(t, binding, currentSourceRef(t))
	if err := IsolationSuperExec(ctx, `UPDATE vc.memory_item SET engine_record_id='backup-record',engine_version=1 WHERE owner_user_id=1 AND id=$1`, m.ID); err != nil {
		t.Fatal(err)
	}
	script := filepath.Join("..", "..", "..", "..", "integrations", "sillytavern", "scripts", "lib", "memorycore-backup.py")
	query, err := exec.Command("python3", "-c", "import runpy,sys; print(runpy.run_path(sys.argv[1])['RIGHTS_SQL'])", script).Output()
	if err != nil {
		t.Fatal(err)
	}
	conn, err := pgx.Connect(ctx, testEnv.superDSN)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	read := func() map[string]any {
		t.Helper()
		var raw []byte
		if err := conn.QueryRow(ctx, string(query)).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var result map[string]any
		if err := json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
		return result["owners"].(map[string]any)["1"].(map[string]any)
	}
	if len(read()["recordIds"].([]any)) != 1 {
		t.Fatal("backup lost an allowed record")
	}
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.delete_memory($1,$2)`, 1, m.ID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	current := read()
	if len(current["recordIds"].([]any)) != 0 || len(current["sourceIds"].([]any)) != 0 || len(current["suppressedSources"].([]any)) != 1 {
		t.Fatal("latest suppression was not captured")
	}
}
