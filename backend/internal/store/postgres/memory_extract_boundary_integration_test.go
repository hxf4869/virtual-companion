//go:build integration

package postgres

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// TestMemoryExtractPrepareAttemptBoundary pins the V133 pre-flight and outcome
// contract against the real database: a withdrawn consent that committed
// before prepare refuses the attempt (CONSENT_WITHDRAWN), a granted owner
// gets an EXTRACTABLE attempt registered with the actual outbound category
// (MESSAGE_TEXT) allowed, usage settles write-once as USAGE_REPORTED or
// UNKNOWN (never zero), a replay-only retry reuses the stored successful
// payload WITHOUT registering a new attempt (attempt id 0, no second usage
// row) and the stored payload rests encrypted, a superseded CREATED attempt
// is abandoned with an UNKNOWN disposition (it may already have gone
// outbound), and a stale claim token fences the holder out (CLAIM_LOST)
// without creating any attempt row.
func TestMemoryExtractPrepareAttemptBoundary(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	genID, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	jobID, err := store.EnqueueMemoryExtract(ctx, 1, genID)
	if err != nil || jobID <= 0 {
		t.Fatalf("enqueue job=%d err=%v", jobID, err)
	}
	claims, err := store.ClaimJobs(ctx, 30*time.Second, 30*time.Second, 30*time.Second, 32, 32, 32)
	if err != nil {
		t.Fatal(err)
	}
	var claim JobClaim
	found := false
	for _, c := range claims {
		if c.Kind == "MEMORY_EXTRACT" && c.JobID == jobID {
			claim, found = c, true
		}
	}
	if !found {
		t.Fatalf("claimed set %v misses extract job %d", claims, jobID)
	}

	// No consent granted yet: the withdrawal state that committed before the
	// prepare transaction refuses the attempt with no outbound.
	prep, err := store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "CONSENT_WITHDRAWN" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want CONSENT_WITHDRAWN with no attempt", prep.Decision, prep.AttemptID)
	}

	for _, typ := range requiredConsents {
		if _, err := store.RecordConsent(ctx, 1, typ, "2026-08", true); err != nil {
			t.Fatal(err)
		}
	}
	prep, err = store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "EXTRACTABLE" || prep.AttemptID <= 0 || prep.AttemptNo != 1 {
		t.Fatalf("decision %q attempt %d no %d, want EXTRACTABLE attempt 1", prep.Decision, prep.AttemptID, prep.AttemptNo)
	}
	var status string
	var cats []string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT status, allowed_categories FROM vc.memory_extract_attempt WHERE id = $1`,
			prep.AttemptID).Scan(&status, &cats)
	}); err != nil {
		t.Fatal(err)
	}
	if status != "CREATED" || !slices.Contains(cats, "MESSAGE_TEXT") {
		t.Fatalf("attempt row status=%s categories=%v, want CREATED with MESSAGE_TEXT", status, cats)
	}

	// The provider reported no usage on attempt 1: the outcome settles
	// UNKNOWN, never zero, and the write-once record refuses a second write.
	rows, err := store.RecordMemoryExtractOutcome(ctx, 1, jobID, prep.AttemptID, MemoryExtractOutcome{Status: "SUCCEEDED"})
	if err != nil || rows != 1 {
		t.Fatalf("unknown-usage outcome rows=%d err=%v, want 1", rows, err)
	}
	rows, err = store.RecordMemoryExtractOutcome(ctx, 1, jobID, prep.AttemptID, MemoryExtractOutcome{Status: "FAILED", FailureCode: "OTHER"})
	if err != nil || rows != 0 {
		t.Fatalf("second outcome rows=%d err=%v, want 0", rows, err)
	}

	// A second prepare (attempt 1 settled without a replayable payload)
	// registers attempt 2; this call carries the reported usage and the
	// replayable payload.
	payload := `[{"summary":"x","category":"PREFERENCE"}]`
	in, out := int64(11), int64(7)
	prep, err = store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "EXTRACTABLE" || prep.AttemptID <= 0 || prep.AttemptNo != 2 || prep.PriorPayload != "" {
		t.Fatalf("second decision %q attempt %d no %d payload %q, want EXTRACTABLE attempt 2 without a payload",
			prep.Decision, prep.AttemptID, prep.AttemptNo, prep.PriorPayload)
	}
	rows, err = store.RecordMemoryExtractOutcome(ctx, 1, jobID, prep.AttemptID, MemoryExtractOutcome{
		Status: "SUCCEEDED", InputTokens: &in, OutputTokens: &out, OutputPayload: payload,
	})
	if err != nil || rows != 1 {
		t.Fatalf("outcome rows=%d err=%v, want 1", rows, err)
	}

	// The replayable payload rests encrypted — never the raw model JSON.
	var rawPayload string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT output_payload FROM vc.memory_extract_attempt WHERE id = $1`,
			prep.AttemptID).Scan(&rawPayload)
	}); err != nil {
		t.Fatal(err)
	}
	if rawPayload == payload || !IsEncrypted(rawPayload) {
		t.Fatalf("stored payload %q is not encrypted at rest", rawPayload)
	}

	// The replay-only retry reuses the stored payload: NO new attempt row and
	// no new usage — the caller gets attempt id 0 and must not record an
	// outcome. Exactly the two attempts above exist, and the stored payload
	// comes back decrypted.
	prep2, err := store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep2.Decision != "EXTRACTABLE" || prep2.AttemptID != 0 || prep2.AttemptNo != 0 || prep2.PriorPayload != payload {
		t.Fatalf("replay decision %q attempt %d no %d payload %q, want EXTRACTABLE attempt id 0 replaying %q",
			prep2.Decision, prep2.AttemptID, prep2.AttemptNo, prep2.PriorPayload, payload)
	}
	var attempts, reported, unknown int
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT count(*),
			        count(*) FILTER (WHERE billing_disposition = 'USAGE_REPORTED'),
			        count(*) FILTER (WHERE billing_disposition = 'UNKNOWN')
			   FROM vc.memory_extract_attempt WHERE work_item_id = $1`, jobID,
		).Scan(&attempts, &reported, &unknown)
	}); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 || reported != 1 || unknown != 1 {
		t.Fatalf("attempts=%d reported=%d unknown=%d, want 2 attempts with 1/1 dispositions",
			attempts, reported, unknown)
	}

	// A superseded CREATED attempt may already have gone outbound, so the
	// ABANDON marks UNKNOWN — never NOT_SENT.
	gen2, _, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	job2, err := store.EnqueueMemoryExtract(ctx, 1, gen2)
	if err != nil || job2 <= 0 {
		t.Fatalf("enqueue job2=%d err=%v", job2, err)
	}
	claims2, err := store.ClaimJobs(ctx, 30*time.Second, 30*time.Second, 30*time.Second, 32, 32, 32)
	if err != nil {
		t.Fatal(err)
	}
	var claim2 JobClaim
	found2 := false
	for _, c := range claims2 {
		if c.Kind == "MEMORY_EXTRACT" && c.JobID == job2 {
			claim2, found2 = c, true
		}
	}
	if !found2 {
		t.Fatalf("claimed set %v misses extract job %d", claims2, job2)
	}
	prepA, err := store.PrepareMemoryExtractAttempt(ctx, 1, job2, gen2, claim2.Token, claim2.Fence, "prov-a", "sup-a", "model-a")
	if err != nil || prepA.Decision != "EXTRACTABLE" || prepA.AttemptID <= 0 {
		t.Fatalf("prepA decision %q attempt %d err=%v", prepA.Decision, prepA.AttemptID, err)
	}
	prepB, err := store.PrepareMemoryExtractAttempt(ctx, 1, job2, gen2, claim2.Token, claim2.Fence, "prov-a", "sup-a", "model-a")
	if err != nil || prepB.Decision != "EXTRACTABLE" || prepB.AttemptID <= 0 || prepB.AttemptID == prepA.AttemptID {
		t.Fatalf("prepB decision %q attempt %d err=%v", prepB.Decision, prepB.AttemptID, err)
	}
	var abandonedStatus, abandonedDisposition string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT status, billing_disposition FROM vc.memory_extract_attempt WHERE id = $1`,
			prepA.AttemptID).Scan(&abandonedStatus, &abandonedDisposition)
	}); err != nil {
		t.Fatal(err)
	}
	if abandonedStatus != "ABANDONED" || abandonedDisposition != "UNKNOWN" {
		t.Fatalf("superseded attempt status=%s disposition=%s, want ABANDONED/UNKNOWN",
			abandonedStatus, abandonedDisposition)
	}

	// A stale claim token fences the holder out without any attempt.
	prep3, err := store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, "stale-token", claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep3.Decision != "CLAIM_LOST" || prep3.AttemptID != 0 {
		t.Fatalf("stale-claim decision %q attempt %d, want CLAIM_LOST with no attempt", prep3.Decision, prep3.AttemptID)
	}
}

