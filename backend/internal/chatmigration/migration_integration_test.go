//go:build integration

package chatmigration

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/hxf4869/virtual-companion/internal/chattransfer"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/stsource"
)

func TestMain(m *testing.M) {
	if err := postgres.StartIsolation(); err != nil {
		fmt.Fprintln(os.Stderr, "synthetic migration database setup failed:", err)
		os.Exit(1)
	}
	code := m.Run()
	postgres.StopIsolation()
	os.Exit(code)
}

type observedSource struct{ snapshot stsource.Snapshot }

type migrationProbe struct {
	*postgres.Store
	failed string
}

func (p *migrationProbe) StageChatMigration(ctx context.Context, owner int64, m postgres.ChatMigrationManifest, c postgres.ChatMigrationChat, src chattransfer.Manifest, o chattransfer.Objects) error {
	err := p.Store.StageChatMigration(ctx, owner, m, c, src, o)
	if err != nil {
		p.failed = "stage"
	}
	return err
}
func (p *migrationProbe) VerifyChatMigration(ctx context.Context, owner int64, m postgres.ChatMigrationManifest) error {
	err := p.Store.VerifyChatMigration(ctx, owner, m)
	if err != nil {
		p.failed = "verify"
	}
	return err
}

func (r observedSource) Read(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
	return []stsource.Snapshot{r.snapshot}, nil
}

