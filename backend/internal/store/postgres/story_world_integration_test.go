//go:build integration

package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/jackc/pgx/v5"
)

func TestStartStoryRunIsIdempotentAndRejectsCompanion(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	first := mustStoryConversation(t, ctx, 1, "w12-story-a")
	second := mustStoryConversation(t, ctx, 1, "w12-story-b")
	companion := mustConversation(t, ctx, 1, "w12-companion", "COMPANION")

	run, err := testEnv.store.StartStoryRun(ctx, 1, first, "rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	again, err := testEnv.store.StartStoryRun(ctx, 1, first, "rainy-inn-v1")
	if err != nil || again.RunID != run.RunID || again.BranchID != run.BranchID || again.ConversationID != first {
		t.Fatalf("repeat = %+v, %v", again, err)
	}
	other, err := testEnv.store.StartStoryRun(ctx, 1, second, "rainy-inn-v1")
	if err != nil || other.RunID == run.RunID {
		t.Fatalf("second conversation run = %+v, %v", other, err)
	}
	if _, err := testEnv.store.StartStoryRun(ctx, 1, first, "other-case"); !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown case = %v", err)
	}
	if _, err := testEnv.store.StartStoryRun(ctx, 1, companion, "rainy-inn-v1"); !errors.Is(err, ErrConflict) {
		t.Fatalf("companion start = %v", err)
	}
	if _, err := testEnv.store.StartStoryRun(ctx, 2, first, "rainy-inn-v1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign start = %v", err)
	}
	assertOneRun(t, ctx, first, run)
	var companionRuns int
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*) FROM vc.story_run WHERE conversation_id=$1`, companion).Scan(&companionRuns)
	}); err != nil || companionRuns != 0 {
		t.Fatalf("companion runs=%d err=%v", companionRuns, err)
	}

	raceConversation := mustStoryConversation(t, ctx, 1, "w12-story-race")
	const callers = 8
	results := make([]StoryRun, callers)
	errs := make([]error, callers)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = testEnv.store.StartStoryRun(ctx, 1, raceConversation, "rainy-inn-v1")
		}(i)
	}
	close(start)
	wg.Wait()
	for i := range results {
		if errs[i] != nil || results[i].RunID == 0 || results[i].RunID != results[0].RunID || results[i].BranchID != results[0].BranchID {
			t.Fatalf("concurrent %d = %+v, %v", i, results[i], errs[i])
		}
	}
	assertOneRun(t, ctx, raceConversation, results[0])
}

func TestStoryActorViewReadsOnlyVisibleEvents(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	conversationID := mustStoryConversation(t, ctx, 1, "w12-story-view")
	run, err := testEnv.store.StartStoryRun(ctx, 1, conversationID, "rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	if err := appendStoryEvent(ctx, 1, run, "player", []string{"player", "lin", "zhou", "su"}, `{"note":"PUBLIC_LOBBY_NOTE"}`); err != nil {
		t.Fatal(err)
	}
	if err := appendStoryEvent(ctx, 1, run, "lin", []string{"lin"}, `{"note":"PRIVATE_LIN_LOAN_31"}`); err != nil {
		t.Fatal(err)
	}
	if err := appendStoryEvent(ctx, 1, run, "zhou", []string{"zhou"}, `{"note":"PRIVATE_ZHOU_WATCH_44"}`); err != nil {
		t.Fatal(err)
	}
	if err := appendStoryEvent(ctx, 1, run, "su", []string{"su"}, `{"note":"PRIVATE_SU_WITNESS_57"}`); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.LoadStoryActor(ctx, 1, run.RunID, run.BranchID, "su", 1); !errors.Is(err, ErrStoryWorldVersion) {
		t.Fatalf("stale world version = %v", err)
	}
	if _, err := testEnv.store.LoadStoryActor(ctx, 2, run.RunID, run.BranchID, "su", 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign view = %v", err)
	}
	if _, err := testEnv.store.LoadStoryActor(ctx, 1, run.RunID, run.BranchID+99, "su", 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong branch = %v", err)
	}
	for _, actor := range []string{"player", "lin", "zhou", "su"} {
		facts, err := testEnv.store.LoadStoryActor(ctx, 1, run.RunID, run.BranchID, actor, 0)
		if err != nil {
			t.Fatal(err)
		}
		if facts.ConversationID != conversationID || facts.RunID != run.RunID || facts.BranchID != run.BranchID || facts.WorldVersion != 0 || facts.CaseID != "rainy-inn-v1" || facts.ChatIdentity != "w12-story-view" {
			t.Fatalf("facts = %+v", facts)
		}
		blob := string(mustJSON(t, facts.Events))
		if strings.Contains(blob, "PUBLIC_LOBBY_NOTE") == false {
			t.Fatalf("%s events missing public note: %s", actor, blob)
		}
		for _, hidden := range hiddenEventMarkers(actor) {
			if strings.Contains(blob, hidden) {
				t.Fatalf("%s events leaked %s: %s", actor, hidden, blob)
			}
		}
		view, err := story.ActorView("rainy-inn-v1", story.Scope{
			ConversationID: facts.ConversationID, RunID: facts.RunID, BranchID: facts.BranchID,
			ActorID: actor, WorldVersion: facts.WorldVersion,
		}, facts.Events)
		if err != nil {
			t.Fatal(err)
		}
		body := string(mustJSON(t, view))
		if !strings.Contains(body, "PUBLIC_LOBBY_NOTE") || !strings.Contains(body, "雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。") {
			t.Fatalf("%s view missing public data: %s", actor, body)
		}
		for _, hidden := range append(hiddenEventMarkers(actor), "GM_ONLY_WATCH_TRUTH_92", "workshop_cabinet", "周澈因维修报酬争议擅自暂藏怀表") {
			if strings.Contains(body, hidden) {
				t.Fatalf("%s view leaked %s: %s", actor, hidden, body)
			}
		}
		if marker := ownMarker(actor); marker != "" && !strings.Contains(body, marker) {
			t.Fatalf("%s view missing %s: %s", actor, marker, body)
		}
	}
}

func TestStartStoryRunReloadsCurrentBranchAfterRewind(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-current-head")
	root := run.BranchID
	mustCommitStep(t, ctx, run, 0, story.Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"})
	mustCommitStep(t, ctx, run, 1, story.Command{ActionID: "a2", ActorID: "player", Action: "request_evidence", Target: "su"})
	rewound, err := testEnv.store.RewindStory(ctx, 1, StoryRewind{
		RunID: run.RunID, ToWorldVersion: 1, ChatIdentity: "w14-current-head",
	})
	if err != nil || rewound.BranchID == root || rewound.WorldVersion != 1 {
		t.Fatalf("rewind = %+v, %v", rewound, err)
	}
	branches := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_branch WHERE run_id=`+sqlID(run.RunID))
	again, err := testEnv.store.StartStoryRun(ctx, 1, run.ConversationID, "rainy-inn-v1")
	if err != nil || again.RunID != run.RunID || again.BranchID != rewound.BranchID || again.BranchID == root || again.WorldVersion != 1 {
		t.Fatalf("reload head = %+v, rewind %+v, root %d, err %v", again, rewound, root, err)
	}
	lin := mustActorFacts(t, ctx, again.RunID, again.BranchID, "lin", 1)
	zhou := mustActorFacts(t, ctx, again.RunID, again.BranchID, "zhou", 1)
	if !strings.Contains(string(mustJSON(t, lin.Events)), "loan_note") || strings.Contains(string(mustJSON(t, zhou.Events)), "loan_note") {
		t.Fatalf("current head view lin=%s zhou=%s", mustJSON(t, lin.Events), mustJSON(t, zhou.Events))
	}
	next, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: again.RunID, BranchID: again.BranchID, ExpectedWorldVersion: again.WorldVersion,
		ActionID: "on-head", ActorID: "player", Action: "request_evidence", Target: "su",
	})
	if err != nil || !next.Accepted || next.Replay || next.BranchID != again.BranchID || next.WorldVersion != 2 {
		t.Fatalf("head commit = %+v, %v", next, err)
	}
	_, err = testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: root, ExpectedWorldVersion: 1,
		ActionID: "late-root", ActorID: "player", Action: "request_evidence", Target: "su",
	})
	if !errors.Is(err, ErrStoryWorldVersion) {
		t.Fatalf("root commit after rewind = %v", err)
	}
	if got := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_branch WHERE run_id=`+sqlID(run.RunID)); got != branches {
		t.Fatalf("late root commit added a branch: %s, after rewind %s", got, branches)
	}
}

func TestStartStoryRunConflictsWhenConversationAlreadyHasAnotherCase(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	conversationID := mustStoryConversation(t, ctx, 1, "w12-story-conflict")
	if _, err := psqlSuper(`BEGIN;
		INSERT INTO vc.story_run(owner_user_id, id, case_id, world_version, stage, conversation_id)
		 VALUES (1, 9001, 'other-case', 0, 'investigation', ` + itoa(conversationID) + `);
		INSERT INTO vc.story_branch(owner_user_id, id, run_id)
		 VALUES (1, 9002, 9001);
		UPDATE vc.story_run SET current_branch_id = 9002
		 WHERE owner_user_id = 1 AND id = 9001;
		COMMIT;`); err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.StartStoryRun(ctx, 1, conversationID, "rainy-inn-v1"); !errors.Is(err, ErrConflict) {
		t.Fatalf("different case = %v", err)
	}
	var caseID string
	var n int
	if err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT count(*), min(case_id) FROM vc.story_run WHERE conversation_id=$1`, conversationID).Scan(&n, &caseID)
	}); err != nil || n != 1 || caseID != "other-case" {
		t.Fatalf("run overwritten n=%d case=%s err=%v", n, caseID, err)
	}
}

