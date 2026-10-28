package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/store/postgres"
	"github.com/hxf4869/virtual-companion/internal/story"
)

type storyWorldHTTPStore struct {
	*memStore
	starts int
	views  int
}

func storyProbeEvents() []story.Event {
	return []story.Event{
		{ID: 1, ActorID: "player", WorldVersion: 0, Visibility: []string{"player", "lin", "zhou", "su"}, Body: json.RawMessage(`{"note":"PUBLIC_LOBBY_NOTE"}`)},
		{ID: 2, ActorID: "lin", WorldVersion: 0, Visibility: []string{"lin"}, Body: json.RawMessage(`{"note":"PRIVATE_LIN_LOAN_31"}`)},
		{ID: 3, ActorID: "zhou", WorldVersion: 0, Visibility: []string{"zhou"}, Body: json.RawMessage(`{"note":"PRIVATE_ZHOU_WATCH_44"}`)},
		{ID: 4, ActorID: "su", WorldVersion: 0, Visibility: []string{"su"}, Body: json.RawMessage(`{"note":"PRIVATE_SU_WITNESS_57"}`)},
	}
}

func (m *storyWorldHTTPStore) StartStoryRun(_ context.Context, owner, conversationID int64, caseID string) (postgres.StoryRun, error) {
	m.starts++
	if owner != 1 {
		return postgres.StoryRun{}, postgres.ErrNotFound
	}
	if caseID != "rainy-inn-v1" {
		return postgres.StoryRun{}, postgres.ErrInvalid
	}
	if conversationID == 2 {
		return postgres.StoryRun{}, postgres.ErrConflict
	}
	if conversationID != 7 {
		return postgres.StoryRun{}, postgres.ErrNotFound
	}
	return postgres.StoryRun{
		ConversationID: 7, RunID: 11, BranchID: 13, CaseID: "rainy-inn-v1",
		WorldVersion: 0, Stage: "investigation",
		Participants: []postgres.StoryParticipant{
			{ActorID: "player", Name: "调查者", Role: "player", Scene: "lobby"},
			{ActorID: "lin", Name: "林岚", Role: "npc", Scene: "lobby"},
			{ActorID: "zhou", Name: "周澈", Role: "npc", Scene: "lobby"},
			{ActorID: "su", Name: "苏禾", Role: "npc", Scene: "lobby"},
		},
	}, nil
}

func (m *storyWorldHTTPStore) LoadStoryActor(_ context.Context, owner, runID, branchID int64, actorID string, worldVersion int64) (postgres.StoryActorFacts, error) {
	m.views++
	if owner != 1 || runID != 11 || branchID != 13 {
		return postgres.StoryActorFacts{}, postgres.ErrNotFound
	}
	if worldVersion != 0 {
		return postgres.StoryActorFacts{}, postgres.ErrStoryWorldVersion
	}
	switch actorID {
	case "player", "lin", "zhou", "su":
	default:
		return postgres.StoryActorFacts{}, postgres.ErrNotFound
	}
	return postgres.StoryActorFacts{
		ConversationID: 7, RunID: 11, BranchID: 13, ActorID: actorID,
		CaseID: "rainy-inn-v1", WorldVersion: 0, Events: storyProbeEvents(),
	}, nil
}

func TestStoryActorViewHTTPBodyHidesOtherSecrets(t *testing.T) {
	m := &storyWorldHTTPStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", m)
	personas, goals := rainyInnNPCPublic(t)
	for _, actor := range []string{"player", "lin", "zhou", "su"} {
		path := "/api/v1/story/runs/11/actors/" + actor + "/view?branchId=13&worldVersion=0"
		rec := doJSON(t, s, http.MethodGet, path, "", 1)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", actor, rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		for _, persona := range personas {
			if !strings.Contains(body, persona) {
				t.Fatalf("%s HTTP body missing public persona %s: %s", actor, persona, body)
			}
		}
		for _, goal := range goals {
			if strings.Contains(body, goal) {
				t.Fatalf("%s HTTP body contains private goal %s: %s", actor, goal, body)
			}
		}
		for _, want := range []string{
			`"conversationId":"7"`,
			`"runId":"11"`,
			`"branchId":"13"`,
			`"actorId":"` + actor + `"`,
			`"worldVersion":0`,
			"雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。",
			"PUBLIC_LOBBY_NOTE",
		} {
			if !strings.Contains(body, want) {
				t.Fatalf("%s serialized body missing %s: %s", actor, want, body)
			}
		}
		assertHTTPStorySecrets(t, actor, body)
		var decoded map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &decoded); err != nil {
			t.Fatal(err)
		}
		parts, _ := decoded["participants"].([]any)
		if len(parts) != 3 {
			t.Fatalf("%s participants = %#v", actor, decoded["participants"])
		}
		for _, item := range parts {
			obj, _ := item.(map[string]any)
			if len(obj) != 3 || obj["actorId"] == "" || obj["name"] == "" || obj["publicPersona"] == "" {
				t.Fatalf("%s participant keys = %#v", actor, obj)
			}
		}
		walkStoryKeys(t, decoded)
	}
}

