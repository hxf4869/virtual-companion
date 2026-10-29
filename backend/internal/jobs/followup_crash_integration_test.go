//go:build integration

package jobs

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestFollowUpCrashDoesNotResendSameAttempt(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
		VALUES (1, 93017, 10, 'RELATIONSHIP', '复查', 'ACCEPTED');
		INSERT INTO vc.follow_up(
			owner_user_id, relationship_id, memory_item_id, body, status, normalization_status,
			time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
		VALUES (
			1, 10, 93017, '复查', 'SCHEDULED', 'explicit_date',
			'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
			clock_timestamp() - interval '1 hour', 'fu-w16e-crash',
			'st:`+w16Chat+`')`); err != nil {
		t.Fatal(err)
	}
	followID := w16Count(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'fu-w16e-crash'`)
	jobID := w16ClaimedFollowUp(t, followID, 0)
	job, err := strconv.ParseInt(jobID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	follow, err := strconv.ParseInt(followID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	held := &attemptStore{followUpStore: store, purpose: crashPurpose()}
	streams := 0
	factory := func(modelprovider.Route) (companion.Provider, error) {
		return &crashProvider{n: &streams}, nil
	}
	followUpAbandonAfterSend = func() bool { return true }
	t.Cleanup(func() { followUpAbandonAfterSend = nil })
	claim := postgres.JobClaim{
		OwnerID: 1, JobID: job, Kind: "FOLLOW_UP", RefID: follow,
		Token: "crash-token", Fence: "crash-fence",
	}
	if err := generateFollowUp(ctx, held, factory, safety.New(), claim); err == nil {
		t.Fatal("abandoned send returned nil")
	}
	if streams != 1 || len(held.attempts) != 1 {
		t.Fatalf("first send streams=%d attempts=%v", streams, held.attempts)
	}
	first := held.attempts[0]
	if err := postgres.IsolationSuperExec(ctx, `
		UPDATE vc.work_item
		   SET lease_expires_at = clock_timestamp() - interval '1 minute'
		 WHERE owner_user_id = 1 AND id = $1`, job); err != nil {
		t.Fatal(err)
	}
	action, err := store.RecoverExpiredFollowUp(ctx, 1, job)
	if err != nil {
		t.Fatal(err)
	}
	if action != "REQUEUED" {
		t.Fatalf("recover %s", action)
	}
	followUpAbandonAfterSend = nil
	claims, err := store.ClaimJobs(ctx, 5*time.Minute, 5*time.Minute, 5*time.Minute, 8, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(claims) != 1 || claims[0].JobID != job {
		t.Fatalf("reclaim %+v", claims)
	}
	if err := generateFollowUp(ctx, held, factory, safety.New(), claims[0]); err != nil {
		t.Fatal(err)
	}
	if len(held.attempts) != 2 || held.attempts[1] == first {
		t.Fatalf("attempts %v", held.attempts)
	}
	for _, attempt := range held.attempts[1:] {
		if attempt == first {
			t.Fatal("same attempt was prepared again")
		}
	}
	if streams < 2 {
		t.Fatalf("bounded retry did not run, streams=%d", streams)
	}
	status := w16Count(t, `SELECT status || ':' || coalesce(actual_usd::text, 'null') || ':' || (reserved_usd > 0) FROM vc.model_cost_reservation WHERE provider_attempt_id = '`+first+`'`)
	if status != "UNKNOWN:null:true" {
		t.Fatalf("first attempt ledger %s", status)
	}
	if got := w16Count(t, `SELECT count(*)::text FROM vc.model_cost_reservation WHERE provider_attempt_id = '`+first+`'`); got != "1" {
		t.Fatalf("first attempt rows %s", got)
	}
	month := w16Count(t, `SELECT (unsettled_usd > 0)::text || ':' || (settled_usd > 0)::text || ':' || (reserved_usd = 0)::text FROM vc.month_cost_budget`)
	if month != "true:true:true" {
		t.Fatalf("month unsettled/settled/reserved-zero %s", month)
	}
}

func TestFollowUpLeaseExhaustionKeepsUnknownHold(t *testing.T) {
	ctx := context.Background()
	store := postgres.IsolationStore()
	w16Reset(t)
	if err := postgres.IsolationSuperExec(ctx, `
		INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
		VALUES (1, 93018, 10, 'RELATIONSHIP', '复查', 'ACCEPTED');
		INSERT INTO vc.follow_up(
			owner_user_id, relationship_id, memory_item_id, body, status, normalization_status,
			time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
		VALUES (
			1, 10, 93018, '复查', 'SCHEDULED', 'explicit_date',
			'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
			clock_timestamp() - interval '1 hour', 'fu-w16e-bound',
			'st:`+w16Chat+`')`); err != nil {
		t.Fatal(err)
	}
	followID := w16Count(t, `SELECT id::text FROM vc.follow_up WHERE event_id = 'fu-w16e-bound'`)
	jobID := w16ClaimedFollowUp(t, followID, 2)
	job, err := strconv.ParseInt(jobID, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	attempt := followAttemptID(job, 2)
	decision, err := store.PrepareFollowUpModelCall(ctx, 1, job, attempt, "prov-a", "model-a", 10, 16)
	if err != nil || decision != "HELD" {
		t.Fatalf("hold %s %v", decision, err)
	}
	if err := postgres.IsolationSuperExec(ctx, `
		UPDATE vc.work_item
		   SET lease_expires_at = clock_timestamp() - interval '1 minute'
		 WHERE owner_user_id = 1 AND id = $1`, job); err != nil {
		t.Fatal(err)
	}
	action, err := store.RecoverExpiredFollowUp(ctx, 1, job)
	if err != nil {
		t.Fatal(err)
	}
	if action != "DEAD_LETTERED" {
		t.Fatalf("recover %s", action)
	}
	if got := w16Count(t, `SELECT count(*)::text FROM vc.work_item WHERE owner_user_id = 1 AND kind = 'FOLLOW_UP' AND status IN ('PENDING', 'CLAIMED')`); got != "0" {
		t.Fatalf("live jobs %s", got)
	}
	status := w16Count(t, `SELECT status || ':' || coalesce(actual_usd::text, 'null') || ':' || (reserved_usd > 0) FROM vc.model_cost_reservation WHERE provider_attempt_id = '`+attempt+`'`)
	if status != "UNKNOWN:null:true" {
		t.Fatalf("exhausted attempt ledger %s", status)
	}
	if got := w16Count(t, `SELECT (unsettled_usd > 0)::text || ':' || (settled_usd = 0)::text FROM vc.month_cost_budget`); got != "true:true" {
		t.Fatalf("month %s", got)
	}
}

type attemptStore struct {
	followUpStore
	purpose  postgres.ResolvedPurpose
	attempts []string
}

func (a *attemptStore) LoadFollowUpGeneration(ctx context.Context, owner, id int64) (postgres.FollowUpGeneration, error) {
	row, err := a.followUpStore.LoadFollowUpGeneration(ctx, owner, id)
	if err != nil {
		return row, err
	}
	row.SourceValid = true
	row.PolicyEnabled = true
	row.OfflineCapable = true
	return row, nil
}

func (a *attemptStore) ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	return a.purpose, nil
}

func (a *attemptStore) FollowUpProviderCredential(context.Context, string, int64) (string, error) {
	return "synthetic-secret", nil
}

func (a *attemptStore) PrepareFollowUpModelCall(ctx context.Context, owner, jobID int64, attempt, provider, model string, inputTokens, outputTokens int) (string, error) {
	a.attempts = append(a.attempts, attempt)
	return a.followUpStore.PrepareFollowUpModelCall(ctx, owner, jobID, attempt, provider, model, inputTokens, outputTokens)
}

func crashPurpose() postgres.ResolvedPurpose {
	inPrice, outPrice := 1.0, 2.0
	return postgres.ResolvedPurpose{
		Purpose: postgres.PurposeBackgroundGreetings, ProviderID: "prov-a", ProviderName: "Prov",
		Protocol: postgres.ProtocolOpenAIChat, BaseURL: "https://example.test/v1", ProviderRevision: 1,
		Model: postgres.ProviderModel{
			ModelID: "model-a", MaxOutputTokens: 64,
			Pricing: &postgres.ModelPricing{InputPerMillionTokens: &inPrice, OutputPerMillionTokens: &outPrice},
		},
	}
}

type crashProvider struct{ n *int }

func (p *crashProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	*p.n++
	if err := emit(companion.OutputDelta{Text: "下周见"}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5}}, nil
}