func mustStoryConversation(t *testing.T, ctx context.Context, owner int64, chat string) int64 {
	t.Helper()
	return mustConversation(t, ctx, owner, chat, "STORY")
}

func mustConversation(t *testing.T, ctx context.Context, owner int64, chat, mode string) int64 {
	t.Helper()
	binding, err := testEnv.store.ResolveSTBinding(ctx, owner, STBindingInput{ChatIdentity: chat, CharacterRef: "rainy-card", Mode: mode})
	if err != nil || binding.ConversationID <= 0 || binding.Mode != mode {
		t.Fatalf("binding %s = %+v, %v", mode, binding, err)
	}
	return binding.ConversationID
}

func appendStoryEvent(ctx context.Context, owner int64, run StoryRun, actor string, visibility []string, body string) error {
	return testEnv.store.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		return tx.QueryRow(ctx, `SELECT vc.append_story_event($1,$2,$3,$4,$5,$6,$7::jsonb)`,
			owner, run.RunID, run.BranchID, actor, visibility, run.WorldVersion, body).Scan(&id)
	})
}

func assertOneRun(t *testing.T, ctx context.Context, conversationID int64, run StoryRun) {
	t.Helper()
	var runs, branches, participants, linked, roots int
	err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM vc.story_run WHERE conversation_id=$1),
			(SELECT count(*) FROM vc.story_branch b JOIN vc.story_run r ON (r.owner_user_id, r.id) = (b.owner_user_id, b.run_id) WHERE r.conversation_id=$1),
			(SELECT count(*) FROM vc.story_participant p JOIN vc.story_run r ON (r.owner_user_id, r.id) = (p.owner_user_id, p.run_id) WHERE r.conversation_id=$1),
			(SELECT count(*) FROM vc.story_participant p JOIN vc.story_run r ON (r.owner_user_id, r.id) = (p.owner_user_id, p.run_id) WHERE r.conversation_id=$1 AND p.relationship_id IS NOT NULL),
			(SELECT count(*) FROM vc.story_branch b JOIN vc.story_run r ON (r.owner_user_id, r.id) = (b.owner_user_id, b.run_id) WHERE r.conversation_id=$1 AND b.parent_branch_id IS NULL)`,
			conversationID).Scan(&runs, &branches, &participants, &linked, &roots)
	})
	if err != nil || runs != 1 || branches != 1 || participants != 4 || linked != 0 || roots != 1 {
		t.Fatalf("shape runs=%d branches=%d participants=%d linked=%d roots=%d err=%v", runs, branches, participants, linked, roots, err)
	}
	if len(run.Participants) != 4 || run.CaseID != "rainy-inn-v1" || run.WorldVersion != 0 || run.Stage != "investigation" {
		t.Fatalf("run = %+v", run)
	}
	got := map[string]StoryParticipant{}
	for _, p := range run.Participants {
		got[p.ActorID] = p
		if p.RelationshipID != nil {
			t.Fatalf("relationship mapped: %+v", p)
		}
	}
	for _, id := range []string{"player", "lin", "zhou", "su"} {
		p, ok := got[id]
		if !ok || p.Scene != "lobby" || (id == "player" && p.Role != "player") || (id != "player" && p.Role != "npc") {
			t.Fatalf("participant %s = %+v", id, p)
		}
	}
	if got["lin"].Name != "林岚" || got["zhou"].Name != "周澈" || got["su"].Name != "苏禾" || got["player"].Name != "调查者" {
		t.Fatalf("names = %+v", got)
	}
	if strings.Contains(mustText(run), "GM_ONLY_WATCH_TRUTH_92") || strings.Contains(mustText(run), "PRIVATE_ZHOU_WATCH_44") {
		t.Fatalf("run leaked secrets: %+v", run)
	}
}

func hiddenEventMarkers(actor string) []string {
	all := []string{"PRIVATE_LIN_LOAN_31", "PRIVATE_ZHOU_WATCH_44", "PRIVATE_SU_WITNESS_57"}
	out := make([]string, 0, 2)
	for _, marker := range all {
		if marker != ownMarker(actor) {
			out = append(out, marker)
		}
	}
	return out
}

func ownMarker(actor string) string {
	switch actor {
	case "lin":
		return "PRIVATE_LIN_LOAN_31"
	case "zhou":
		return "PRIVATE_ZHOU_WATCH_44"
	case "su":
		return "PRIVATE_SU_WITNESS_57"
	default:
		return ""
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func mustText(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}
