package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestFollowUpGreetingKeepsSnapshotWhenForegroundRebinds(t *testing.T) {
	var hits int
	var payload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		if r.Header.Get("Authorization") != "Bearer synthetic-secret" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"chat.completion","choices":[{"index":0,"message":{"content":"下周见"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4,"total_tokens":7}}`))
	}))
	defer srv.Close()

	fake := newFollowGenFake(scheduledFollowRow(), greetPurpose(srv.URL))
	var routes []modelprovider.Route
	factory := func(route modelprovider.Route) (companion.Provider, error) {
		routes = append(routes, route)
		return (modelprovider.Factory{
			AllowLoopbackHTTP: true,
			Temperature:       0.9,
			ConnectTimeout:    time.Second,
			FirstTokenTimeout: time.Second,
			TotalTimeout:      5 * time.Second,
		}).Build(route)
	}
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if fake.resolves != 1 || hits != 1 || len(routes) != 1 {
		t.Fatalf("resolves=%d hits=%d routes=%d", fake.resolves, hits, len(routes))
	}
	if routes[0].ModelID != "greet-snapshot" || routes[0].BaseURL != srv.URL || routes[0].ProviderID != "synthetic" {
		t.Fatalf("route followed the rebound binding: %+v", routes[0])
	}
	if routes[0].Temperature == nil || *routes[0].Temperature != 0.5 || routes[0].TopP == nil || *routes[0].TopP != 0.25 {
		t.Fatalf("profile parameters were not copied: %+v", routes[0])
	}
	if payload["model"] != "greet-snapshot" || payload["temperature"] != 0.5 || payload["top_p"] != 0.25 {
		t.Fatalf("request did not keep the frozen parameters: %+v", payload)
	}
	if payload["temperature"] == 0.9 {
		t.Fatal("factory default temperature replaced the profile value")
	}
	joined := followRequestText(t, payload)
	if !strings.Contains(joined, "小南") || !strings.Contains(joined, "下周复查") || strings.Contains(joined, "CARD_SENTINEL_DO_NOT_LEAK") || strings.Contains(joined, "已经回复") {
		t.Fatalf("prompt = %s", joined)
	}
	if fake.row.Status != "BODY_READY" || fake.row.Deliverable != "DELIVERABLE" || fake.row.Greeting == nil || *fake.row.Greeting != "下周见" {
		t.Fatalf("saved greeting = %+v", fake.row)
	}
	if fake.row.Body != "下周复查" || fake.row.EventID != "fu-m-42" {
		t.Fatalf("topic or event id changed: %+v", fake.row)
	}
	if fake.row.ProviderRevision == nil || *fake.row.ProviderRevision != 4 || fake.row.BindingRevision == nil || *fake.row.BindingRevision != 9 || fake.row.ModelID == nil || *fake.row.ModelID != "greet-snapshot" {
		t.Fatalf("snapshot = provider %v model %v binding %v", fake.row.ProviderRevision, fake.row.ModelID, fake.row.BindingRevision)
	}
	if strings.Contains(string(fake.row.Params), "synthetic-secret") || strings.Contains(string(fake.row.Params), "foreground") {
		t.Fatalf("snapshot leaked a secret or the rebound model: %s", fake.row.Params)
	}
	if fake.holds != 1 || fake.settles != 1 || len(fake.settleKinds) != 1 || fake.settleKinds[0].disposition != "USAGE_REPORTED" || fake.settleKinds[0].input != 3 || fake.settleKinds[0].output != 4 {
		t.Fatalf("accounting = holds %d settles %+v", fake.holds, fake.settleKinds)
	}
	if fake.preparedModel != "greet-snapshot" || fake.preparedProvider != "synthetic" {
		t.Fatalf("cost was booked against %+v/%+v", fake.preparedProvider, fake.preparedModel)
	}
	if len(fake.credentialIDs) != 2 || fake.credentialIDs[0] != "synthetic" || fake.credentialIDs[1] != "synthetic" {
		t.Fatalf("credential checks = %+v", fake.credentialIDs)
	}
}

func TestFollowUpRejectsUnsupportedParametersWithoutRequest(t *testing.T) {
	t.Run("temperature capability", func(t *testing.T) {
		purpose := greetPurpose("https://models.example/v1")
		purpose.Model.Capabilities = postgres.ModelCapabilities{"temperature": postgres.CapabilityUnsupported}
		assertNoFollowRequest(t, purpose, "PARAMETERS_REJECTED")
	})
	t.Run("anthropic reasoning", func(t *testing.T) {
		purpose := greetPurpose("https://models.example/v1")
		effort := "low"
		purpose.Protocol = postgres.ProtocolAnthropic
		purpose.Model.ReasoningLevels = []string{"low"}
		purpose.Model.GenerationParams.ReasoningEffort = &effort
		assertNoFollowRequest(t, purpose, "PARAMETERS_REJECTED")
	})
}

func TestFollowUpSafetyBlockStoresNoBody(t *testing.T) {
	fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "你好，我是真人", nil)
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || fake.holds != 1 || fake.settles != 1 {
		t.Fatalf("blocked call accounting requests=%d holds=%d settles=%d", requests, fake.holds, fake.settles)
	}
	if fake.blockedGreetingAttempt {
		t.Fatal("blocked generation offered a deliverable body")
	}
	if fake.row.Greeting != nil || fake.row.Status == "BODY_READY" || fake.row.Deliverable == "DELIVERABLE" {
		t.Fatalf("blocked row = %+v", fake.row)
	}
	if fake.row.Outcome == nil || *fake.row.Outcome != "BLOCKED" || fake.row.Reason == nil || *fake.row.Reason != "output-ai-identity-human-claim" {
		t.Fatalf("block record = outcome %v reason %v", fake.row.Outcome, fake.row.Reason)
	}
	if fake.row.Body != "下周复查" || strings.Contains(fake.row.Body, "我是真人") || strings.Contains(string(fake.row.Params), "我是真人") || strings.Contains(*fake.row.Reason, "我是真人") {
		t.Fatalf("blocked text was stored: %+v %s", fake.row, fake.row.Params)
	}
	if len(fake.jobs) != 1 || fake.jobs[0].status != "FAILED" {
		t.Fatalf("job = %+v", fake.jobs)
	}
}

func TestFollowUpBudgetOrMissingPriceMakesNoRequest(t *testing.T) {
	t.Run("budget", func(t *testing.T) {
		fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
		fake.budgetErr = postgres.ErrFollowUpBudget
		var requests int
		factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
		if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.builds != 0 || fake.holds != 0 || fake.settles != 0 {
			t.Fatalf("budget requests=%d builds=%d holds=%d settles=%d", requests, fake.builds, fake.holds, fake.settles)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "BUDGET_DENIED")
		if fake.row.Status == "BODY_READY" || fake.row.Greeting != nil {
			t.Fatalf("budget denial looked generated: %+v", fake.row)
		}
	})
	t.Run("no price", func(t *testing.T) {
		purpose := greetPurpose("https://models.example/v1")
		purpose.Model.Pricing = nil
		fake := newFollowGenFake(scheduledFollowRow(), purpose)
		var requests int
		factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
		if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.builds != 0 || fake.prepares != 0 || fake.holds != 0 {
			t.Fatalf("missing price requests=%d builds=%d prepares=%d holds=%d", requests, fake.builds, fake.prepares, fake.holds)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "NO_PRICE")
		if fake.row.Greeting != nil || fake.row.Status == "BODY_READY" {
			t.Fatalf("missing price looked generated: %+v", fake.row)
		}
	})
	t.Run("unbound", func(t *testing.T) {
		fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
		fake.resolveErr = &postgres.PurposeUnavailableError{Status: "PENDING_CONFIGURATION"}
		var requests int
		factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
		if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.builds != 0 || fake.prepares != 0 || fake.resolves != 1 {
			t.Fatalf("unbound requests=%d builds=%d prepares=%d resolves=%d", requests, fake.builds, fake.prepares, fake.resolves)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "UNBOUND")
	})
}

func TestFollowUpWaitingHostStoresNoGeneratedBody(t *testing.T) {
	row := scheduledFollowRow()
	row.OfflineCapable = false
	fake := newFollowGenFake(row, greetPurpose("https://models.example/v1"))
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "已经回复：下周见", nil)
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.builds != 0 || fake.resolves != 0 || fake.holds != 0 || fake.prepares != 0 {
		t.Fatalf("waiting host called the model: requests=%d builds=%d resolves=%d holds=%d prepares=%d", requests, fake.builds, fake.resolves, fake.holds, fake.prepares)
	}
	if fake.row.Status != "WAITING_HOST" || fake.row.Greeting != nil || fake.row.Deliverable == "DELIVERABLE" || fake.row.Body != "下周复查" {
		t.Fatalf("waiting host row = %+v", fake.row)
	}
	if strings.Contains(fake.row.Body, "已经回复") || (fake.row.Reason != nil && strings.Contains(*fake.row.Reason, "已经回复")) {
		t.Fatalf("waiting host stored a reply: %+v", fake.row)
	}
	assertFollowOutcome(t, fake, "WAITING_HOST", "WAITING_HOST")
	if len(fake.jobs) != 1 || fake.jobs[0].status != "DONE" {
		t.Fatalf("job = %+v", fake.jobs)
	}
}

func TestFollowUpCancelledAtClaimDoesNotGenerate(t *testing.T) {
	row := scheduledFollowRow()
	row.Status = "CANCELLED"
	fake := newFollowGenFake(row, greetPurpose("https://models.example/v1"))
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.builds != 0 || fake.resolves != 0 || fake.holds != 0 || fake.prepares != 0 {
		t.Fatalf("cancelled follow-up generated: requests=%d builds=%d resolves=%d holds=%d prepares=%d", requests, fake.builds, fake.resolves, fake.holds, fake.prepares)
	}
	if fake.row.Greeting != nil || fake.row.Body != "下周复查" {
		t.Fatalf("cancelled row = %+v", fake.row)
	}
	if len(fake.jobs) != 1 || fake.jobs[0].status != "CANCELLED" {
		t.Fatalf("job = %+v", fake.jobs)
	}
}

func TestFollowUpRetryDoesNotDoubleBook(t *testing.T) {
	fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
	claim := followClaim()
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || fake.builds != 1 || fake.resolves != 1 || fake.holds != 1 || fake.settles != 1 || fake.prepares != 1 {
		t.Fatalf("retry booked again: requests=%d builds=%d resolves=%d holds=%d settles=%d prepares=%d", requests, fake.builds, fake.resolves, fake.holds, fake.settles, fake.prepares)
	}
	if fake.finishCount != 1 || fake.row.EventID != "fu-m-42" || fake.row.Greeting == nil || *fake.row.Greeting != "下周见" {
		t.Fatalf("retry rewrote the greeting: finishes=%d row=%+v", fake.finishCount, fake.row)
	}
}

func TestFollowUpPolicyDisabledMakesNoRequest(t *testing.T) {
	useFollowHoldClock(t, time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC))
	row := scheduledFollowRow()
	row.PolicyEnabled = false
	fake := newFollowGenFake(row, greetPurpose("https://models.example/v1"))
	var requests int
	if err := generateFollowUp(context.Background(), fake, scriptedFollowFactory(fake, &requests, "下周见", nil), safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.resolves != 0 || fake.holds != 0 {
		t.Fatalf("disabled policy called the model: requests=%d resolves=%d holds=%d", requests, fake.resolves, fake.holds)
	}
	wantUntil := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC).Add(6 * time.Hour)
	if fake.row.Status != "DEFERRED" || fake.row.Deferrals != 1 || fake.row.DeferredUntil == nil || !fake.row.DeferredUntil.Equal(wantUntil) || fake.row.Deliverable == "DELIVERABLE" || fake.row.Greeting != nil || fake.row.Body != "下周复查" {
		t.Fatalf("disabled policy row = %+v", fake.row)
	}
	assertFollowOutcome(t, fake, "POLICY_DISABLED", "POLICY_DISABLED")
	if len(fake.jobs) != 1 || fake.jobs[0].status != "FAILED" || fake.jobs[0].reason != "POLICY_DISABLED" {
		t.Fatalf("job = %+v", fake.jobs)
	}
}

func TestFollowUpUnboundDefersThenGeneratesAfterBinding(t *testing.T) {
	now := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	useFollowHoldClock(t, now)
	fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
	fake.resolveErr = &postgres.PurposeUnavailableError{Status: "PENDING_CONFIGURATION"}
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
	claim := followClaim()
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.builds != 0 || fake.prepares != 0 || fake.holds != 0 {
		t.Fatalf("unbound requested: requests=%d builds=%d prepares=%d holds=%d", requests, fake.builds, fake.prepares, fake.holds)
	}
	if fake.row.Status != "DEFERRED" || fake.row.Deferrals != 1 || fake.row.DeferredUntil == nil || !fake.row.DeferredUntil.Equal(now.Add(6*time.Hour)) || fake.row.Greeting != nil || fake.row.Body != "下周复查" || fake.row.EventID != "fu-m-42" {
		t.Fatalf("unbound hold = %+v", fake.row)
	}
	assertFollowOutcome(t, fake, "NOT_GENERATED", "UNBOUND")
	if len(fake.jobs) != 1 || fake.jobs[0].status != "FAILED" || fake.jobs[0].reason != "UNBOUND" {
		t.Fatalf("job = %+v", fake.jobs)
	}
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if fake.finishCount != 1 || fake.row.Deferrals != 1 || len(fake.jobs) != 2 || fake.jobs[1].status != "FAILED" {
		t.Fatalf("replay finishes=%d deferrals=%d jobs=%+v", fake.finishCount, fake.row.Deferrals, fake.jobs)
	}

	fake.resolveErr = nil
	fake.row.Status = "SCHEDULED"
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || fake.holds != 1 || fake.settles != 1 || fake.prepares != 1 {
		t.Fatalf("bound generation requests=%d holds=%d settles=%d prepares=%d", requests, fake.holds, fake.settles, fake.prepares)
	}
	if fake.row.Status != "BODY_READY" || fake.row.Greeting == nil || *fake.row.Greeting != "下周见" || fake.row.EventID != "fu-m-42" {
		t.Fatalf("generated row = %+v", fake.row)
	}
	if len(fake.jobs) != 3 || fake.jobs[2].status != "DONE" {
		t.Fatalf("jobs = %+v", fake.jobs)
	}
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), claim); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || fake.holds != 1 || fake.settles != 1 || fake.finishCount != 2 || fake.row.Greeting == nil || *fake.row.Greeting != "下周见" {
		t.Fatalf("repeat requests=%d holds=%d settles=%d finishes=%d greeting=%v", requests, fake.holds, fake.settles, fake.finishCount, fake.row.Greeting)
	}
}

func TestFollowUpHoldDoublesUntilSilent(t *testing.T) {
	now := time.Date(2026, 11, 2, 8, 0, 0, 0, time.UTC)
	useFollowHoldClock(t, now)
	wants := []time.Duration{6 * time.Hour, 12 * time.Hour, 24 * time.Hour}
	for i, want := range wants {
		hold := nextFollowUpHold(now, i)
		if hold.Status != "DEFERRED" || hold.Deferrals != i+1 || hold.Until == nil || !hold.Until.Equal(now.Add(want)) {
			t.Fatalf("step %d = %+v", i, hold)
		}
	}
	capped := nextFollowUpHold(now, followDeferLimit)
	if capped.Status != "SILENT" || capped.Until != nil || capped.Deferrals != followDeferLimit {
		t.Fatalf("cap = %+v", capped)
	}

	fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
	fake.resolveErr = &postgres.PurposeUnavailableError{Status: "PENDING_CONFIGURATION"}
	var requests int
	factory := scriptedFollowFactory(fake, &requests, "下周见", nil)
	for i, want := range wants {
		fake.row.Status = "SCHEDULED"
		if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.row.Status != "DEFERRED" || fake.row.Deferrals != i+1 || fake.row.DeferredUntil == nil || !fake.row.DeferredUntil.Equal(now.Add(want)) || fake.row.Greeting != nil || fake.row.Body != "下周复查" {
			t.Fatalf("attempt %d = %+v", i, fake.row)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "UNBOUND")
	}
	fake.row.Status = "SCHEDULED"
	if err := generateFollowUp(context.Background(), fake, factory, safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.row.Status != "SILENT" || fake.row.Deferrals != followDeferLimit || fake.row.DeferredUntil != nil || fake.row.Greeting != nil || fake.row.Body != "下周复查" {
		t.Fatalf("silent = %+v", fake.row)
	}
	assertFollowOutcome(t, fake, "NOT_GENERATED", "UNBOUND")
	if fake.jobs[len(fake.jobs)-1].status != "FAILED" {
		t.Fatalf("jobs = %+v", fake.jobs)
	}
}

func useFollowHoldClock(t *testing.T, now time.Time) {
	t.Helper()
	previous := followHoldNow
	followHoldNow = func() time.Time { return now }
	t.Cleanup(func() { followHoldNow = previous })
}

func TestFollowUpSourceInvalidCancelsWithoutRequest(t *testing.T) {
	row := scheduledFollowRow()
	row.SourceValid = false
	fake := newFollowGenFake(row, greetPurpose("https://models.example/v1"))
	var requests int
	if err := generateFollowUp(context.Background(), fake, scriptedFollowFactory(fake, &requests, "下周见", nil), safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.resolves != 0 || fake.holds != 0 {
		t.Fatalf("invalid source called the model: requests=%d resolves=%d holds=%d", requests, fake.resolves, fake.holds)
	}
	if fake.row.Status != "CANCELLED" || fake.row.Greeting != nil || fake.row.Body != "下周复查" {
		t.Fatalf("invalid source row = %+v", fake.row)
	}
	assertFollowOutcome(t, fake, "SOURCE_INVALID", "SOURCE_INVALID")
	if len(fake.jobs) != 1 || fake.jobs[0].status != "CANCELLED" {
		t.Fatalf("job = %+v", fake.jobs)
	}
}

func TestFollowUpCredentialRevocationMakesNoRequest(t *testing.T) {
	t.Run("before hold", func(t *testing.T) {
		fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
		fake.revoked = true
		var requests int
		if err := generateFollowUp(context.Background(), fake, scriptedFollowFactory(fake, &requests, "下周见", nil), safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.builds != 0 || fake.holds != 0 || fake.prepares != 0 {
			t.Fatalf("revoked credential requested: requests=%d builds=%d holds=%d prepares=%d", requests, fake.builds, fake.holds, fake.prepares)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "CREDENTIAL_REVOKED")
	})
	t.Run("after hold", func(t *testing.T) {
		fake := newFollowGenFake(scheduledFollowRow(), greetPurpose("https://models.example/v1"))
		fake.revokeAfterHold = true
		var requests int
		if err := generateFollowUp(context.Background(), fake, scriptedFollowFactory(fake, &requests, "下周见", nil), safety.New(), followClaim()); err != nil {
			t.Fatal(err)
		}
		if requests != 0 || fake.builds != 0 || fake.holds != 1 || fake.prepares != 1 {
			t.Fatalf("late revoke requested: requests=%d builds=%d holds=%d prepares=%d", requests, fake.builds, fake.holds, fake.prepares)
		}
		if len(fake.settleKinds) != 1 || fake.settleKinds[0].disposition != "NOT_SENT" {
			t.Fatalf("late revoke settlement = %+v", fake.settleKinds)
		}
		assertFollowOutcome(t, fake, "NOT_GENERATED", "CREDENTIAL_REVOKED")
		if fake.row.Greeting != nil {
			t.Fatal("late revoke stored a body")
		}
	})
}

func TestFollowUpDispatchDoesNotHoldClaimLock(t *testing.T) {
	store := newLeaseClaimStore()
	store.enqueue(postgres.JobClaim{OwnerID: 1, JobID: 1, Kind: KindFollowUp, RefID: 9})
	loop := NewLoop(nil, testLoopPolicy(1), testTurnBudget())
	loop.Use(store, nil, nil, nil)
	started := make(chan struct{})
	release := make(chan struct{})
	done := make(chan struct{})
	loop.followGenerate = func(context.Context, postgres.JobClaim) error {
		close(started)
		<-release
		close(done)
		return nil
	}
	claimed := make(chan int, 1)
	go func() { claimed <- loop.ClaimOnce(context.Background()) }()
	select {
	case n := <-claimed:
		if n != 1 {
			t.Fatalf("claimed %d", n)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("claim did not return while follow-up ran")
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("follow-up did not start")
	}
	finished := make(chan int, 1)
	go func() { finished <- loop.ClaimOnce(context.Background()) }()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("claim lock held during follow-up")
	}
	close(release)
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("follow-up did not finish")
	}
}

func TestFollowUpGeneratorStaysInsideScope(t *testing.T) {
	for _, name := range []string{"followup_generate.go", "loop.go"} {
		src, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, banned := range []string{"stsource", "inbox", "smtp", "feishu", "CreateTool"} {
			if strings.Contains(string(src), banned) {
				t.Fatalf("%s contains %s", name, banned)
			}
		}
	}
}

func assertNoFollowRequest(t *testing.T, purpose postgres.ResolvedPurpose, reason string) {
	t.Helper()
	fake := newFollowGenFake(scheduledFollowRow(), purpose)
	var requests int
	if err := generateFollowUp(context.Background(), fake, scriptedFollowFactory(fake, &requests, "下周见", nil), safety.New(), followClaim()); err != nil {
		t.Fatal(err)
	}
	if requests != 0 || fake.builds != 0 || fake.holds != 0 || fake.prepares != 0 {
		t.Fatalf("rejected parameters still requested: requests=%d builds=%d holds=%d prepares=%d", requests, fake.builds, fake.holds, fake.prepares)
	}
	assertFollowOutcome(t, fake, "NOT_GENERATED", reason)
	if fake.row.Greeting != nil || fake.row.Status == "BODY_READY" {
		t.Fatalf("rejected parameters looked generated: %+v", fake.row)
	}
}

func assertFollowOutcome(t *testing.T, fake *followGenFake, outcome, reason string) {
	t.Helper()
	if fake.row.Outcome == nil || *fake.row.Outcome != outcome || fake.row.Reason == nil || *fake.row.Reason != reason {
		t.Fatalf("outcome = %v reason = %v, want %s %s", fake.row.Outcome, fake.row.Reason, outcome, reason)
	}
}

func followRequestText(t *testing.T, payload map[string]any) string {
	t.Helper()
	raw, ok := payload["messages"].([]any)
	if !ok {
		t.Fatalf("messages = %#v", payload["messages"])
	}
	var joined string
	for _, item := range raw {
		msg, ok := item.(map[string]any)
		if !ok {
			t.Fatalf("message = %#v", item)
		}
		text, _ := msg["content"].(string)
		joined += text
	}
	return joined
}

func followClaim() postgres.JobClaim {
	return postgres.JobClaim{OwnerID: 7, JobID: 8, Kind: KindFollowUp, RefID: 42, Token: "token", Fence: "fence"}
}

func scheduledFollowRow() postgres.FollowUpGeneration {
	name := "小南"
	return postgres.FollowUpGeneration{
		ID: 42, RelationshipID: 3, Status: "SCHEDULED", Body: "下周复查",
		EventID: "fu-m-42", Deliverable: "NOT_DELIVERABLE",
		SourceValid: true, PolicyEnabled: true, OfflineCapable: true,
		CompanionName: &name, ReplyLength: "MEDIUM", Initiative: "LOW",
		Humor: "LIGHT", AdvicePref: "ASK_FIRST", MemoryShareScope: "RELATIONSHIP",
		Gender: "NEUTRAL", AvoidTopics: []string{"POLITICS", "CARD_SENTINEL_DO_NOT_LEAK"},
	}
}

func greetPurpose(baseURL string) postgres.ResolvedPurpose {
	temp, top := 0.5, 0.25
	inPrice, outPrice := 1.0, 2.0
	return postgres.ResolvedPurpose{
		Purpose: postgres.PurposeBackgroundGreetings, BindingRevision: 9,
		ProviderID: "synthetic", ProviderName: "Synthetic",
		Protocol: postgres.ProtocolOpenAIChat, BaseURL: baseURL,
		ProviderRevision: 4, Credential: "stale-credential",
		Model: postgres.ProviderModel{
			ModelID: "greet-snapshot", MaxOutputTokens: 64,
			Capabilities: postgres.ModelCapabilities{
				"temperature": postgres.CapabilityDeclared,
				"topP":        postgres.CapabilityVerified,
			},
			GenerationParams: &postgres.GenerationParams{Temperature: &temp, TopP: &top},
			Pricing:          &postgres.ModelPricing{InputPerMillionTokens: &inPrice, OutputPerMillionTokens: &outPrice},
		},
	}
}

type followSettle struct {
	disposition   string
	input, output int64
}

type followJobClose struct {
	status, reason string
}

type followGenFake struct {
	row                    postgres.FollowUpGeneration
	purpose                postgres.ResolvedPurpose
	resolveErr             error
	budgetErr              error
	revoked                bool
	revokeAfterHold        bool
	resolves               int
	prepares               int
	holds                  int
	settles                int
	builds                 int
	finishCount            int
	held                   bool
	charged                bool
	released               bool
	preparedProvider       string
	preparedModel          string
	credentialIDs          []string
	settleKinds            []followSettle
	jobs                   []followJobClose
	blockedGreetingAttempt bool
}

func newFollowGenFake(row postgres.FollowUpGeneration, purpose postgres.ResolvedPurpose) *followGenFake {
	return &followGenFake{row: row, purpose: purpose}
}

func (f *followGenFake) LoadFollowUpGeneration(context.Context, int64, int64) (postgres.FollowUpGeneration, error) {
	return f.row, nil
}

func (f *followGenFake) FinishFollowUpGeneration(_ context.Context, _, _ int64, in postgres.FollowUpGenerationFinish) error {
	if in.Outcome == "BLOCKED" && in.Greeting != nil && strings.TrimSpace(*in.Greeting) != "" {
		f.blockedGreetingAttempt = true
		return errors.New("blocked generation cannot store a body")
	}
	if in.Outcome == "NOT_GENERATED" || in.Outcome == "POLICY_DISABLED" {
		if (f.row.Status == "DEFERRED" || f.row.Status == "SILENT") && f.row.Outcome != nil &&
			(*f.row.Outcome == "NOT_GENERATED" || *f.row.Outcome == "POLICY_DISABLED") {
			return nil
		}
	}
	f.finishCount++
	if f.row.Outcome != nil && followOutcomeTerminal(*f.row.Outcome) {
		if *f.row.Outcome == in.Outcome {
			return nil
		}
		return errors.New("generation is already finished")
	}
	f.row.Outcome = strPtr(in.Outcome)
	f.row.Reason = strPtr(in.Reason)
	if in.ProviderID != "" {
		f.row.ProviderID = strPtr(in.ProviderID)
		f.row.ModelID = strPtr(in.ModelID)
		f.row.Protocol = strPtr(in.Protocol)
		f.row.ProviderRevision = in.ProviderRevision
		f.row.BindingRevision = in.BindingRevision
		f.row.Params = append(json.RawMessage(nil), in.Params...)
	}
	switch in.Outcome {
	case "BODY_READY":
		f.row.Status = "BODY_READY"
		f.row.Deliverable = "DELIVERABLE"
		if in.Greeting != nil {
			greeting := *in.Greeting
			f.row.Greeting = &greeting
		}
	case "WAITING_HOST":
		f.row.Status = "WAITING_HOST"
		f.row.Deliverable = "NOT_DELIVERABLE"
		f.row.Greeting = nil
	case "BLOCKED":
		f.row.Status = "SILENT"
		f.row.Deliverable = "NOT_DELIVERABLE"
		f.row.Greeting = nil
	case "CANCELLED", "SOURCE_INVALID":
		f.row.Status = "CANCELLED"
		f.row.Greeting = nil
	case "NOT_GENERATED", "POLICY_DISABLED":
		now := in.Now
		if now.IsZero() {
			now = time.Now()
		}
		hold := nextFollowUpHold(now, f.row.Deferrals)
		f.row.Status = hold.Status
		f.row.DeferredUntil = hold.Until
		f.row.Deferrals = hold.Deferrals
		f.row.Greeting = nil
		f.row.Deliverable = "NOT_DELIVERABLE"
	}
	return nil
}

func (f *followGenFake) PrepareFollowUpModelCall(_ context.Context, _, _ int64, _, provider, model string, _, _ int) (string, error) {
	f.prepares++
	if f.budgetErr != nil {
		return "", f.budgetErr
	}
	if f.charged {
		return "REUSED_SETTLED", nil
	}
	if f.released {
		return "REUSED_RELEASED", nil
	}
	if f.held {
		return "REUSED_HELD", nil
	}
	f.held = true
	f.holds++
	f.preparedProvider = provider
	f.preparedModel = model
	return "HELD", nil
}

func (f *followGenFake) SettleFollowUpModelCall(_ context.Context, _ int64, _, disposition string, input, output *int64) error {
	f.settles++
	kind := followSettle{disposition: disposition}
	if input != nil {
		kind.input = *input
	}
	if output != nil {
		kind.output = *output
	}
	f.settleKinds = append(f.settleKinds, kind)
	f.held = false
	switch disposition {
	case "USAGE_REPORTED":
		f.charged = true
	case "NOT_SENT":
		f.released = true
	}
	return nil
}

func (f *followGenFake) FollowUpProviderCredential(_ context.Context, providerID string, revision int64) (string, error) {
	f.credentialIDs = append(f.credentialIDs, providerID)
	if f.revokeAfterHold && f.holds > 0 {
		f.revoked = true
	}
	if f.revoked || providerID != "synthetic" || revision != 4 {
		return "", postgres.ErrNotFound
	}
	rebound := 0.1
	f.purpose.ProviderID = "foreground"
	f.purpose.ProviderRevision = 99
	f.purpose.BindingRevision = 100
	f.purpose.BaseURL = "https://foreground.example/v1"
	f.purpose.Credential = "foreground-secret"
	f.purpose.Model.ModelID = "foreground-model"
	f.purpose.Model.GenerationParams = &postgres.GenerationParams{Temperature: &rebound}
	return "synthetic-secret", nil
}

func (f *followGenFake) ResolvePurpose(context.Context, postgres.ResolvePurpose) (postgres.ResolvedPurpose, error) {
	f.resolves++
	if f.resolveErr != nil {
		return postgres.ResolvedPurpose{}, f.resolveErr
	}
	if f.purpose.Purpose != postgres.PurposeBackgroundGreetings {
		tPurpose := f.purpose.Purpose
		if tPurpose == "" {
			return postgres.ResolvedPurpose{}, &postgres.PurposeUnavailableError{Status: "PENDING_CONFIGURATION"}
		}
	}
	return f.purpose, nil
}

func (f *followGenFake) CompleteJob(_ context.Context, _, _ int64, _, _, status, reason string) error {
	f.jobs = append(f.jobs, followJobClose{status: status, reason: reason})
	return nil
}

func scriptedFollowFactory(fake *followGenFake, requests *int, text string, callErr error) func(modelprovider.Route) (companion.Provider, error) {
	return func(route modelprovider.Route) (companion.Provider, error) {
		fake.builds++
		return &scriptedFollowProvider{text: text, err: callErr, requests: requests}, nil
	}
}

type scriptedFollowProvider struct {
	text     string
	err      error
	requests *int
}

func (p *scriptedFollowProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	if p.requests != nil {
		*p.requests++
	}
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if emit != nil && p.text != "" {
		if err := emit(companion.OutputDelta{Text: p.text}); err != nil {
			return companion.AttemptResult{}, err
		}
	}
	return companion.AttemptResult{
		Finish: companion.FinishStop,
		Usage:  companion.Usage{InputTokens: 3, OutputTokens: 4, TotalTokens: 7},
	}, nil
}

func strPtr(v string) *string { return &v }

func followOutcomeTerminal(outcome string) bool {
	switch outcome {
	case "BODY_READY", "WAITING_HOST", "BLOCKED", "CANCELLED", "SOURCE_INVALID":
		return true
	default:
		return false
	}
}
