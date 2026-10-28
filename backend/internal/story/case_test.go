package story

import (
	"bytes"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestEmbeddedRainyInnKeepsFixtureRules(t *testing.T) {
	embedded, err := os.ReadFile("cases/rainy-inn-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := os.ReadFile("../../../docs/source/v2-r3/fixtures/rainy_inn_case.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(embedded, fixture) {
		t.Fatal("rainy-inn-v1.json drifted from rainy_inn_case.json")
	}
	for _, marker := range []string{
		`"case_id": "rainy-inn-v1"`,
		`"id": "evidence-lin"`,
		`"allowed_actions"`,
		`"deterministic_success_path"`,
		"GM_ONLY_WATCH_TRUTH_92",
		"PRIVATE_LIN_LOAN_31",
		"PRIVATE_ZHOU_WATCH_44",
		"PRIVATE_SU_WITNESS_57",
	} {
		if !bytes.Contains(embedded, []byte(marker)) {
			t.Fatalf("embedded case missing %s", marker)
		}
	}
}

func TestOpenRainyInnParticipants(t *testing.T) {
	spec, err := Open("rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	if spec.CaseID != "rainy-inn-v1" || spec.WorldVersion != 0 || spec.Stage != "investigation" {
		t.Fatalf("spec = %+v", spec)
	}
	if _, err := Open("other-case"); err == nil {
		t.Fatal("unknown case must fail")
	}
	want := []Participant{
		{ActorID: "player", Name: "调查者", Role: "player", Scene: "lobby"},
		{ActorID: "lin", Name: "林岚", Role: "npc", Scene: "lobby"},
		{ActorID: "zhou", Name: "周澈", Role: "npc", Scene: "lobby"},
		{ActorID: "su", Name: "苏禾", Role: "npc", Scene: "lobby"},
	}
	if len(spec.Participants) != len(want) {
		t.Fatalf("participants = %+v", spec.Participants)
	}
	for i, p := range want {
		if spec.Participants[i] != p {
			t.Fatalf("participant %d = %+v", i, spec.Participants[i])
		}
	}
}

func TestActorViewHidesGMAndOtherPrivateKnowledge(t *testing.T) {
	events := []Event{
		{ID: 1, ActorID: "player", WorldVersion: 0, Visibility: []string{"player", "lin", "zhou", "su"}, Body: json.RawMessage(`{"note":"PUBLIC_LOBBY_NOTE"}`)},
		{ID: 2, ActorID: "lin", WorldVersion: 0, Visibility: []string{"lin"}, Body: json.RawMessage(`{"note":"PRIVATE_LIN_LOAN_31"}`)},
		{ID: 3, ActorID: "zhou", WorldVersion: 0, Visibility: []string{"zhou"}, Body: json.RawMessage(`{"note":"PRIVATE_ZHOU_WATCH_44"}`)},
		{ID: 4, ActorID: "su", WorldVersion: 0, Visibility: []string{"su"}, Body: json.RawMessage(`{"note":"PRIVATE_SU_WITNESS_57"}`)},
	}
	scope := Scope{ConversationID: 7, RunID: 11, BranchID: 13, WorldVersion: 0}
	for _, actor := range []string{"player", "lin", "zhou", "su"} {
		scope.ActorID = actor
		view, err := ActorView("rainy-inn-v1", scope, events)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		body := string(raw)
		assertStoryBody(t, actor, body)
	}
	if _, err := ActorView("rainy-inn-v1", Scope{ActorID: "gm", ConversationID: 7, RunID: 11, BranchID: 13}, nil); err == nil {
		t.Fatal("gm actor must not receive a view")
	}
}

func assertStoryBody(t *testing.T, actor, body string) {
	t.Helper()
	for _, forbidden := range []string{
		"workshop_cabinet",
		"周澈因维修报酬争议擅自暂藏怀表",
		"deterministic_success_path",
		"grant_player_clue",
		"避免承认擅自拿走怀表",
		"gm_truth",
		"initial_private_knowledge",
		"initial_state",
		`"goal"`,
		`"motive"`,
		`"rules"`,
		`"timeline"`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("%s view leaked %s in %s", actor, forbidden, body)
		}
	}
	if !strings.Contains(body, "雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。") || !strings.Contains(body, "PUBLIC_LOBBY_NOTE") {
		t.Fatalf("%s view missing public lore or event: %s", actor, body)
	}
	type secret struct{ marker, fact string }
	own := map[string]secret{
		"lin":  {"PRIVATE_LIN_LOAN_31", "19:55把维修柜钥匙借给周澈，并有借用记录。"},
		"zhou": {"PRIVATE_ZHOU_WATCH_44", "自己把怀表藏在维修柜，钥匙还在自己手里。"},
		"su":   {"PRIVATE_SU_WITNESS_57", "20:13只看见蓝色衣袖进入维修间，没有看清脸。"},
	}
	for id, sec := range own {
		has := strings.Contains(body, sec.marker) || strings.Contains(body, sec.fact)
		if id == actor {
			if !strings.Contains(body, sec.marker) || !strings.Contains(body, sec.fact) {
				t.Fatalf("%s view missing own knowledge %s in %s", actor, sec.marker, body)
			}
			continue
		}
		if has {
			t.Fatalf("%s view contains %s knowledge in %s", actor, id, body)
		}
	}
	if strings.Contains(body, "GM_ONLY_WATCH_TRUTH_92") {
		t.Fatalf("%s view contains GM marker in %s", actor, body)
	}
}
