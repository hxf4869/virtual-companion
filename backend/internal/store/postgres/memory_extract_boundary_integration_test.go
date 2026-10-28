//go:build integration

package postgres

import (
	"context"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestMemoryExtractPrepareAttemptBoundary pins the pre-flight and outcome
// contract against the real database on ST_MEMORY_EXTRACT: a withdrawn consent
// that committed before prepare refuses the attempt (CONSENT_WITHDRAWN), a
// granted owner gets an EXTRACTABLE attempt registered with the actual
// outbound category (MESSAGE_TEXT) allowed, usage settles write-once as
// USAGE_REPORTED or UNKNOWN (never zero), a replay-only retry reuses the
// stored successful payload WITHOUT registering a new attempt (attempt id 0,
// no second usage row) and the stored payload rests as plaintext JSON, a
// superseded CREATED attempt is abandoned with an UNKNOWN disposition (it may
// already have gone outbound), and a stale claim token fences the holder out
// (CLAIM_LOST) without creating any attempt row.
func TestMemoryExtractPrepareAttemptBoundary(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	useSTExtractRoute(t, store)
	sourceID := openSTExtractSource(t, store, sourceChat, "extract-card", sourceMessage, sourceCandidate, "边界来源")
	jobs := stExtractJobIDs(t, store, 1)
	if len(jobs) != 1 {
		t.Fatalf("ST extract jobs %v, want 1", jobs)
	}
	jobID := jobs[0]
	claim := claimSTExtract(t, store, jobID)
	if claim.RefID != sourceID {
		t.Fatalf("extract ref %d, want source %d", claim.RefID, sourceID)
	}

	// No consent granted yet: the withdrawal state that committed before the
	// prepare transaction refuses the attempt with no outbound.
	prep, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
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
	prep, err = store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
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
	prep, err = store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
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

	// W08: replay preserves the accepted JSON payload verbatim.
	var rawPayload string
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT output_payload FROM vc.memory_extract_attempt WHERE id = $1`,
			prep.AttemptID).Scan(&rawPayload)
	}); err != nil {
		t.Fatal(err)
	}
	if rawPayload != payload {
		t.Fatal("stored replay payload differs from plaintext JSON")
	}

	// The replay-only retry reuses the stored payload: NO new attempt row and
	// no new usage — the caller gets attempt id 0 and must not record an
	// outcome. Exactly the two attempts above exist, and the stored payload
	// comes back unchanged.
	prep2, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
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
	// ABANDON marks UNKNOWN — never NOT_SENT. A second chat keeps the first
	// claim live; rewriting the same snapshot would cancel that job.
	const (
		boundaryChat      = "10000000-0000-0000-0000-0000000000b8"
		boundaryMessage   = "20000000-0000-0000-0000-0000000000b8"
		boundaryCandidate = "30000000-0000-0000-0000-0000000000b8"
	)
	source2 := openSTExtractSource(t, store, boundaryChat, "extract-card-b", boundaryMessage, boundaryCandidate, "覆盖来源")
	jobs2 := stExtractJobIDs(t, store, 1)
	if len(jobs2) != 2 || jobs2[0] != jobID {
		t.Fatalf("ST extract jobs %v, want the original job plus one new job", jobs2)
	}
	job2 := jobs2[1]
	claim2 := claimSTExtract(t, store, job2)
	if claim2.RefID != source2 {
		t.Fatalf("second extract ref %d, want source %d", claim2.RefID, source2)
	}
	prepA, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, job2, source2, claim2.Token, claim2.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil || prepA.Decision != "EXTRACTABLE" || prepA.AttemptID <= 0 {
		t.Fatalf("prepA decision %q attempt %d err=%v", prepA.Decision, prepA.AttemptID, err)
	}
	prepB, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, job2, source2, claim2.Token, claim2.Fence, "prov-a", "sup-a", "model-a", 128)
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
	prep3, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, "stale-token", claim.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil {
		t.Fatal(err)
	}
	if prep3.Decision != "CLAIM_LOST" || prep3.AttemptID != 0 {
		t.Fatalf("stale-claim decision %q attempt %d, want CLAIM_LOST with no attempt", prep3.Decision, prep3.AttemptID)
	}
}

// TestMemoryExtractPrepareAttemptRefusalOrder pins the refusal order on
// ST_MEMORY_EXTRACT. An ineligible settled source is SOURCE_SUPPRESSED (the
// source guard that replaced the generation MODEL_INELIGIBLE branch). Closing
// auto-save and revoking consent still win while that source stays ineligible,
// because those checks run first. None of the refusals registers an attempt.
func TestMemoryExtractPrepareAttemptRefusalOrder(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	store := testEnv.store
	for _, typ := range requiredConsents {
		if _, err := store.RecordConsent(ctx, 1, typ, "2026-08", true); err != nil {
			t.Fatal(err)
		}
	}
	useSTExtractRoute(t, store)
	const (
		refusalChat      = "10000000-0000-0000-0000-0000000000c8"
		refusalMessage   = "20000000-0000-0000-0000-0000000000c8"
		refusalCandidate = "30000000-0000-0000-0000-0000000000c8"
	)
	sourceID := openSTExtractSource(t, store, refusalChat, "extract-card-c", refusalMessage, refusalCandidate, "拒绝来源")
	jobs := stExtractJobIDs(t, store, 1)
	if len(jobs) != 1 {
		t.Fatalf("ST extract jobs %v, want 1", jobs)
	}
	jobID := jobs[0]
	claim := claimSTExtract(t, store, jobID)
	if claim.RefID != sourceID {
		t.Fatalf("extract ref %d, want source %d", claim.RefID, sourceID)
	}

	// The source stays ineligible for every decision below, so a later refusal
	// can only appear by being checked before SOURCE_SUPPRESSED.
	if err := IsolationSuperExec(ctx,
		`UPDATE vc.st_message_source SET eligible = false WHERE owner_user_id = 1 AND id = $1`, sourceID); err != nil {
		t.Fatal(err)
	}
	prep, err := store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "SOURCE_SUPPRESSED" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want SOURCE_SUPPRESSED with no attempt", prep.Decision, prep.AttemptID)
	}

	// The auto-save kill switch refuses the attempt outright.
	if _, err := store.UpdateMemoryAutoSavePref(ctx, 1, false); err != nil {
		t.Fatal(err)
	}
	prep, err = store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
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
	prep, err = store.PrepareSTMemoryExtractAttempt(ctx, 1, jobID, sourceID, claim.Token, claim.Fence, "prov-a", "sup-a", "model-a", 128)
	if err != nil {
		t.Fatal(err)
	}
	if prep.Decision != "CONSENT_WITHDRAWN" || prep.AttemptID != 0 {
		t.Fatalf("decision %q attempt %d, want CONSENT_WITHDRAWN with no attempt", prep.Decision, prep.AttemptID)
	}
	var attempts int
	if err := store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.memory_extract_attempt WHERE work_item_id = $1`, jobID).Scan(&attempts)
	}); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("refusals registered %d attempts", attempts)
	}
}
