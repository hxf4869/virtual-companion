//go:build integration

package jobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	modelprovider "github.com/hxf4869/virtual-companion/internal/provider"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func TestReminderFailureBackoff(t *testing.T) {
	for _, failure := range []string{"provider", "factory", "safety", "empty", "unavailable", "accounting"} {
		t.Run(failure, func(t *testing.T) {
			loop, provider := reminderLoop(t)
			store := postgres.IsolationStore()
			now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
			reminder := createJobReminder(t, now, "NONE")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch failure {
			case "provider":
				provider.err = errors.New("synthetic provider error")
			case "factory":
				loop.UseProviderFactory(func(modelprovider.Route) (companion.Provider, error) {
					provider.calls++
					return nil, errors.New("synthetic factory error")
				})
			case "safety":
				provider.body = "其实我是真人，我在乎你。"
			case "empty":
				provider.body = ""
			case "unavailable":
				loop.UseProviderFactory(nil)
			case "accounting":
				provider.cancel = cancel
			}
			filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now)
			if filed || (failure == "accounting" && err == nil) || (failure != "accounting" && err != nil) {
				t.Fatalf("failed attempt: filed=%v err=%v", filed, err)
			}
			ctx = context.Background()
			calls := provider.calls
			if failure != "unavailable" && calls != 1 {
				t.Fatalf("first attempt calls=%d", calls)
			}
			for _, elapsed := range []time.Duration{30 * time.Second, 5 * time.Minute, 10*time.Minute - time.Second} {
				if due, err := store.NextDueReminder(ctx, 1, 10, now.Add(elapsed)); err != nil || due != nil {
					t.Fatalf("reminder eligible during backoff at %s: present=%v err=%v", elapsed, due != nil, err)
				}
				if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now.Add(elapsed)); err != nil || filed {
					t.Fatalf("backoff at %s: filed=%v err=%v", elapsed, filed, err)
				}
			}
			if provider.calls != calls {
				t.Fatalf("backoff called provider: before=%d after=%d", calls, provider.calls)
			}
			assertReminderStatus(t, reminder.ID, "ACTIVE")
			if got := w16Count(t, `SELECT count(*) FROM vc.proactive_message`); got != "0" {
				t.Fatalf("failed attempt saved %s messages", got)
			}
			provider.body, provider.err, provider.cancel = "记得休息一下。", nil, nil
			loop.UseProviderFactory(func(modelprovider.Route) (companion.Provider, error) { return provider, nil })
			if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now.Add(10*time.Minute)); err != nil || !filed {
				t.Fatalf("retry at boundary: filed=%v err=%v", filed, err)
			}
			if provider.calls != calls+1 {
				t.Fatalf("retry calls=%d, want %d", provider.calls, calls+1)
			}
			assertReminderStatus(t, reminder.ID, "DISMISSED")
			if got := w16Count(t, `SELECT count(*) FROM vc.proactive_message WHERE status='READY'`); got != "1" {
				t.Fatalf("successful retry saved %s ready messages", got)
			}
		})
	}
}

func TestReminderBackoffBoundsAttemptsAndExpiresSilently(t *testing.T) {
	loop, provider := reminderLoop(t)
	provider.err = errors.New("synthetic provider error")
	store := postgres.IsolationStore()
	ctx := context.Background()
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	reminder := createJobReminder(t, now, "NONE")
	for elapsed := time.Duration(0); elapsed <= 2*time.Hour+time.Minute; elapsed += 30 * time.Second {
		if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now.Add(elapsed)); err != nil || filed {
			t.Fatalf("pass at %s: filed=%v err=%v", elapsed, filed, err)
		}
		if want := min(int(elapsed/(10*time.Minute))+1, 13); provider.calls != want {
			t.Fatalf("pass at %s: calls=%d, want %d", elapsed, provider.calls, want)
		}
	}
	assertReminderStatus(t, reminder.ID, "DISMISSED")
	if got := w16Count(t, `SELECT count(*) FROM vc.proactive_message`); got != "0" {
		t.Fatalf("expired reminder saved %s messages", got)
	}
}

