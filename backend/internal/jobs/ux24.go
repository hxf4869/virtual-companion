package jobs

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/hxf4869/virtual-companion/internal/safety"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

const (
	diaryMaxTokens        = 640
	suggestMaxTokens      = 160
	suggestTemperature    = 0.3
	diaryTemperature      = 0.4
	diaryTargetWindow     = 36 * time.Hour
	reminderMaxTokens     = followGenMaxTokens
	backgroundUnavailable = "UNAVAILABLE"
)

// CompleteBackground runs one text completion on the BACKGROUND_GREETINGS
// purpose model with usage accounting. A non-empty reason means the model was
// not usable (unbound, budget, credential, provider); the text is then empty.
// temperature nil keeps the profile's own parameters.
func (l *Loop) CompleteBackground(ctx context.Context, owner, relationshipID int64, prompt string, maxTokens int, temperature *float64) (string, string, error) {
	if l == nil || l.providerFactory == nil {
		return "", backgroundUnavailable, nil
	}
	store, ok := l.store.(*postgres.Store)
	if !ok {
		return "", backgroundUnavailable, nil
	}
	resolved, err := store.ResolvePurpose(ctx, postgres.ResolvePurpose{OwnerAccountID: owner, Purpose: postgres.PurposeBackgroundGreetings})
	if err != nil {
		return "", "UNBOUND", nil
	}
	if limit := resolved.Model.MaxOutputTokens; limit > 0 && limit < maxTokens {
		maxTokens = limit
	}
	route, err := openProactiveRoute(resolved, maxTokens)
	if err != nil {
		return "", "PARAMETERS", nil
	}
	if temperature != nil {
		t := *temperature
		route.Temperature = &t
		route.TopP = nil
	}
	if err := refreshFollowCredential(ctx, store, &route, resolved.ProviderRevision); err != nil {
		return "", "CREDENTIAL", nil
	}
	return l.completeProactive(ctx, store, owner, relationshipID, prompt, route, "b")
}

// SuggestReplies asks the background model for up to three short replies. It
// stores nothing; any model failure or unparsable output is an empty list.
func (l *Loop) SuggestReplies(ctx context.Context, owner, relationshipID int64, messages []proactive.SuggestMessage) ([]string, error) {
	messages = proactive.ClipSuggestMessages(messages)
	if len(messages) == 0 {
		return []string{}, nil
	}
	text, reason, err := l.CompleteBackground(ctx, owner, relationshipID, proactive.ReplySuggestionsPrompt(messages), suggestMaxTokens, nil)
	if err != nil {
		return nil, err
	}
	items := []string{}
	if reason == "" {
		items = proactive.ParseReplySuggestions(text)
	}
	// 只记输出形状，不记正文（日志不得含对话内容）。
	if l.log != nil {
		l.log.Info("reply suggestions",
			slog.String("reason", reason),
			slog.Int("out_runes", utf8.RuneCountInString(text)),
			slog.Bool("bracket", strings.Contains(text, "[")),
			slog.Bool("fullwidth_quote", strings.ContainsAny(text, "“”")),
			slog.Int("items", len(items)),
		)
	}
	return items, nil
}

// deliverDueReminder turns the oldest fresh due reminder into a READY message
// and returns true when one was filed. Model trouble leaves the reminder
// ACTIVE for the next pass; it is dropped once it is older than two hours.
func (l *Loop) deliverDueReminder(ctx context.Context, store *postgres.Store, owner, relationshipID int64, now time.Time) (bool, error) {
	due, err := store.NextDueReminder(ctx, owner, relationshipID, now)
	if err != nil || due == nil {
		return false, err
	}
	body, reason, err := l.CompleteBackground(ctx, owner, relationshipID, proactive.ReminderPrompt(due.CharName, due.UserName, due.Text), reminderMaxTokens, nil)
	if err != nil || reason != "" {
		return false, err
	}
	_, _, kept := reviewGreeting(safety.New(), body)
	if kept == nil {
		return false, nil
	}
	if err := store.SaveReminderMessage(ctx, owner, relationshipID, *due, *kept, now); err != nil {
		if errors.Is(err, postgres.ErrConflict) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// RunDiaryPass writes today's diary page for relationships that chatted today.
// One attempt per relationship per local day; a failed attempt is not retried
// before the next day. Nothing here reaches memory, profile or prompts.
func (l *Loop) RunDiaryPass(ctx context.Context, now time.Time) {
	if l == nil || l.providerFactory == nil {
		return
	}
	store, ok := l.store.(*postgres.Store)
	if !ok {
		return
	}
	targets, err := store.ListDiaryTargets(ctx, now.Add(-diaryTargetWindow))
	if err != nil {
		l.diaryLog("DIARY_LIST")
		return
	}
	for _, target := range targets {
		if ctx.Err() != nil {
			return
		}
		if err := l.writeDiary(ctx, store, target.OwnerID, target.RelationshipID, now); err != nil {
			l.diaryLog("DIARY_RUN")
		}
	}
}

func (l *Loop) writeDiary(ctx context.Context, store *postgres.Store, owner, relationshipID int64, now time.Time) error {
	input, err := store.LoadDiaryInput(ctx, owner, relationshipID, now)
	if err != nil || input == nil {
		return err
	}
	if err := store.NoteDiaryAttempt(ctx, owner, relationshipID, now); err != nil {
		return err
	}
	temp := diaryTemperature
	text, reason, err := l.CompleteBackground(ctx, owner, relationshipID, proactive.DiaryPrompt(input.CharName, input.UserName, input.Vibe, input.Turns), diaryMaxTokens, &temp)
	if err != nil || reason != "" {
		return err
	}
	body, moments, ok := proactive.ParseDiary(text)
	if !ok {
		return nil
	}
	if _, _, kept := reviewDiary(body); kept == nil {
		return nil
	}
	return store.SaveDiaryEntry(ctx, owner, relationshipID, input.Day, body, input.Vibe, moments)
}

func (l *Loop) diaryLog(code string) {
	if l == nil || l.log == nil {
		return
	}
	l.log.Info("diary", "operation", "diary_run", "outcome", "error", "error_code", code)
}

// reviewDiary applies the output safety policy; a 300-rune page is longer than
// a greeting, so only the policy and emptiness checks of reviewGreeting's kind apply.
func reviewDiary(text string) (string, string, *string) {
	decision := safety.New().ReviewOutput(text)
	if !decision.Allow {
		return followGenBlocked, "BLOCK", nil
	}
	return followGenBodyReady, followGenBodyReady, &text
}
