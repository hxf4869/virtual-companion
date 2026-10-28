//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func TestSTMemoryExtractQueueAttemptAndLateWriteFence(t *testing.T) {
	store := resetCatalogFixtures(t)
	ctx := context.Background()
	t.Cleanup(func() { store.UseSTSourceReader(nil); store.UseCipher(nil) })
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('prov-a','model-a',1,0.001,0.002) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveProviderConfig(ctx, 7, SaveProvider{ProviderID: "prov-a", DisplayName: "Source extraction", Protocol: ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic", State: ProviderEnabled, Models: []ProviderModel{catalogModel("memory", "model-a", intPtr(32768))}}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SavePurposeBinding(ctx, 7, SavePurposeBinding{Purpose: "MEMORY_EXTRACTION_DEDUP_SUMMARY", ProviderID: "prov-a", ProfileKey: "memory", State: ProviderEnabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	binding, err := store.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "extract-card", Mode: "COMPANION"})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/source/one.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我喜欢乌龙茶", Eligible: true, Settled: false}}}
	store.UseSTSourceReader(sourceReaderFunc(func(_ context.Context, owner int64, queries []stsource.Query) ([]stsource.Snapshot, error) {
		return []stsource.Snapshot{snapshot}, nil
	}))
	reconcile := func() {
		t.Helper()
		if _, err := store.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
			t.Fatal(err)
		}
	}
	claim := func() []JobClaim {
		t.Helper()
		rows, err := store.ClaimJobs(ctx, 30*time.Second, 30*time.Second, 30*time.Second, 8, 0, 1)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	reconcile()
	if rows := claim(); len(rows) != 0 {
		t.Fatal("unsettled source created extract work")
	}
	snapshot.Revision = 2
	snapshot.Messages[0].Settled = true
	reconcile()
	rows := claim()
	if len(rows) != 1 || rows[0].Kind != "ST_MEMORY_EXTRACT" {
		t.Fatalf("extract claims count=%d", len(rows))
	}
	c := rows[0]
	input, err := store.ReadSTMemoryExtractInput(ctx, 1, c.JobID, c.RefID)
	if err != nil || input.SourceRef == "" || input.UserContent != snapshot.Messages[0].Text || input.SourceMessageID != nil || input.AssistantMessageID != nil {
		t.Fatalf("source input missing or fabricated generation: %v", err)
	}
	prep, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, c.JobID, c.RefID, c.Token, c.Fence, "prov-a", "Source extraction", "model-a", 128)
	if err != nil || prep.Decision != "CONSENT_WITHDRAWN" {
		t.Fatalf("consent guard=%s err=%v", prep.Decision, err)
	}
	for _, kind := range requiredConsents {
		if _, err := store.RecordConsent(ctx, 1, kind, "test", true); err != nil {
			t.Fatal(err)
		}
	}
	prep, err = store.PrepareSTMemoryExtractAttempt(ctx, 1, c.JobID, c.RefID, c.Token, c.Fence, "prov-a", "Source extraction", "model-a", 128)
	if err != nil || prep.Decision != "EXTRACTABLE" || prep.AttemptID < 1 {
		t.Fatalf("prepare=%s err=%v", prep.Decision, err)
	}
	var content string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT content_cipher FROM vc.st_message_source WHERE owner_user_id=1 AND id=$1`, c.RefID).Scan(&content)
	}); err != nil {
		t.Fatal(err)
	}
	if content != snapshot.Messages[0].Text {
		t.Fatal("source snapshot is not stored as plaintext")
	}
	// Invalidate the persisted source while the extraction is out at a provider.
	snapshot.Revision = 3
	snapshot.Messages = make([]stsource.Message, 0)
	reconcile()
	inTokens, outTokens := int64(128), int64(20)
	count, err := store.RecordMemoryExtractOutcome(ctx, 1, c.JobID, prep.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED", InputTokens: &inTokens, OutputTokens: &outTokens, OutputPayload: `[{"summary":"late"}]`})
	if err != nil || count != 0 {
		t.Fatalf("cancelled attempt accepted late result: rows=%d err=%v", count, err)
	}
	_, err = store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{RelationshipID: binding.RelationshipID, ConversationID: binding.ConversationID, Summary: "喜欢乌龙茶", Evidence: []string{input.SourceRef}, IdempotencyKey: "st-late"})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("late memory save=%v", err)
	}
	var status string
	var payload *string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT status,output_payload FROM vc.memory_extract_attempt WHERE owner_user_id=1 AND id=$1`, prep.AttemptID).Scan(&status, &payload)
	}); err != nil {
		t.Fatal(err)
	}
	if status != "ABANDONED" || payload != nil {
		t.Fatal("obsolete attempt retained a replayable result")
	}
	// Restoring a candidate gets a new generation and a different durable job.
	snapshot.Revision = 4
	snapshot.Messages = []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "我喜欢乌龙茶", Eligible: true, Settled: true}}
	reconcile()
	next := claim()
	if len(next) != 1 || next[0].JobID == c.JobID {
		t.Fatal("restored source did not receive new fenced work")
	}
	fresh, err := store.ReadSTMemoryExtractInput(ctx, 1, next[0].JobID, next[0].RefID)
	if err != nil || fresh.SourceRef == input.SourceRef {
		t.Fatal("restored source revived old task identity")
	}
	freshPrep, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, next[0].JobID, next[0].RefID, next[0].Token, next[0].Fence, "prov-a", "Source extraction", "model-a", 128)
	if err != nil || freshPrep.Decision != "EXTRACTABLE" {
		t.Fatalf("fresh prepare=%s err=%v", freshPrep.Decision, err)
	}
	if _, err := store.RecordMemoryExtractOutcome(ctx, 1, next[0].JobID, freshPrep.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED", InputTokens: &inTokens, OutputTokens: &outTokens, OutputPayload: "[]"}); err != nil {
		t.Fatal(err)
	}
	memory, err := store.CreateAutoSavedMemory(ctx, 1, AutoSavedMemoryCreate{RelationshipID: binding.RelationshipID, ConversationID: binding.ConversationID, Summary: "喜欢乌龙茶", Evidence: []string{fresh.SourceRef}, IdempotencyKey: "st-current"})
	if err != nil || memory.Status != "ACCEPTED" {
		t.Fatalf("fresh extraction save=%v", err)
	}
}