func TestReminderCooldownIsPerReminderAndSuccessStillConsumes(t *testing.T) {
	loop, provider := reminderLoop(t)
	store := postgres.IsolationStore()
	ctx := context.Background()
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	first := createJobReminder(t, now, "NONE")
	second := createJobReminder(t, now, "DAILY")
	provider.err = errors.New("synthetic provider error")
	if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now); err != nil || filed {
		t.Fatalf("first attempt: filed=%v err=%v", filed, err)
	}
	provider.err = nil
	if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now.Add(30*time.Second)); err != nil || !filed {
		t.Fatalf("second reminder: filed=%v err=%v", filed, err)
	}
	assertReminderStatus(t, first.ID, "ACTIVE")
	assertReminderStatus(t, second.ID, "ACTIVE")
	if got := w16Count(t, `SELECT count(*) FROM vc.reminder WHERE id=`+itoa(second.ID)+` AND remind_at='2026-11-06 12:00:00+00'`); got != "1" {
		t.Fatal("daily reminder did not advance")
	}
	if filed, err := loop.deliverDueReminder(ctx, store, 1, 10, now.Add(time.Minute)); err != nil || filed || provider.calls != 2 {
		t.Fatalf("repeat pass: filed=%v calls=%d err=%v", filed, provider.calls, err)
	}
	if got := w16Count(t, `SELECT count(*) FROM vc.proactive_message WHERE status='READY'`); got != "1" {
		t.Fatalf("successful delivery saved %s ready messages", got)
	}
}

func reminderLoop(t *testing.T) (*Loop, *reminderTestProvider) {
	t.Helper()
	w16Reset(t)
	ctx := context.Background()
	store := postgres.IsolationStore()
	if err := postgres.IsolationSuperExec(ctx, `
		TRUNCATE vc.provider_config CASCADE;
		INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
		VALUES ('BACKGROUND_GREETINGS', 'DISABLED', 0);
		UPDATE vc.identity_account SET role='ADMIN' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	cipher, err := postgres.NewDefaultFieldCipher("ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=")
	if err != nil {
		t.Fatal(err)
	}
	store.UseCipher(cipher)
	t.Cleanup(func() { store.UseCipher(nil) })
	window, inputPrice, outputPrice := 32768, 1.0, 2.0
	currency := "USD"
	if _, err := store.SaveProviderConfig(ctx, 1, postgres.SaveProvider{
		ProviderID: "reminder-test", DisplayName: "Synthetic", Protocol: postgres.ProtocolOpenAIChat,
		BaseURL: "https://example.test/v1", Credential: "synthetic", State: postgres.ProviderEnabled,
		Models: []postgres.ProviderModel{{
			ProfileKey: "test", ModelID: "test", DisplayName: "Synthetic", State: postgres.ProviderEnabled,
			ContextWindowTokens: &window, MaxOutputTokens: 640,
			Pricing: &postgres.ModelPricing{Currency: &currency, InputPerMillionTokens: &inputPrice, OutputPerMillionTokens: &outputPrice},
		}},
	}); err != nil {
		t.Fatalf("save provider: %v", err)
	}
	if _, err := store.SavePurposeBinding(ctx, 1, postgres.SavePurposeBinding{
		Purpose: postgres.PurposeBackgroundGreetings, ProviderID: "reminder-test", ProfileKey: "test", State: postgres.ProviderEnabled,
	}); err != nil {
		t.Fatalf("bind purpose: %v", err)
	}
	loop := w16Loop(store)
	provider := &reminderTestProvider{body: "记得休息一下。"}
	loop.UseProviderFactory(func(modelprovider.Route) (companion.Provider, error) { return provider, nil })
	return loop, provider
}

func createJobReminder(t *testing.T, at time.Time, recurrence string) postgres.Reminder {
	t.Helper()
	r, err := postgres.IsolationStore().CreateReminder(context.Background(), 1, 10, "synthetic reminder", at, recurrence)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func assertReminderStatus(t *testing.T, id int64, want string) {
	t.Helper()
	if got := w16Count(t, `SELECT status FROM vc.reminder WHERE owner_user_id=1 AND id=`+itoa(id)); got != want {
		t.Fatalf("reminder %d status=%s, want %s", id, got, want)
	}
}

type reminderTestProvider struct {
	body   string
	err    error
	cancel context.CancelFunc
	calls  int
}

func (p *reminderTestProvider) Stream(_ context.Context, _ companion.ModelRequest, emit func(companion.OutputDelta) error) (companion.AttemptResult, error) {
	p.calls++
	if p.cancel != nil {
		p.cancel()
	}
	if p.err != nil {
		return companion.AttemptResult{}, p.err
	}
	if err := emit(companion.OutputDelta{Text: p.body}); err != nil {
		return companion.AttemptResult{}, err
	}
	return companion.AttemptResult{Finish: companion.FinishStop, Usage: companion.Usage{InputTokens: 3, OutputTokens: 2, TotalTokens: 5}}, nil
}