func TestStoryWorldRejectsAnonymousForeignCompanionAndStaleVersion(t *testing.T) {
	m := &storyWorldHTTPStore{memStore: newMemStore()}
	s := newCoreServer(t, "full", m)
	startBody := `{"conversationId":"7","caseId":"rainy-inn-v1"}`

	anon := httptest.NewRequest(http.MethodPost, "/api/v1/story/runs", strings.NewReader(startBody))
	anon.Header.Set("Content-Type", "application/json")
	anon.Header.Set("Origin", "https://vc.test")
	anon.AddCookie(&http.Cookie{Name: csrfCookie, Value: "csrf-token"})
	anon.Header.Set(csrfHeader, "csrf-token")
	anonRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(anonRec, anon)
	if anonRec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous start=%d", anonRec.Code)
	}
	assertEnvelope(t, anonRec, "AUTHENTICATION_REQUIRED")
	assertNoStorySecrets(t, "anonymous", anonRec.Body.String())

	anonView := httptest.NewRequest(http.MethodGet, "/api/v1/story/runs/11/actors/su/view?branchId=13&worldVersion=0", nil)
	anonViewRec := httptest.NewRecorder()
	s.Handler().ServeHTTP(anonViewRec, anonView)
	if anonViewRec.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous view=%d", anonViewRec.Code)
	}
	assertEnvelope(t, anonViewRec, "AUTHENTICATION_REQUIRED")
	assertNoStorySecrets(t, "anonymous-view", anonViewRec.Body.String())

	if got := doJSON(t, s, http.MethodPost, "/api/v1/story/runs", startBody, 2); got.Code != http.StatusNotFound {
		t.Fatalf("foreign start=%d %s", got.Code, got.Body.String())
	}
	if got := doJSON(t, s, http.MethodGet, "/api/v1/story/runs/11/actors/su/view?branchId=13&worldVersion=0", "", 2); got.Code != http.StatusNotFound {
		t.Fatalf("foreign view=%d %s", got.Code, got.Body.String())
	}
	if got := doJSON(t, s, http.MethodPost, "/api/v1/story/runs", `{"conversationId":"2","caseId":"rainy-inn-v1"}`, 1); got.Code != http.StatusConflict {
		t.Fatalf("companion start=%d %s", got.Code, got.Body.String())
	}
	stale := doJSON(t, s, http.MethodGet, "/api/v1/story/runs/11/actors/su/view?branchId=13&worldVersion=1", "", 1)
	if stale.Code != http.StatusConflict {
		t.Fatalf("worldVersion conflict=%d %s", stale.Code, stale.Body.String())
	}
	assertEnvelope(t, stale, "REVISION_CONFLICT")
	assertNoStorySecrets(t, "stale", stale.Body.String())

	calls := m.starts
	for _, header := range []string{"Origin", "X-CSRF-Token"} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/story/runs", strings.NewReader(startBody))
		req.Header.Set("Content-Type", "application/json")
		attachAuth(t, s, req, 1, true)
		req.Header.Del(header)
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("missing %s status=%d", header, rec.Code)
		}
	}
	if m.starts != calls {
		t.Fatal("rejected start reached the store")
	}

	started := doJSON(t, s, http.MethodPost, "/api/v1/story/runs", startBody, 1)
	if started.Code != http.StatusOK {
		t.Fatalf("start=%d %s", started.Code, started.Body.String())
	}
	again := doJSON(t, s, http.MethodPost, "/api/v1/story/runs", startBody, 1)
	if again.Body.String() != started.Body.String() {
		t.Fatalf("repeat start changed body %s", again.Body.String())
	}
	startRaw := started.Body.String()
	for _, name := range []string{"调查者", "林岚", "周澈", "苏禾", `"caseId":"rainy-inn-v1"`, `"worldVersion":0`, `"stage":"investigation"`} {
		if !strings.Contains(startRaw, name) {
			t.Fatalf("start missing %s: %s", name, startRaw)
		}
	}
	assertNoStorySecrets(t, "start", startRaw)
	walkStoryKeys(t, mustJSONMap(t, started.Body.Bytes()))
}

func TestStoryActorViewSchemaHasNoGMTruth(t *testing.T) {
	raw, err := os.ReadFile("../../../specs/openapi/virtual-companion.yaml")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	const key = "\n    StoryActorView:"
	i := strings.Index(text, key)
	if i < 0 {
		t.Fatal("OpenAPI schema StoryActorView is missing")
	}
	rest := text[i+1:]
	section := rest
	if loc := regexp.MustCompile(`\n    [A-Z]`).FindStringIndex(rest[len("    StoryActorView:"):]); loc != nil {
		section = rest[:len("    StoryActorView:")+loc[0]]
	}
	for _, name := range []string{"conversationId", "runId", "branchId", "actorId", "worldVersion", "publicLore", "knowledge", "events", "participants", "publicPersona"} {
		if !strings.Contains(section, name) {
			t.Fatalf("schema missing %s: %s", name, section)
		}
	}
	for _, forbidden := range []string{
		"gmTruth", "gm_truth", "responsibleActor", "responsible_actor", "watchLocation", "watch_location",
		"motive", "timeline", "initialState", "initial_state", "goal", "GM_ONLY_WATCH_TRUTH_92",
		"PRIVATE_ZHOU_WATCH_44", "PRIVATE_SU_WITNESS_57", "PRIVATE_LIN_LOAN_31",
	} {
		if strings.Contains(section, forbidden) {
			t.Fatalf("schema contains %s", forbidden)
		}
	}
}

