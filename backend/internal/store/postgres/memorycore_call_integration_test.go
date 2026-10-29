//go:build integration

package postgres

import (
	"context"
	"errors"
	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"testing"
	"time"
)

func TestMemoryCoreCallAccountingAndReplay(t *testing.T) {
	s := resetCatalogFixtures(t)
	ctx := context.Background()
	t.Cleanup(func() { s.UseSTSourceReader(nil); s.UseCipher(nil) })
	if err := IsolationSuperExec(ctx, `INSERT INTO vc.model_unit_price(provider_id,model_id,price_version,input_usd_per_1k,output_usd_per_1k) VALUES ('prov-a','model-a',1,0.001,0.002) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveProviderConfig(ctx, 7, SaveProvider{ProviderID: "prov-a", DisplayName: "Synthetic", Protocol: ProtocolOpenAIChat, BaseURL: "https://example.test/v1", Credential: "synthetic", State: ProviderEnabled, Models: []ProviderModel{seedPricedModel("memory", "model-a", intPtr(32768))}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SavePurposeBinding(ctx, 7, SavePurposeBinding{Purpose: PurposeMemoryExtraction, ProviderID: "prov-a", ProfileKey: "memory", State: ProviderEnabled}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	for _, kind := range requiredConsents {
		if _, err := s.RecordConsent(ctx, 1, kind, "test", true); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "synthetic-memorycore", Mode: "COMPANION"}); err != nil {
		t.Fatal(err)
	}
	snapshot := stsource.Snapshot{ChatIdentity: sourceChat, State: "PRESENT", Revision: 1, Location: "chats/source/one.jsonl", Messages: []stsource.Message{{MessageID: sourceMessage, CandidateID: sourceCandidate, Revision: 1, Role: "user", Text: "合成记忆", Eligible: true, Settled: true}}}
	s.UseSTSourceReader(sourceReaderFunc(func(context.Context, int64, []stsource.Query) ([]stsource.Snapshot, error) {
		return []stsource.Snapshot{snapshot}, nil
	}))
	if _, err := s.ReconcileSTSources(ctx, 1, []string{sourceChat}); err != nil {
		t.Fatal(err)
	}
	jobs, err := s.ClaimJobs(ctx, time.Minute, time.Minute, time.Minute, 8, 0, 1)
	if err != nil || len(jobs) != 1 {
		t.Fatalf("claim %v %v", jobs, err)
	}
	job := jobs[0]
	in := MemoryCoreCall{Owner: 1, Job: job.JobID, Source: job.RefID, ClaimToken: job.Token, ClaimFence: job.Fence, OperationID: "synthetic-op", Stage: "l1-extraction", CallSequence: 1, ProviderID: "prov-a", SupplierName: "Synthetic", ModelID: "model-a", InputTokens: 100, OutputTokens: 64}
	first, err := s.PrepareMemoryCoreCall(ctx, in)
	if err != nil || first.AttemptID <= 0 {
		t.Fatalf("prepare %+v %v", first, err)
	}
	if _, err := s.PrepareMemoryCoreCall(ctx, in); !errors.Is(err, ErrConflict) {
		t.Fatalf("in flight replay %v", err)
	}
	input, output := int64(10), int64(4)
	if n, err := s.RecordMemoryExtractOutcome(ctx, 1, job.JobID, first.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED", InputTokens: &input, OutputTokens: &output}); err != nil || n != 1 {
		t.Fatalf("outcome %d %v", n, err)
	}
	if _, err := s.PrepareMemoryCoreCall(ctx, in); !errors.Is(err, ErrConflict) {
		t.Fatalf("terminal replay %v", err)
	}
	in.CallSequence = 2
	in.Stage = "l1-conflict-detection"
	second, err := s.PrepareMemoryCoreCall(ctx, in)
	if err != nil || second.AttemptID == first.AttemptID {
		t.Fatalf("second %+v %v", second, err)
	}
	if n, err := s.RecordMemoryExtractOutcome(ctx, 1, job.JobID, second.AttemptID, MemoryExtractOutcome{Status: "FAILED", FailureCode: "TIMEOUT_TOTAL"}); err != nil || n != 1 {
		t.Fatalf("timeout outcome %d %v", n, err)
	}
	var attempts int
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.memory_extract_attempt WHERE owner_user_id=1 AND work_item_id=$1 AND memorycore_operation_id='synthetic-op' AND status<>'CREATED'`, job.JobID).Scan(&attempts)
	}); err != nil || attempts != 2 {
		t.Fatalf("attempt count %d %v", attempts, err)
	}
	var ledger int
	db, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	var unknown int
	if err := db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='SETTLED'), count(*) FILTER (WHERE status='UNKNOWN' AND actual_usd IS NULL AND reserved_usd > 0) FROM vc.model_cost_reservation WHERE owner_user_id=1 AND work_item_id=$1`, job.JobID).Scan(&ledger, &unknown); err != nil || ledger != 1 || unknown != 1 {
		t.Fatalf("ledger settled=%d unknown=%d err=%v", ledger, unknown, err)
	}
	in.CallSequence = 3
	in.ClaimFence = "stale"
	denied, err := s.PrepareMemoryCoreCall(ctx, in)
	if err != nil || denied.Decision != "CLAIM_LOST" {
		t.Fatalf("stale fence %+v %v", denied, err)
	}
}
