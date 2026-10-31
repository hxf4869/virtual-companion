package jobs

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/proactive"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/voice"
)

const proactiveJudgeGap = 15 * time.Minute

// RunProactivePass delivers due bodies and, outside the judgment gap, may
// pre-generate one more. It never logs prompt or reply text.
func (l *Loop) RunProactivePass(ctx context.Context, now time.Time) {
	if l == nil || l.providerFactory == nil {
		return
	}
	store, ok := l.store.(*postgres.Store)
	if !ok {
		return
	}
	targets, err := store.ListProactiveTargets(ctx)
	if err != nil {
		l.proactiveLog("PROACTIVE_LIST")
		return
	}
	for _, target := range targets {
		if _, err := l.runProactive(ctx, store, target.OwnerID, target.RelationshipID, now, false); err != nil {
			l.proactiveLog("PROACTIVE_RUN")
		}
	}
}

// RunRelationshipProactive is the authenticated HTTP pass. It always judges.
func (l *Loop) RunRelationshipProactive(ctx context.Context, owner, relationshipID int64, now time.Time) (postgres.ProactiveRunResult, error) {
	if l == nil || l.providerFactory == nil {
		return postgres.ProactiveRunResult{}, errors.New("proactive runner is unavailable")
	}
	store, ok := l.store.(*postgres.Store)
	if !ok {
		return postgres.ProactiveRunResult{}, errors.New("proactive runner is unavailable")
	}
	return l.runProactive(ctx, store, owner, relationshipID, now, true)
}

func (l *Loop) runProactive(ctx context.Context, store *postgres.Store, owner, relationshipID int64, now time.Time, force bool) (postgres.ProactiveRunResult, error) {
	if now.IsZero() {
		now = time.Now()
	}
	l.prepareProactiveVoices(ctx, store, owner, relationshipID, now)
	eventID, delivered, err := store.DeliverDueProactive(ctx, owner, relationshipID, now, postgres.FollowUpGenerationFinish{}, func(body string) bool {
		_, _, kept := reviewGreeting(safety.New(), body)
		return kept != nil
	})
	if errors.Is(err, postgres.ErrProactiveNoConversation) {
		return postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "NO_CONVERSATION"}, nil
	}
	if err != nil {
		return postgres.ProactiveRunResult{}, err
	}
	loaded, err := store.LoadProactiveContext(ctx, owner, relationshipID, now)
	if err != nil {
		return postgres.ProactiveRunResult{}, err
	}
	preferInbox := func(result postgres.ProactiveRunResult) postgres.ProactiveRunResult {
		if delivered {
			return postgres.ProactiveRunResult{Outcome: "INBOX", EventID: eventID}
		}
		return result
	}
	if !force && !loaded.LastJudgment.IsZero() && now.Sub(loaded.LastJudgment) < proactiveJudgeGap {
		if delivered {
			return preferInbox(postgres.ProactiveRunResult{}), nil
		}
		return postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "THROTTLED"}, nil
	}
	loaded.World.Rand = rand.IntN
	plan := proactive.Judge(loaded.World)
	if plan.Outcome != proactive.OutcomeJudge {
		return preferInbox(postgres.ProactiveRunResult{Outcome: plan.Outcome, Reason: plan.Reason}), nil
	}
	resolved, err := store.ResolvePurpose(ctx, postgres.ResolvePurpose{OwnerAccountID: owner, Purpose: postgres.PurposeBackgroundGreetings})
	if err != nil {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "UNBOUND"}), nil
	}
	route, err := judgmentRoute(resolved)
	if err != nil {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "PARAMETERS"}), nil
	}
	if err := refreshFollowCredential(ctx, store, &route, resolved.ProviderRevision); err != nil {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "CREDENTIAL"}), nil
	}
	judgment, reason, err := l.completeProactive(ctx, store, owner, relationshipID, plan.Prompt, route, "j")
	if err != nil {
		return postgres.ProactiveRunResult{}, err
	}
	if reason != "" {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: reason}), nil
	}
	next := proactive.AfterJudgment(loaded.World, judgment)
	if next.Outcome != proactive.OutcomePregen {
		if err := store.NoteProactiveJudgment(ctx, owner, relationshipID, now); err != nil {
			return postgres.ProactiveRunResult{}, err
		}
		return preferInbox(postgres.ProactiveRunResult{Outcome: next.Outcome, Reason: next.Reason}), nil
	}
	preRoute, err := pregenRoute(resolved)
	if err != nil {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "PARAMETERS"}), nil
	}
	if err := refreshFollowCredential(ctx, store, &preRoute, resolved.ProviderRevision); err != nil {
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "CREDENTIAL"}), nil
	}
	body, reason, err := l.completeProactive(ctx, store, owner, relationshipID, next.Prompt, preRoute, "p")
	if err != nil {
		return postgres.ProactiveRunResult{}, err
	}
	if reason != "" {
		_ = store.NoteProactiveJudgment(ctx, owner, relationshipID, now)
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: reason}), nil
	}
	_, _, kept := reviewGreeting(safety.New(), body)
	if kept == nil {
		_ = store.NoteProactiveJudgment(ctx, owner, relationshipID, now)
		return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeGated, Reason: "BLOCK"}), nil
	}
	if err := store.SaveProactivePlan(ctx, owner, relationshipID, next, *kept, now); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeSilent, Reason: proactive.ReasonCancelled}), nil
		}
		return postgres.ProactiveRunResult{}, err
	}
	l.prepareProactiveVoices(ctx, store, owner, relationshipID, now)
	return preferInbox(postgres.ProactiveRunResult{Outcome: proactive.OutcomeReady, Reason: next.Trigger.Key}), nil
}

