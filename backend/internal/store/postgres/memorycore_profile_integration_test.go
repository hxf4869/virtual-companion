//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/memoryengine"
	"github.com/jackc/pgx/v5"
)

func TestEngineProfileExcludesOtherChatAndMergedDependencies(t *testing.T) {
	a, snapshots := stMemoryFixture(t)
	ctx := context.Background()
	chatB := "10000000-0000-0000-0000-000000000077"
	b, err := testEnv.store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: chatB, CharacterRef: "memory-card", Mode: "COMPANION", RelationshipID: &a.RelationshipID})
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	snapshots[sourceChat] = stMemorySnapshot(sourceChat, "A 的固定阅读计划", at)
	snapshots[chatB] = stMemorySnapshot(chatB, "B 正在讨论另一个问题", at)
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat, chatB}); err != nil {
		t.Fatal(err)
	}
	refA, refB := refForChat(t, sourceChat), refForChat(t, chatB)
	memoryA := addSTMemory(t, a, "A 的固定阅读计划", refA)
	addSTMemory(t, b, "B 正在讨论另一个问题", refB)
	// A cross-chat merged record belongs to A's conversation but still depends
	// on B. The profile builder must exclude the whole record, not trim its refs.
	merged, err := testEnv.store.CreateMemoryCandidate(ctx, 1, MemoryCreate{RelationshipID: a.RelationshipID, ConversationID: &a.ConversationID, Scope: "RELATIONSHIP", Summary: "A 与 B 的合并记忆", Evidence: []string{refA, refB}})
	if err != nil {
		t.Fatal(err)
	}
	merged, err = testEnv.store.ConfirmMemory(ctx, 1, merged.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	projectEngineFixture(t, merged)
	profileEngineFixture(t, a, refA, "被新引擎摘要替代的旧值")
	claim := JobClaim{OwnerID: 1, Kind: "ST_MEMORY_EXTRACT"}
	var revision int64
	var dependency string
	if err = testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT w.id,w.ref_id,w.claim_token,w.claim_fence,mc.revision FROM vc.work_item w JOIN vc.memorycore_scope mc ON mc.owner_user_id=w.owner_user_id AND mc.relationship_id=$2 WHERE w.owner_user_id=1 AND w.kind='ST_MEMORY_EXTRACT' AND w.st_source_ref=$1`, refA, a.RelationshipID).Scan(&claim.JobID, &claim.RefID, &claim.Token, &claim.Fence, &revision); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT 'source-'||id||'-'||source_revision||'-'||source_generation FROM vc.st_message_source WHERE owner_user_id=1 AND source_ref=$1`, refA).Scan(&dependency)
	}); err != nil {
		t.Fatal(err)
	}
	expectedIDs := []string{fmt.Sprintf("fixture-record-%d", memoryA.ID)}
	expectedDependencies := []string{dependency}
	built, published := false, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			AllowedRecordIDs     []string `json:"allowedRecordIds"`
			VerifiedDependencies []string `json:"verifiedDependencies"`
			Publish              bool     `json:"publish"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/internal/operation-status":
			json.NewEncoder(w).Encode(map[string]string{"status": "unknown"})
		case "/internal/rebuild-profile":
			if !reflect.DeepEqual(input.AllowedRecordIDs, expectedIDs) {
				t.Errorf("profile A received other-chat or partially stripped merged record: got=%v want=%v", input.AllowedRecordIDs, expectedIDs)
			}
			if input.Publish {
				published = true
				if !reflect.DeepEqual(input.VerifiedDependencies, expectedDependencies) {
					t.Errorf("profile A verified dependencies include B: %v", input.VerifiedDependencies)
				}
			} else {
				built = true
			}
			json.NewEncoder(w).Encode(map[string]any{"status": "staged", "dependencies": expectedDependencies})
		case "/internal/read-profile":
			json.NewEncoder(w).Encode(map[string]any{"dependencies": expectedDependencies, "files": map[string]string{"persona.md": "A：固定阅读计划摘要"}})
		case "/internal/search":
			json.NewEncoder(w).Encode([]any{})
		default:
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	client, err := memoryengine.New(server.URL, "synthetic-profile-token")
	if err != nil {
		t.Fatal(err)
	}
	testEnv.store.UseMemoryEngine(client)
	op := EngineOperation{ID: fmt.Sprintf("fixture-profile-%d", claim.JobID), ProfileOperationID: fmt.Sprintf("profile-isolation-%d", claim.JobID), Scope: EngineScope(1, a.RelationshipID), Revision: revision, SourceRef: refA, Input: MemoryExtractInput{RelationshipID: a.RelationshipID, ConversationID: a.ConversationID}}
	if err = testEnv.store.BuildEngineProfile(ctx, claim, op, "synthetic-capability"); err != nil {
		t.Fatal(err)
	}
	if !built || !published {
		t.Fatal("profile did not traverse stage and verified publication")
	}
	// ST's active-send gate deliberately makes all of B's messages unsettled.
	// A's independently verified summary must remain available to B's next send.
	snapshots[chatB].Messages[0].Settled = false
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{chatB}); err != nil {
		t.Fatal(err)
	}
	result, err := testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: chatB, Revision: 1, Enabled: true, BudgetTokens: 1024})
	if err != nil || len(result.SummaryIDs) != 1 || !strings.Contains(result.Block, "A：固定阅读计划摘要") || strings.Contains(result.Block, "B 正在讨论") {
		t.Fatalf("B active-send incorrectly revoked A profile: %+v err=%v", result, err)
	}
	snapshots[sourceChat].Messages[0].Settled = false
	if _, err = testEnv.store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	result, err = testEnv.store.RecallSTMemory(ctx, 1, STMemoryRequest{ChatIdentity: chatB, Revision: 1, Enabled: true, BudgetTokens: 1024})
	if err != nil || len(result.SummaryIDs) != 0 || strings.Contains(result.Block, "A：固定阅读计划摘要") {
		t.Fatalf("actual unsettled dependency bypassed final gate: %+v err=%v", result, err)
	}
}