func assertHTTPStorySecrets(t *testing.T, actor, body string) {
	t.Helper()
	assertNoStorySecrets(t, actor, body)
	own := map[string][2]string{
		"lin":  {"PRIVATE_LIN_LOAN_31", "19:55把维修柜钥匙借给周澈，并有借用记录。"},
		"zhou": {"PRIVATE_ZHOU_WATCH_44", "自己把怀表藏在维修柜，钥匙还在自己手里。"},
		"su":   {"PRIVATE_SU_WITNESS_57", "20:13只看见蓝色衣袖进入维修间，没有看清脸。"},
	}
	for id, sec := range own {
		present := strings.Contains(body, sec[0]) || strings.Contains(body, sec[1])
		if id == actor {
			if !strings.Contains(body, sec[0]) || !strings.Contains(body, sec[1]) {
				t.Fatalf("%s HTTP body missing own secret %s: %s", actor, sec[0], body)
			}
			continue
		}
		if present {
			t.Fatalf("%s HTTP body contains %s secret: %s", actor, id, body)
		}
	}
	if actor == "su" && (strings.Contains(body, "PRIVATE_ZHOU_WATCH_44") || strings.Contains(body, "GM_ONLY_WATCH_TRUTH_92")) {
		t.Fatalf("su HTTP body leaked: %s", body)
	}
	if actor == "zhou" && strings.Contains(body, "PRIVATE_SU_WITNESS_57") {
		t.Fatalf("zhou HTTP body leaked: %s", body)
	}
	if actor == "lin" && (strings.Contains(body, "PRIVATE_ZHOU_WATCH_44") || strings.Contains(body, "PRIVATE_SU_WITNESS_57")) {
		t.Fatalf("lin HTTP body leaked: %s", body)
	}
	if actor == "player" && (strings.Contains(body, "PRIVATE_LIN_LOAN_31") || strings.Contains(body, "PRIVATE_ZHOU_WATCH_44") ||
		strings.Contains(body, "PRIVATE_SU_WITNESS_57") || strings.Contains(body, "GM_ONLY_WATCH_TRUTH_92")) {
		t.Fatalf("player HTTP body leaked: %s", body)
	}
}

func assertNoStorySecrets(t *testing.T, actor, body string) {
	t.Helper()
	for _, forbidden := range []string{
		"GM_ONLY_WATCH_TRUTH_92",
		"workshop_cabinet",
		"周澈因维修报酬争议擅自暂藏怀表",
		"deterministic_success_path",
		"grant_player_clue",
		"避免承认擅自拿走怀表",
		"gm_truth",
		"initial_private_knowledge",
		`"goal"`,
		`"motive"`,
		`"rules"`,
		`"timeline"`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("%s body contains %s: %s", actor, forbidden, body)
		}
	}
}

func walkStoryKeys(t *testing.T, v any) {
	t.Helper()
	switch n := v.(type) {
	case map[string]any:
		for k, child := range n {
			switch k {
			case "gmTruth", "gm_truth", "responsibleActor", "responsible_actor", "watchLocation", "watch_location",
				"motive", "timeline", "initialState", "initial_state", "goal", "rules", "allowedActions", "knownBy":
				t.Fatalf("response schema field %s", k)
			}
			walkStoryKeys(t, child)
		}
	case []any:
		for _, child := range n {
			walkStoryKeys(t, child)
		}
	}
}

func rainyInnNPCPublic(t *testing.T) (personas, goals []string) {
	t.Helper()
	raw, err := os.ReadFile("../story/cases/rainy-inn-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var def struct {
		Actors []struct {
			Role          string `json:"role"`
			PublicPersona string `json:"public_persona"`
			Goal          string `json:"goal"`
		} `json:"actors"`
	}
	if err := json.Unmarshal(raw, &def); err != nil {
		t.Fatal(err)
	}
	for _, actor := range def.Actors {
		if actor.Goal != "" {
			goals = append(goals, actor.Goal)
		}
		if actor.Role != "npc" {
			continue
		}
		if actor.PublicPersona == "" {
			t.Fatal("npc missing public_persona")
		}
		personas = append(personas, actor.PublicPersona)
	}
	if len(personas) != 3 || len(goals) != 3 {
		t.Fatalf("personas=%d goals=%d", len(personas), len(goals))
	}
	return personas, goals
}

func mustJSONMap(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}
