//go:build integration

package postgres

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
)

func memoryCoreCallFixture(t *testing.T) (*Store, STBinding, JobClaim) {
	t.Helper()
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
	binding, err := s.ResolveSTBinding(ctx, 1, STBindingInput{ChatIdentity: sourceChat, CharacterRef: "synthetic-memorycore", Mode: "COMPANION"})
	if err != nil {
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
	return s, binding, jobs[0]
}

func TestMemoryCoreCallAccountingAndReplay(t *testing.T) {
	s, _, job := memoryCoreCallFixture(t)
	ctx := context.Background()
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
	retried, err := s.PrepareMemoryCoreCall(ctx, in)
	if err != nil || retried.Decision != "RETRY_TIMEOUT" || retried.AttemptID != second.AttemptID {
		t.Fatalf("timeout retry %+v %v", retried, err)
	}
	if n, err := s.RecordMemoryExtractOutcome(ctx, 1, job.JobID, retried.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED", InputTokens: &input, OutputTokens: &output}); err != nil || n != 1 {
		t.Fatalf("retry outcome %d %v", n, err)
	}
	if err := s.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.memory_extract_attempt WHERE owner_user_id=1 AND work_item_id=$1 AND memorycore_operation_id='synthetic-op'`, job.JobID).Scan(&attempts)
	}); err != nil || attempts != 2 {
		t.Fatalf("retry inserted a new attempt: %d %v", attempts, err)
	}
	var ledger, unknown, held int
	db, err := pgx.Connect(ctx, IsolationSuperDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close(ctx)
	if err := db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='SETTLED'), count(*) FILTER (WHERE status='UNKNOWN' AND actual_usd IS NULL AND reserved_usd > 0), count(*) FILTER (WHERE status='HELD') FROM vc.model_cost_reservation WHERE owner_user_id=1 AND work_item_id=$1`, job.JobID).Scan(&ledger, &unknown, &held); err != nil || ledger != 2 || unknown != 1 || held != 0 {
		t.Fatalf("ledger settled=%d unknown=%d held=%d err=%v", ledger, unknown, held, err)
	}
	in.CallSequence = 3
	in.ClaimFence = "stale"
	denied, err := s.PrepareMemoryCoreCall(ctx, in)
	if err != nil || denied.Decision != "CLAIM_LOST" {
		t.Fatalf("stale fence %+v %v", denied, err)
	}
}

func TestForgetMemoryWhilePreparingMemoryCoreCall(t *testing.T) {
	s, binding, job := memoryCoreCallFixture(t)
	memory := addSTMemory(t, binding, "合成记忆", refForChat(t, sourceChat))

	runCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	done := make(chan struct{})
	var attemptID int64
	var attemptNo int
	var decision string
	var prepareErr error
	var forgotten bool
	forgetErr := s.WithOwner(runCtx, 1, func(ctx context.Context, tx pgx.Tx) error {
		// Pause forget at its first lock until preparation reaches that same
		// owner barrier, then let the production function cancel the claimed job.
		if _, err := tx.Exec(ctx, `SELECT vc.memory_write_barrier(1)`); err != nil {
			return err
		}
		ownerPID := int32(tx.Conn().PgConn().PID())
		t.Cleanup(func() {
			cancel()
			<-done
		})
		go func() {
			defer close(done)
			// Call the production SQL function directly to preserve SQLSTATE.
			prepareErr = s.WithOwner(runCtx, 1, func(ctx context.Context, tx pgx.Tx) error {
				return tx.QueryRow(ctx, `
					SELECT out_attempt_id,out_attempt_no,out_decision
					FROM vc.go_prepare_memorycore_call(1,$1,$2,$3,$4,'synthetic-op','l1-extraction',1,'prov-a','Synthetic','model-a')
				`, job.JobID, job.RefID, job.Token, job.Fence).Scan(&attemptID, &attemptNo, &decision)
			})
		}()

		poll := time.NewTicker(10 * time.Millisecond)
		defer poll.Stop()
		for {
			var waiting bool
			err := s.pool.QueryRow(ctx, `
				SELECT EXISTS (
				    SELECT 1 FROM pg_locks held
				    JOIN pg_locks waiter USING (locktype, database, classid, objid, objsubid)
				    WHERE held.pid=$1 AND held.locktype='advisory' AND held.granted AND NOT waiter.granted
				)`, ownerPID).Scan(&waiting)
			if err != nil {
				return fmt.Errorf("observe owner barrier wait: %w", err)
			}
			if waiting {
				break
			}
			select {
			case <-done:
				return fmt.Errorf("preparation ended before waiting for owner barrier (decision %q, error %v)", decision, prepareErr)
			case <-ctx.Done():
				return fmt.Errorf("wait for preparation at owner barrier: %w", ctx.Err())
			case <-poll.C:
			}
		}
		return tx.QueryRow(ctx, `SELECT vc.memory_forget_begin(1,$1)`, memory.ID).Scan(&forgotten)
	})
	if forgetErr != nil || !forgotten {
		t.Fatalf("forget returned %t: %v", forgotten, forgetErr)
	}
	select {
	case <-done:
	case <-runCtx.Done():
		t.Fatalf("wait for preparation after forget: %v", runCtx.Err())
	}
	if prepareErr != nil || decision != "CLAIM_LOST" || attemptID != 0 || attemptNo != 0 {
		t.Fatalf("preparation after forget returned decision %q, attempt ID %d, number %d: %v", decision, attemptID, attemptNo, prepareErr)
	}
	if status, _ := workStatus(t, job.JobID); status != "CANCELLED" {
		t.Fatalf("forgotten source's work item has status %q", status)
	}
}