// TestMemoryExtractPrepareAttemptRefusalOrder pins the remaining V133 refusal
// branches in ordering: a model-ineligible source (the V112 egress fact) never
// enters a provider request, a closed auto-save switch refuses the attempt
// outright, and a consent revocation that committed before the next prepare
// keeps refusing even though an earlier attempt succeeded.
func TestMemoryExtractPrepareAttemptRefusalOrder(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	for _, typ := range requiredConsents {
		if _, err := store.RecordConsent(ctx, 1, typ, "2026-08", true); err != nil {
			t.Fatal(err)
		}
	}
	conv, err := store.CreateConversation(ctx, 1, 10, false)
	if err != nil {
		t.Fatal(err)
	}
	genID, src, _ := seedFinishedTurn(t, 1, conv, "COMPLETED", false, false)
	jobID, err := store.EnqueueMemoryExtract(ctx, 1, genID)
	if err != nil || jobID <= 0 {
		t.Fatalf("enqueue job=%d err=%v", jobID, err)
	}
	claims, err := store.ClaimJobs(ctx, 30*time.Second, 30*time.Second, 30*time.Second, 32, 32, 32)
	if err != nil {
		t.Fatal(err)
	}
	var claim JobClaim
	found := false
	for _, c := range claims {
		if c.Kind == "MEMORY_EXTRACT" && c.JobID == jobID {
			claim, found = c, true
		}
	}
	if !found {
		t.Fatalf("claimed set %v misses extract job %d", claims, jobID)
	}

	// A blocked/cancelled turn's source message is model-ineligible.
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.message SET model_eligible = false WHERE owner_user_id = 1 AND id = $1`, src); err != nil {
		t.Fatal(err)
	}
	prep, err := store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "MODEL_INELIGIBLE" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want MODEL_INELIGIBLE with no attempt", prep.Decision, prep.AttemptID)
	}

	// The auto-save kill switch refuses the attempt outright.
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, false); err != nil {
		t.Fatal(err)
	}
	prep, err = store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "AUTO_SAVE_OFF" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want AUTO_SAVE_OFF with no attempt", prep.Decision, prep.AttemptID)
	}

	// A consent revocation that commits before the next prepare refuses it.
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, true); err != nil {
		t.Fatal(err)
	}
	if _, err := store.RecordConsent(ctx, 1, "SENSITIVE_DATA_PROCESSING", "2026-08", false); err != nil {
		t.Fatal(err)
	}
	prep, err = store.PrepareMemoryExtractAttempt(ctx, 1, jobID, genID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a")
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "CONSENT_WITHDRAWN" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want CONSENT_WITHDRAWN with no attempt", prep.Decision, prep.AttemptID)
	}
}