func TestIsolatedFirstSTMigrationResumeAndCurrentGoReverse(t *testing.T) {
	ctx := context.Background()
	s := postgres.IsolationStore()
	if err := postgres.IsolationSuperExec(ctx, `INSERT INTO vc.vc_user(id,display_name) VALUES(1,'synthetic'); INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES(1,'sx8-cli-synthetic','fixture','USER','ACTIVE','synthetic')`); err != nil {
		t.Fatal(err)
	}
	cipher, err := postgres.NewDefaultFieldCipher("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	if err != nil {
		t.Fatal(err)
	}
	s.UseCipher(cipher)
	chatID := "30000000-0000-4000-8000-000000000001"
	messageID := "30000000-0000-4000-8000-000000000002"
	candidateID := "30000000-0000-4000-8000-000000000003"
	binding, err := s.ResolveSTBinding(ctx, 1, postgres.STBindingInput{ChatIdentity: chatID, CharacterRef: "card", Mode: "COMPANION", DisplayName: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	s.UseSTSourceReader(observedSource{stsource.Snapshot{ChatIdentity: chatID, BranchRoot: chatID, State: "PRESENT", Revision: 1, Location: "chats/card/current.jsonl", Messages: []stsource.Message{{MessageID: messageID, CandidateID: candidateID, Revision: 1, Role: "user", Text: "synthetic before", Settled: true, Eligible: true}}}})
	if states, err := s.ReconcileSTSources(ctx, 1, []string{chatID}); err != nil || len(states) != 1 || states[0].State != "PRESENT" {
		t.Fatalf("source precondition: %v %+v", err, states)
	}
	base := t.TempDir()
	root := filepath.Join(base, "st")
	if err := os.MkdirAll(filepath.Join(root, ".vc-f2"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "chats/card"), 0700); err != nil {
		t.Fatal(err)
	}
	header := map[string]any{"unknown": json.Number("900719925474099312345"), "chat_metadata": map[string]any{"vc_f2": map[string]any{"id": chatID, "revision": 1}, "vc_branch_root": chatID, "vc_binding": map[string]any{"chatIdentity": chatID, "characterRef": "card", "conversationId": strconv.FormatInt(binding.ConversationID, 10), "relationshipId": strconv.FormatInt(binding.RelationshipID, 10)}}}
	message := map[string]any{"vc_message_id": messageID, "mes": "synthetic before", "is_user": true, "extra": map[string]any{"vc_source": map[string]any{"id": candidateID, "revision": 1, "generation": 1, "settled": true, "sourceTimestamp": nil, "sourceTimezone": nil}}}
	h, _ := json.Marshal(header)
	msg, _ := json.Marshal(message)
	if err := os.WriteFile(filepath.Join(root, "chats/card/current.jsonl"), append(append(h, '\n'), append(msg, '\n')...), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(root, ".vc-f2", chatID+".json"), map[string]any{"id": chatID, "state": "live", "path": "chats/card/current.jsonl"}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.Header.Get("Origin") != "" || req.Header.Get("Authorization") != "Bearer "+strings.Repeat("t", 32) {
			w.WriteHeader(403)
			return
		}
		var input struct {
			Owner string `json:"ownerAccountId"`
			Run   string `json:"runId"`
			Epoch string `json:"authorityEpoch"`
		}
		if json.NewDecoder(req.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		if strings.HasSuffix(req.URL.Path, "/freeze") {
			raw, _ := json.Marshal(map[string]any{"version": 1, "ownerAccountId": input.Owner, "closed": true, "runId": input.Run, "epoch": input.Epoch})
			if os.WriteFile(filepath.Join(root, ".vc-f2/chat-cutover.json"), raw, 0600) != nil {
				w.WriteHeader(503)
				return
			}
		}
		_ = json.NewEncoder(w).Encode(stsource.ChatCutoverStatus{OwnerAccountID: input.Owner, RunID: input.Run, AuthorityEpoch: input.Epoch, State: "DRAINED", Closed: true, Durable: true, ActiveHandlers: 0})
	}))
	defer server.Close()
	gate, err := stsource.NewClient(server.URL, strings.Repeat("t", 32))
	if err != nil {
		t.Fatal(err)
	}
	tool := os.Getenv("VC_SX8_SNAPSHOT_TOOL")
	if tool == "" {
		tool, err = filepath.Abs("../../../integrations/sillytavern/scripts/chat-migration-snapshot.mjs")
		if err != nil {
			t.Fatal(err)
		}
	}
	probe := &migrationProbe{Store: s}
	r := Runner{Store: probe, Gate: gate, Snapshot: Node{Tool: tool, ServiceToken: strings.Repeat("t", 32)}, Objects: fakeObjects{}}
	c := Config{Owner: 1, RunID: testRun, Direction: "ST_TO_GO", ExpectedEpoch: 1, STRoot: root, ArtifactRoot: filepath.Join(base, "artifacts"), STBaseURL: server.URL, AccountHandles: map[string]string{"1": "synthetic"}}
	if _, err := r.Run(ctx, c); err != nil {
		t.Fatalf("first migration: %v operation=%s", err, probe.failed)
	}
	state, err := s.GetChatStorageState(ctx, 1)
	if err != nil || state.Mode != "FROZEN" || state.AuthorityEpoch != 2 {
		t.Fatalf("verify only state: %+v %v", state, err)
	}
	c.Activate = true
	if _, err := r.Run(ctx, c); err != nil {
		t.Fatalf("resume+activate: %v", err)
	}
	// A post-cutover edit proves reverse export reads the current Go revision.
	edited, err := s.EditStoredMessage(ctx, 1, chatID, messageID, postgres.ChatMessageEditRequest{RequestID: "40000000-0000-4000-8000-000000000001", AuthorityEpoch: 3, BaseRevision: 1, CandidateID: &candidateID, Changes: []postgres.ChatFieldChange{{Path: []string{"mes"}, Before: postgres.ChatFieldValue{Exists: true, Value: "synthetic before"}, After: postgres.ChatFieldValue{Exists: true, Value: "synthetic after"}}}})
	if err != nil {
		t.Fatalf("post-cutover edit: %v", err)
	}
	c.RunID = "50000000-0000-4000-8000-000000000001"
	c.Direction = "GO_TO_ST"
	c.ExpectedEpoch = 3
	c.STRoot = filepath.Join(base, "restored")
	c.CharacterDirectories = map[string]string{"card": "restored-card"}
	if len(edited.Changed) != 1 || len(edited.Changed[0].Candidates) != 1 {
		t.Fatal("expected single edited candidate")
	}
	current := edited.Changed[0].Candidates[0]
	c.LatestRightsManifest = filepath.Join(base, "latest-rights.json")
	latest := postgres.ChatMigrationManifest{FormatVersion: 1, OwnerAccountID: 1, DeletionAndSuppressionRecords: []postgres.ChatData{{"type": "source", "chatId": chatID, "messageId": messageID, "candidateId": candidateID, "suppressed": true, "present": true, "sourceRevision": strconv.FormatInt(current.SourceRevision, 10), "sourceGeneration": strconv.FormatInt(current.SourceGeneration, 10)}}}
	if err := writeJSON(c.LatestRightsManifest, latest); err != nil {
		t.Fatal(err)
	}
	c.Activate = false
	if _, err := r.Run(ctx, c); err != nil {
		t.Fatalf("current reverse verify: %v", err)
	}
	rights, err := s.ChatMigrationSupplement(ctx, 1, c.RunID)
	if err != nil || len(rights.Chats) != 1 || len(rights.Chats[0].SourceRecords) != 1 || rights.Chats[0].SourceRecords[0]["suppressed"] != true {
		t.Fatal("external suppression was not merged into current Go rights")
	}
	c.Activate = true
	if _, err := r.Run(ctx, c); err != nil {
		t.Fatalf("current reverse resume+activate: %v", err)
	}
	body, err := os.ReadFile(filepath.Join(c.STRoot, "chats/restored-card/current.jsonl"))
	if err != nil || !strings.Contains(string(body), "synthetic after") || !strings.Contains(string(body), "900719925474099312345") {
		t.Fatalf("reverse lost current data or unknown fields: %v", err)
	}
	if _, err := os.Stat(filepath.Join(c.STRoot, ".vc-f2/chat-cutover.json")); !os.IsNotExist(err) {
		t.Fatal("restore gate still closed after proven CAS")
	}
	state, err = s.GetChatStorageState(ctx, 1)
	if err != nil || state.Mode != "ST" || state.AuthorityEpoch != 5 {
		t.Fatalf("reverse authority: %+v %v", state, err)
	}
	// Stage owns its additional prepared chunks through the existing durable
	// cleanup queue; exercise that same bounded worker collector explicitly.
	if _, err := s.CleanupChatTransfers(ctx, r.Objects, 256); err != nil {
		t.Fatal("staging collector failed")
	}
	if len(r.Objects.(fakeObjects)) != 0 {
		t.Fatal("staging objects retained after collector")
	}
	noTemporaryFiles(t, c)
}