func (l *Loop) prepareProactiveVoices(ctx context.Context, store *postgres.Store, owner, relationshipID int64, now time.Time) {
	if l.voice == nil {
		return
	}
	rows, err := store.ListProactiveVoiceCandidates(ctx, owner, relationshipID)
	if err != nil {
		l.proactiveLog("PROACTIVE_VOICE")
		return
	}
	for _, row := range rows {
		clip, err := l.voice.PrepareProactive(ctx, owner, relationshipID, voice.CreateRequest{MessageRef: "proactive:" + strconv.FormatInt(row.ID, 10), Text: row.Body, Purpose: "proactive"}, row.Trigger, row.PlannedAt, now)
		if err != nil {
			continue
		} // Text delivery remains available on every synthesis failure.
		if clip.Engine != voice.Kokoro || row.PlannedAt.After(now) || clip.Status == "ready" {
			continue
		}
		waitCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		ticker := time.NewTicker(100 * time.Millisecond)
		waiting := true
		for waiting {
			select {
			case <-waitCtx.Done():
				waiting = false
			case <-ticker.C:
				current, err := l.voice.Get(waitCtx, owner, clip.ID)
				if err != nil || current.Status == "ready" || current.Status == "failed" || current.Status == "expired" {
					waiting = false
				}
			}
		}
		ticker.Stop()
		cancel()
	}
}

func (l *Loop) completeProactive(ctx context.Context, store *postgres.Store, owner, relationshipID int64, prompt string, route modelprovider.Route, suffix string) (string, string, error) {
	workID, err := store.InsertProactiveWorkItem(ctx, owner, relationshipID)
	if err != nil {
		return "", "", err
	}
	attempt := "proactive-" + strconv.FormatInt(relationshipID, 10) + "-" + strconv.FormatInt(time.Now().UnixNano(), 10) + "-" + suffix
	decision, err := store.PrepareFollowUpModelCall(ctx, owner, workID, attempt, route.ProviderID, route.ModelID, companion.EstimateTokens(prompt), route.MaxOutputTokens)
	if err != nil {
		switch {
		case errors.Is(err, postgres.ErrFollowUpNoPrice):
			return "", "NO_PRICE", nil
		case errors.Is(err, postgres.ErrFollowUpBudget), errors.Is(err, postgres.ErrRateLimited):
			return "", "BUDGET", nil
		default:
			return "", "", err
		}
	}
	if decision != "HELD" {
		return "", "BUDGET", nil
	}
	settled := false
	defer func() {
		if settled {
			return
		}
		_ = store.SettleFollowUpModelCall(ctx, owner, attempt, "NOT_SENT", nil, nil, nil)
	}()
	provider, err := l.providerFactory(route)
	if err != nil {
		return "", "PROVIDER", nil
	}
	if closer, ok := provider.(interface{ Close() }); ok {
		defer closer.Close()
	}
	var written strings.Builder
	result, callErr := provider.Stream(ctx, companion.ModelRequest{
		Messages:  []companion.Message{{Role: companion.RoleUser, Content: prompt}},
		Stream:    false,
		MaxTokens: route.MaxOutputTokens,
	}, func(delta companion.OutputDelta) error {
		written.WriteString(delta.Text)
		return nil
	})
	disposition, in, out, cached := followUsageSettlement(result.Usage)
	if callErr != nil {
		disposition = "NOT_SENT"
		in, out, cached = nil, nil, nil
	}
	if err := store.SettleFollowUpModelCall(ctx, owner, attempt, disposition, in, out, cached); err != nil {
		return "", "", err
	}
	settled = true
	if callErr != nil {
		return "", "PROVIDER", nil
	}
	return written.String(), "", nil
}

func judgmentRoute(p postgres.ResolvedPurpose) (modelprovider.Route, error) {
	route, err := openProactiveRoute(p, 64)
	if err != nil {
		return modelprovider.Route{}, err
	}
	temp := proactive.JudgmentTemperature
	route.Temperature = &temp
	route.TopP = nil
	return route, nil
}

func pregenRoute(p postgres.ResolvedPurpose) (modelprovider.Route, error) {
	maxOut := p.Model.MaxOutputTokens
	if maxOut < 1 || maxOut > followGenMaxTokens {
		maxOut = followGenMaxTokens
	}
	return openProactiveRoute(p, maxOut)
}

func openProactiveRoute(p postgres.ResolvedPurpose, maxOut int) (modelprovider.Route, error) {
	if strings.TrimSpace(p.ProviderName) == "" || strings.TrimSpace(p.Model.ModelID) == "" || maxOut < 1 {
		return modelprovider.Route{}, errFollowUpParameters
	}
	return modelprovider.Route{
		UseProfileParams: true,
		ProviderID:       p.ProviderID,
		SupplierName:     p.ProviderName,
		Protocol:         p.Protocol,
		BaseURL:          p.BaseURL,
		ModelID:          p.Model.ModelID,
		MaxOutputTokens:  maxOut,
	}, nil
}

func (l *Loop) proactiveLog(code string) {
	if l == nil || l.log == nil {
		return
	}
	l.log.Info("proactive",
		slog.String("operation", "proactive_run"),
		slog.String("outcome", "error"),
		slog.String("error_code", code),
	)
}
