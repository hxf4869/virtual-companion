package httpapi

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/hxf4869/virtual-companion/internal/store/postgres"
)

func (m *memStore) RelationshipOwned(_ context.Context, owner, rel int64) error {
	if owner != 1 || rel != 7 {
		return postgres.ErrNotFound
	}
	return nil
}

func (m *memStore) CreateReminder(_ context.Context, owner, rel int64, text string, at time.Time, recurrence string) (postgres.Reminder, error) {
	if rel != 7 {
		return postgres.Reminder{}, postgres.ErrNotFound
	}
	return postgres.Reminder{ID: 5, RelationshipID: rel, Text: text, RemindAt: at, Recurrence: recurrence, Status: "ACTIVE", CreatedAt: at, UpdatedAt: at}, nil
}

func (m *memStore) ListActiveReminders(context.Context, int64, int64, int) ([]postgres.Reminder, error) {
	return []postgres.Reminder{}, nil
}

func (m *memStore) DeleteReminder(_ context.Context, _ int64, id int64) error {
	if id != 5 {
		return postgres.ErrNotFound
	}
	return nil
}

func (m *memStore) CreateFavorite(_ context.Context, _ int64, rel int64, in postgres.FavoriteWrite) (postgres.Favorite, error) {
	return postgres.Favorite{ID: 9, RelationshipID: rel, ChatFile: in.ChatFile, MesID: in.MesID, Role: in.Role, Body: in.Body, CreatedAt: time.Unix(1, 0)}, nil
}

func (m *memStore) ListFavorites(_ context.Context, _ int64, _ int64, after int64, limit int) ([]postgres.Favorite, string, error) {
	if limit < 1 || limit > 100 {
		return nil, "", postgres.ErrInvalid
	}
	return []postgres.Favorite{}, "", nil
}

func (m *memStore) DeleteFavorite(context.Context, int64, int64) error { return postgres.ErrNotFound }

type fakeSuggester struct {
	got []proactive.SuggestMessage
}

func (f *fakeSuggester) SuggestReplies(_ context.Context, _ int64, _ int64, in []proactive.SuggestMessage) ([]string, error) {
	f.got = in
	return []string{"好呀"}, nil
}

func TestReplySuggestionsValidatesAndForwards(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	fake := &fakeSuggester{}
	s.core.Suggester = fake

	ok := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/reply-suggestions", `{"messages":[{"role":"character","text":"今晚吃什么？"}]}`, 1)
	if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), `"suggestions":["好呀"]`) || len(fake.got) != 1 {
		t.Fatalf("suggestions %d %s", ok.Code, ok.Body.String())
	}
	for name, body := range map[string]string{
		"empty":    `{"messages":[]}`,
		"bad role": `{"messages":[{"role":"system","text":"x"}]}`,
		"too many": `{"messages":[` + strings.Repeat(`{"role":"user","text":"x"},`, 8) + `{"role":"user","text":"x"}]}`,
	} {
		if got := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/reply-suggestions", body, 1); got.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, got.Code, got.Body.String())
		}
	}
	if got := doJSON(t, s, http.MethodPost, "/api/v1/relationships/8/reply-suggestions", `{"messages":[{"role":"user","text":"x"}]}`, 1); got.Code != http.StatusNotFound {
		t.Fatalf("foreign relationship %d", got.Code)
	}
}

func TestCreateReminderRejectsUnsafeInstants(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	ok := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/reminders", `{"text":"喝水","remindAt":"`+future+`"}`, 1)
	if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), `"recurrence":"NONE"`) {
		t.Fatalf("create %d %s", ok.Code, ok.Body.String())
	}
	past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	for name, body := range map[string]string{
		"date only":  `{"text":"喝水","remindAt":"2099-01-01"}`,
		"zoneless":   `{"text":"喝水","remindAt":"2099-01-01T09:00:00"}`,
		"past":       `{"text":"喝水","remindAt":"` + past + `"}`,
		"blank text": `{"text":"  ","remindAt":"` + future + `"}`,
		"bad repeat": `{"text":"喝水","remindAt":"` + future + `","recurrence":"HOURLY"}`,
	} {
		if got := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/reminders", body, 1); got.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d %s", name, got.Code, got.Body.String())
		}
	}
	if got := doJSON(t, s, http.MethodDelete, "/api/v1/reminders/6", "", 1); got.Code != http.StatusNotFound {
		t.Fatalf("delete absent %d", got.Code)
	}
}

func TestCreateFavoriteRequiresSource(t *testing.T) {
	t.Parallel()
	s := newCoreServer(t, "full", newMemStore())
	ok := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/favorites", `{"chatFile":"a.jsonl","mesId":3,"role":"character","body":"晚安"}`, 1)
	if ok.Code != http.StatusOK || !strings.Contains(ok.Body.String(), `"favoriteId":"9"`) {
		t.Fatalf("create %d %s", ok.Code, ok.Body.String())
	}
	if got := doJSON(t, s, http.MethodPost, "/api/v1/relationships/7/favorites", `{"chatFile":"a.jsonl","role":"character","body":"晚安"}`, 1); got.Code != http.StatusBadRequest {
		t.Fatalf("missing mesId %d", got.Code)
	}
	if got := doJSON(t, s, http.MethodGet, "/api/v1/relationships/7/favorites?limit=0", "", 1); got.Code != http.StatusBadRequest {
		t.Fatalf("limit 0 %d", got.Code)
	}
}
