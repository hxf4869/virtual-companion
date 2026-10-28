package story

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

const rainyInnID = "rainy-inn-v1"

func TestDeterministicSuccessPathIsTheSevenSteps(t *testing.T) {
	path := mustPath(t)
	want := []Command{
		{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"},
		{ActionID: "a2", ActorID: "player", Action: "request_evidence", Target: "su"},
		{ActionID: "a3", ActorID: "player", Action: "show_clue", Target: "zhou", ClueID: "loan_note"},
		{ActionID: "a4", ActorID: "player", Action: "show_clue", Target: "zhou", ClueID: "blue_sleeve"},
		{ActionID: "a5", ActorID: "player", Action: "request_key", Target: "zhou"},
		{ActionID: "a6", ActorID: "player", Action: "inspect", Target: "workshop_cabinet"},
		{ActionID: "a7", ActorID: "player", Action: "accuse", Target: "zhou"},
	}
	if !reflect.DeepEqual(path, want) {
		t.Fatalf("path = %+v", path)
	}
}

func TestInitialWorldIsInvestigation(t *testing.T) {
	state := mustInitial(t)
	if state.Version != 0 || state.Phase != "investigation" || state.Ended {
		t.Fatalf("state = %+v", state)
	}
	if state.KeyHolder != "zhou" || state.WatchLocation != "workshop_cabinet" {
		t.Fatalf("items = key %q watch %q", state.KeyHolder, state.WatchLocation)
	}
	if len(state.PlayerClues) != 0 || len(state.Events) != 0 {
		t.Fatalf("clues=%v events=%d", state.PlayerClues, len(state.Events))
	}
	for _, id := range []string{"lin", "zhou", "su"} {
		clues, ok := state.ActorRevealedClues[id]
		if !ok || len(clues) != 0 {
			t.Fatalf("revealed %s = %#v", id, state.ActorRevealedClues)
		}
	}
}

func TestEachRuleWritesItemsCluesAndAudience(t *testing.T) {
	path := mustPath(t)
	wants := []stepExpect{
		{version: 1, clues: []string{"loan_note"}, key: "zhou", watch: "workshop_cabinet", phase: "investigation", vis: []string{"player", "lin"}, rule: "evidence-lin", clue: "loan_note", clueName: "钥匙借用记录"},
		{version: 2, clues: []string{"loan_note", "blue_sleeve"}, key: "zhou", watch: "workshop_cabinet", phase: "investigation", vis: []string{"player", "su"}, rule: "evidence-su", clue: "blue_sleeve", clueName: "蓝色衣袖的目击", qualification: "只能证明有人穿蓝色衣物，不能单凭此认定身份。"},
		{version: 3, clues: []string{"loan_note", "blue_sleeve"}, key: "zhou", watch: "workshop_cabinet", phase: "investigation", revealed: map[string][]string{"zhou": {"loan_note"}}, vis: []string{"player", "zhou"}, rule: "show-owned", clue: "loan_note", clueName: "钥匙借用记录"},
		{version: 4, clues: []string{"loan_note", "blue_sleeve"}, key: "zhou", watch: "workshop_cabinet", phase: "investigation", revealed: map[string][]string{"zhou": {"loan_note", "blue_sleeve"}}, vis: []string{"player", "zhou"}, rule: "show-owned", clue: "blue_sleeve", clueName: "蓝色衣袖的目击", qualification: "只能证明有人穿蓝色衣物，不能单凭此认定身份。"},
		{version: 5, clues: []string{"loan_note", "blue_sleeve"}, key: "player", watch: "workshop_cabinet", phase: "investigation", revealed: map[string][]string{"zhou": {"loan_note", "blue_sleeve"}}, vis: []string{"player", "zhou"}, rule: "key-release"},
		{version: 6, clues: []string{"loan_note", "blue_sleeve", "watch_recovered"}, key: "player", watch: "player", phase: "investigation", revealed: map[string][]string{"zhou": {"loan_note", "blue_sleeve"}}, vis: []string{"player"}, rule: "cabinet-inspect", clue: "watch_recovered", clueName: "在维修柜找回怀表"},
		{version: 7, clues: []string{"loan_note", "blue_sleeve", "watch_recovered"}, key: "player", watch: "player", phase: "resolved", ended: true, revealed: map[string][]string{"zhou": {"loan_note", "blue_sleeve"}}, vis: []string{"player", "lin", "zhou", "su"}, rule: "resolve"},
	}
	if len(wants) != len(path) {
		t.Fatalf("expects %d, path %d", len(wants), len(path))
	}
	state := mustInitial(t)
	for i, cmd := range path {
		before := cloneForTest(state)
		d := mustAccept(t, state, cmd)
		assertStateEqual(t, state, before)
		if len(d.Events) != 1 || d.Events[0].ActionID != cmd.ActionID {
			t.Fatalf("new events = %+v", d.Events)
		}
		state = d.State
		want := wants[i]
		if state.Version != want.version || state.Phase != want.phase || state.Ended != want.ended {
			t.Fatalf("%s version/phase/ended = %d %s %v", cmd.ActionID, state.Version, state.Phase, state.Ended)
		}
		if state.KeyHolder != want.key || state.WatchLocation != want.watch {
			t.Fatalf("%s items = key %q watch %q", cmd.ActionID, state.KeyHolder, state.WatchLocation)
		}
		if !reflect.DeepEqual(state.PlayerClues, want.clues) {
			t.Fatalf("%s clues = %#v", cmd.ActionID, state.PlayerClues)
		}
		assertRevealed(t, state, want.revealed)
		if len(state.Events) != i+1 {
			t.Fatalf("%s events = %d", cmd.ActionID, len(state.Events))
		}
		ev := state.Events[i]
		if ev.ID != int64(i+1) || ev.ActorID != "player" || ev.WorldVersion != want.version || ev.ActionID != cmd.ActionID {
			t.Fatalf("%s event identity = %+v", cmd.ActionID, ev)
		}
		if !reflect.DeepEqual(ev.Visibility, want.vis) {
			t.Fatalf("%s visibility = %#v", cmd.ActionID, ev.Visibility)
		}
		assertActionBody(t, ev, cmd, want)
		assertEventAudience(t, state, cmd.ActionID, want.vis)
		assertNoSecretInEvents(t, state.Events)
		assertViewsSafe(t, state)
	}
}

func TestCabinetInspectWithoutKeyLeavesEveryFieldUnchanged(t *testing.T) {
	initial := mustInitial(t)
	assertRejected(t, initial, Command{ActionID: "no-key", ActorID: "player", Action: "inspect", Target: "workshop_cabinet"}, RejectPrecondition)

	shown := mustPlay(t, 4)
	assertRejected(t, shown, Command{ActionID: "still-no-key", ActorID: "player", Action: "inspect", Target: "workshop_cabinet"}, RejectPrecondition)

	withKey := mustPlay(t, 5)
	assertRejected(t, withKey, Command{ActionID: "wrong-place", ActorID: "player", Action: "inspect", Target: "lobby"}, RejectNoMatchingRule)
}

func TestRequestKeyBeforeShowingZhouLeavesEveryFieldUnchanged(t *testing.T) {
	assertRejected(t, mustInitial(t), Command{ActionID: "key-early", ActorID: "player", Action: "request_key", Target: "zhou"}, RejectPrecondition)

	held := mustPlay(t, 2)
	assertRejected(t, held, Command{ActionID: "key-unshown", ActorID: "player", Action: "request_key", Target: "zhou"}, RejectPrecondition)

	oneShown := mustPlay(t, 3)
	assertRejected(t, oneShown, Command{ActionID: "key-one-clue", ActorID: "player", Action: "request_key", Target: "zhou"}, RejectPrecondition)

	// Both clues exist, but they were shown to 苏禾. 周澈 still does not know them.
	shownToSu := held
	shownToSu = mustAccept(t, shownToSu, Command{ActionID: "show-su-loan", ActorID: "player", Action: "show_clue", Target: "su", ClueID: "loan_note"}).State
	shownToSu = mustAccept(t, shownToSu, Command{ActionID: "show-su-sleeve", ActorID: "player", Action: "show_clue", Target: "su", ClueID: "blue_sleeve"}).State
	if !reflect.DeepEqual(shownToSu.ActorRevealedClues["su"], []string{"loan_note", "blue_sleeve"}) {
		t.Fatalf("su revealed = %#v", shownToSu.ActorRevealedClues["su"])
	}
	if len(shownToSu.ActorRevealedClues["zhou"]) != 0 || shownToSu.KeyHolder != "zhou" {
		t.Fatalf("zhou learned or lost the key: %+v", shownToSu.ActorRevealedClues)
	}
	assertRejected(t, shownToSu, Command{ActionID: "key-wrong-audience", ActorID: "player", Action: "request_key", Target: "zhou"}, RejectPrecondition)
}

func TestShowClueIsVisibleOnlyToPlayerAndTarget(t *testing.T) {
	state := mustPlay(t, 2)
	before := cloneForTest(state)
	d := mustAccept(t, state, Command{ActionID: "a3", ActorID: "player", Action: "show_clue", Target: "zhou", ClueID: "loan_note"})
	assertStateEqual(t, state, before)
	state = d.State
	if state.Version != before.Version+1 {
		t.Fatalf("version = %d", state.Version)
	}
	if !reflect.DeepEqual(state.PlayerClues, before.PlayerClues) || state.KeyHolder != before.KeyHolder || state.WatchLocation != before.WatchLocation || state.Phase != before.Phase || state.Ended != before.Ended {
		t.Fatalf("show_clue changed items or truth: %+v", state)
	}
	if !reflect.DeepEqual(state.ActorRevealedClues["zhou"], []string{"loan_note"}) {
		t.Fatalf("zhou revealed = %#v", state.ActorRevealedClues["zhou"])
	}
	if len(state.ActorRevealedClues["lin"]) != 0 || len(state.ActorRevealedClues["su"]) != 0 {
		t.Fatalf("other revealed = %#v", state.ActorRevealedClues)
	}
	ev := d.Events[0]
	if !reflect.DeepEqual(ev.Visibility, []string{"player", "zhou"}) {
		t.Fatalf("visibility = %#v", ev.Visibility)
	}
	assertEventAudience(t, state, "a3", []string{"player", "zhou"})
	for _, actor := range []string{"lin", "su"} {
		view := viewFor(t, actor, state)
		raw, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(raw), "show_clue") || strings.Contains(string(raw), `"actionId":"a3"`) {
			t.Fatalf("%s saw the shown clue: %s", actor, raw)
		}
	}
	assertViewsSafe(t, state)
}

func TestReplayActionIDDoesNotAdvanceVersionOrDuplicateClues(t *testing.T) {
	once := mustAccept(t, mustInitial(t), Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"})
	before := cloneForTest(once.State)
	again, err := Apply(rainyInnID, once.State, Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "su", ClueID: "blue_sleeve"})
	if err != nil {
		t.Fatal(err)
	}
	if !again.Accepted || !again.Replay || again.Reason != "" || len(again.Events) != 0 {
		t.Fatalf("replay decision = %+v", again)
	}
	assertStateEqual(t, again.State, before)
	assertStateEqual(t, once.State, before)
	if len(again.State.PlayerClues) != 1 || again.State.PlayerClues[0] != "loan_note" || again.State.Version != 1 || len(again.State.Events) != 1 {
		t.Fatalf("replay changed clues or version: %+v", again.State)
	}

	ghost, err := Apply(rainyInnID, once.State, Command{ActionID: "a1", ActorID: "ghost", Action: "accuse", Target: "zhou"})
	if err != nil {
		t.Fatal(err)
	}
	if !ghost.Accepted || !ghost.Replay || len(ghost.Events) != 0 {
		t.Fatalf("committed id must replay, got %+v", ghost)
	}
	assertStateEqual(t, ghost.State, before)

	final := mustPlay(t, 7)
	replayed := applyAll(t, final, mustPath(t))
	assertStateEqual(t, replayed, final)
	if replayed.Version != 7 || len(replayed.PlayerClues) != 3 || len(replayed.Events) != 7 {
		t.Fatalf("full replay = version %d clues %v events %d", replayed.Version, replayed.PlayerClues, len(replayed.Events))
	}
}

func TestStatementDoesNotChangeItemsOrTruth(t *testing.T) {
	state := mustInitial(t)
	lie := Command{ActionID: "lie-1", ActorID: "zhou", Target: "player", Text: "我整晚都在自己的房间里。"}
	d := mustAccept(t, state, lie)
	if d.State.Version != state.Version || d.State.KeyHolder != state.KeyHolder || d.State.WatchLocation != state.WatchLocation || d.State.Phase != state.Phase || d.State.Ended != state.Ended {
		t.Fatalf("statement changed truth: %+v", d.State)
	}
	if !reflect.DeepEqual(d.State.PlayerClues, state.PlayerClues) || !reflect.DeepEqual(d.State.ActorRevealedClues, state.ActorRevealedClues) {
		t.Fatalf("statement changed clues: %+v", d.State)
	}
	if len(d.Events) != 1 || d.Events[0].WorldVersion != 0 || d.State.Events[0].ActionID != "lie-1" {
		t.Fatalf("statement event = %+v", d.Events)
	}
	if !reflect.DeepEqual(d.Events[0].Visibility, []string{"zhou", "player"}) {
		t.Fatalf("lie visibility = %#v", d.Events[0].Visibility)
	}

	// A line that is not submitted does not exist. Replaying the submitted line does not duplicate it.
	skipped := "我把怀表藏起来了。"
	if strings.Contains(string(d.Events[0].Body), skipped) {
		t.Fatal("unsubmitted line was stored")
	}
	replay, err := Apply(rainyInnID, d.State, Command{ActionID: "lie-1", ActorID: "zhou", Target: "player", Text: skipped})
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replay || len(replay.State.Events) != 1 || strings.Contains(string(replay.State.Events[0].Body), skipped) {
		t.Fatalf("statement replay = %+v body %s", replay, replay.State.Events[0].Body)
	}
	if replay.State.WatchLocation != "workshop_cabinet" || replay.State.Ended {
		t.Fatalf("replay changed truth: %+v", replay.State)
	}

	// Dialogue between world actions does not consume a version or change the ending.
	mid := mustAccept(t, mustPlay(t, 1), Command{ActionID: "talk-1", ActorID: "player", Target: "lin", Text: "昨晚你一直在厨房吗？"})
	if mid.State.Version != 1 || len(mid.State.Events) != 2 || mid.State.Events[1].WorldVersion != 1 {
		t.Fatalf("mid dialogue = version %d events %+v", mid.State.Version, mid.State.Events)
	}
	rest := applyAll(t, mid.State, mustPath(t)[1:])
	plain := mustPlay(t, 7)
	if rest.Version != plain.Version || rest.Phase != plain.Phase || rest.Ended != plain.Ended || rest.KeyHolder != plain.KeyHolder || rest.WatchLocation != plain.WatchLocation {
		t.Fatalf("dialogue shifted the ending: got %+v want version %d", rest, plain.Version)
	}
	if !reflect.DeepEqual(rest.PlayerClues, plain.PlayerClues) || !reflect.DeepEqual(rest.ActorRevealedClues, plain.ActorRevealedClues) {
		t.Fatalf("dialogue shifted clues: %#v", rest.PlayerClues)
	}
	if len(rest.Events) != len(plain.Events)+1 {
		t.Fatalf("events = %d, want %d", len(rest.Events), len(plain.Events)+1)
	}
}

func TestStatementVisibilityFeedsOnlyThePair(t *testing.T) {
	text := "昨晚你一直在厨房吗？"
	d := mustAccept(t, mustInitial(t), Command{ActionID: "talk-lin", ActorID: "player", Target: "lin", Text: text})
	ev := d.Events[0]
	if !reflect.DeepEqual(ev.Visibility, []string{"player", "lin"}) {
		t.Fatalf("visibility = %#v", ev.Visibility)
	}
	var body struct {
		Kind     string `json:"kind"`
		ActionID string `json:"actionId"`
		ActorID  string `json:"actorId"`
		Target   string `json:"target"`
		Text     string `json:"text"`
	}
	if err := json.Unmarshal(ev.Body, &body); err != nil {
		t.Fatal(err)
	}
	if body.Kind != "statement" || body.ActionID != "talk-lin" || body.ActorID != "player" || body.Target != "lin" || body.Text != text {
		t.Fatalf("body = %+v", body)
	}
	assertEventAudience(t, d.State, "talk-lin", []string{"player", "lin"})
	for _, actor := range []string{"player", "lin"} {
		raw := marshalView(t, actor, d.State)
		if !strings.Contains(raw, text) {
			t.Fatalf("%s view missing dialogue: %s", actor, raw)
		}
	}
	for _, actor := range []string{"zhou", "su"} {
		raw := marshalView(t, actor, d.State)
		if strings.Contains(raw, text) || strings.Contains(raw, "talk-lin") {
			t.Fatalf("%s saw the private exchange: %s", actor, raw)
		}
	}
	assertViewsSafe(t, d.State)
	assertNoSecretInEvents(t, d.State.Events)
}

func TestAskRecordsDialogueWithoutChangingWorld(t *testing.T) {
	state := mustInitial(t)
	d := mustAccept(t, state, Command{ActionID: "ask-1", ActorID: "player", Action: "ask", Target: "lin", Text: "门锁是什么时候关的？"})
	if d.State.Version != 0 || d.State.KeyHolder != "zhou" || d.State.WatchLocation != state.WatchLocation || len(d.State.PlayerClues) != 0 || d.State.Ended || d.State.Phase != "investigation" {
		t.Fatalf("ask changed the world: %+v", d.State)
	}
	if !reflect.DeepEqual(d.Events[0].Visibility, []string{"player", "lin"}) {
		t.Fatalf("ask visibility = %#v", d.Events[0].Visibility)
	}
	raw := marshalView(t, "lin", d.State)
	if !strings.Contains(raw, "门锁是什么时候关的？") {
		t.Fatalf("lin view missing the question: %s", raw)
	}
	if strings.Contains(marshalView(t, "zhou", d.State), "门锁是什么时候关的？") {
		t.Fatal("zhou saw the question to lin")
	}
	assertRejected(t, state, Command{ActionID: "ask-room", ActorID: "player", Action: "ask", Target: "workshop_cabinet"}, RejectUnknownActor)
	assertViewsSafe(t, d.State)
}

func TestLegalSevenStepsReachResolved(t *testing.T) {
	final := mustPlay(t, 7)
	if !final.Ended || final.Phase != "resolved" || final.Version != 7 {
		t.Fatalf("final = version %d phase %s ended %v", final.Version, final.Phase, final.Ended)
	}
	if final.KeyHolder != "player" || final.WatchLocation != "player" {
		t.Fatalf("items = key %q watch %q", final.KeyHolder, final.WatchLocation)
	}
	if !reflect.DeepEqual(final.PlayerClues, []string{"loan_note", "blue_sleeve", "watch_recovered"}) {
		t.Fatalf("clues = %#v", final.PlayerClues)
	}
	if !reflect.DeepEqual(final.ActorRevealedClues["zhou"], []string{"loan_note", "blue_sleeve"}) {
		t.Fatalf("zhou revealed = %#v", final.ActorRevealedClues["zhou"])
	}
	assertRejected(t, final, Command{ActionID: "after-end", ActorID: "player", Action: "accuse", Target: "zhou"}, RejectPrecondition)
	spoken := mustAccept(t, final, Command{ActionID: "after-end-line", ActorID: "player", Target: "lin", Text: "今天就到这里。"})
	if spoken.State.Version != final.Version || !spoken.State.Ended || spoken.State.Phase != "resolved" || spoken.State.KeyHolder != final.KeyHolder {
		t.Fatalf("epilogue line changed the ending: %+v", spoken.State)
	}
}

func TestAccuseZhouEndsOnlyWhenThreeCluesAreHeld(t *testing.T) {
	assertRejected(t, mustInitial(t), Command{ActionID: "accuse-early", ActorID: "player", Action: "accuse", Target: "zhou"}, RejectPrecondition)
	assertRejected(t, mustPlay(t, 5), Command{ActionID: "accuse-no-watch", ActorID: "player", Action: "accuse", Target: "zhou"}, RejectPrecondition)
	assertRejected(t, mustPlay(t, 6), Command{ActionID: "accuse-lin", ActorID: "player", Action: "accuse", Target: "lin"}, RejectNoMatchingRule)

	ready := mustInitial(t)
	ready.PlayerClues = []string{"watch_recovered", "blue_sleeve", "loan_note"}
	d := mustAccept(t, ready, Command{ActionID: "accuse-ready", ActorID: "player", Action: "accuse", Target: "zhou"})
	if !d.State.Ended || d.State.Phase != "resolved" || d.State.Version != 1 {
		t.Fatalf("accuse = version %d phase %s ended %v", d.State.Version, d.State.Phase, d.State.Ended)
	}
	if !reflect.DeepEqual(d.Events[0].Visibility, []string{"player", "lin", "zhou", "su"}) {
		t.Fatalf("ending visibility = %#v", d.Events[0].Visibility)
	}
	if !reflect.DeepEqual(d.State.PlayerClues, ready.PlayerClues) || d.State.KeyHolder != ready.KeyHolder || d.State.WatchLocation != ready.WatchLocation {
		t.Fatalf("accuse changed items: %+v", d.State)
	}
	assertEventAudience(t, d.State, "accuse-ready", []string{"player", "lin", "zhou", "su"})

	held := cloneForTest(ready)
	npc, err := Apply(rainyInnID, held, Command{ActionID: "npc-ends", ActorID: "zhou", Action: "accuse", Target: "zhou"})
	if err != nil {
		t.Fatal(err)
	}
	if npc.Accepted || npc.State.Ended || npc.State.Phase != "investigation" {
		t.Fatalf("npc accuse = %+v", npc)
	}
	assertStateEqual(t, held, ready)
	assertStateEqual(t, npc.State, ready)

	missing := cloneForTest(ready)
	missing.PlayerClues = []string{"loan_note", "blue_sleeve"}
	assertRejected(t, missing, Command{ActionID: "accuse-short", ActorID: "player", Action: "accuse", Target: "zhou"}, RejectPrecondition)
}

func TestSuccessPathFromAnyIntermediateStateMatches(t *testing.T) {
	path := mustPath(t)
	start := mustInitial(t)
	final := applyAll(t, start, path)
	for k := 0; k <= len(path); k++ {
		mid := applyAll(t, start, path[:k])
		fromSuffix := applyAll(t, mid, path[k:])
		assertStateEqual(t, fromSuffix, final)
		fromReplay := applyAll(t, mid, path)
		assertStateEqual(t, fromReplay, final)
	}
}

func TestRejectedCommandLeavesInputAndResultUnchanged(t *testing.T) {
	initial := mustInitial(t)
	cases := []struct {
		name   string
		cmd    Command
		reason string
	}{
		{name: "inspect without key", cmd: Command{ActionID: "r-inspect", ActorID: "player", Action: "inspect", Target: "workshop_cabinet"}, reason: RejectPrecondition},
		{name: "key before clues", cmd: Command{ActionID: "r-key", ActorID: "player", Action: "request_key", Target: "zhou"}, reason: RejectPrecondition},
		{name: "show unowned clue", cmd: Command{ActionID: "r-show", ActorID: "player", Action: "show_clue", Target: "zhou", ClueID: "loan_note"}, reason: RejectPrecondition},
		{name: "accuse too early", cmd: Command{ActionID: "r-accuse", ActorID: "player", Action: "accuse", Target: "zhou"}, reason: RejectPrecondition},
		{name: "accuse another npc", cmd: Command{ActionID: "r-accuse-lin", ActorID: "player", Action: "accuse", Target: "lin"}, reason: RejectNoMatchingRule},
		{name: "action not allowed", cmd: Command{ActionID: "r-take", ActorID: "player", Action: "take_watch", Target: "zhou"}, reason: RejectActionNotAllowed},
		{name: "unknown actor", cmd: Command{ActionID: "r-ghost", ActorID: "ghost", Action: "ask", Target: "lin", Text: "在吗"}, reason: RejectUnknownActor},
		{name: "missing action id", cmd: Command{ActionID: "", ActorID: "player", Action: "ask", Target: "lin", Text: "在吗"}, reason: RejectBadCommand},
		{name: "statement to nobody", cmd: Command{ActionID: "r-solo", ActorID: "player", Text: "自言自语"}, reason: RejectBadCommand},
		{name: "statement to unknown", cmd: Command{ActionID: "r-who", ActorID: "player", Target: "ghost", Text: "你好"}, reason: RejectUnknownActor},
		{name: "npc inspect", cmd: Command{ActionID: "r-npc", ActorID: "zhou", Action: "inspect", Target: "workshop_cabinet"}, reason: RejectBadCommand},
		{name: "empty statement", cmd: Command{ActionID: "r-empty", ActorID: "player", Target: "lin", Text: "  "}, reason: RejectBadCommand},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assertRejected(t, initial, tc.cmd, tc.reason)
		})
	}

	shown := mustPlay(t, 4)
	assertRejected(t, shown, Command{ActionID: "r-cabinet", ActorID: "player", Action: "inspect", Target: "workshop_cabinet"}, RejectPrecondition)
	assertRejected(t, shown, Command{ActionID: "r-key-late", ActorID: "player", Action: "request_key", Target: "lin"}, RejectNoMatchingRule)
}

func TestApplyDoesNotAliasInput(t *testing.T) {
	state := mustPlay(t, 2)
	before := cloneForTest(state)
	d := mustAccept(t, state, Command{ActionID: "a3", ActorID: "player", Action: "show_clue", Target: "zhou", ClueID: "loan_note"})
	assertStateEqual(t, state, before)
	d.State.ActorRevealedClues["tamper"] = []string{"x"}
	d.State.Events[0].Body[0] = 'X'
	d.State.Events[0].Visibility[0] = "tamper"
	d.State.PlayerClues[0] = "tamper"
	assertStateEqual(t, state, before)
	if _, ok := before.ActorRevealedClues["tamper"]; ok {
		t.Fatal("snapshot aliased the result map")
	}
}

type stepExpect struct {
	version       int64
	clues         []string
	key           string
	watch         string
	phase         string
	ended         bool
	revealed      map[string][]string
	vis           []string
	rule          string
	clue          string
	clueName      string
	qualification string
}

func mustInitial(t *testing.T) State {
	t.Helper()
	state, err := InitialState(rainyInnID)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func mustPath(t *testing.T) []Command {
	t.Helper()
	path, err := DeterministicSuccessPath(rainyInnID)
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func mustPlay(t *testing.T, n int) State {
	t.Helper()
	return applyAll(t, mustInitial(t), mustPath(t)[:n])
}

func mustAccept(t *testing.T, state State, cmd Command) Decision {
	t.Helper()
	d, err := Apply(rainyInnID, state, cmd)
	if err != nil {
		t.Fatal(err)
	}
	if !d.Accepted || d.Replay || d.Reason != "" {
		t.Fatalf("command %+v rejected: %+v", cmd, d)
	}
	return d
}

func applyAll(t *testing.T, state State, cmds []Command) State {
	t.Helper()
	for _, cmd := range cmds {
		d, err := Apply(rainyInnID, state, cmd)
		if err != nil {
			t.Fatal(err)
		}
		if !d.Accepted {
			t.Fatalf("command %+v rejected: %s", cmd, d.Reason)
		}
		state = d.State
	}
	return state
}

func assertRejected(t *testing.T, state State, cmd Command, reason string) {
	t.Helper()
	before := cloneForTest(state)
	d, err := Apply(rainyInnID, state, cmd)
	if err != nil {
		t.Fatal(err)
	}
	if d.Accepted || d.Replay || d.Reason != reason || len(d.Events) != 0 {
		t.Fatalf("command %+v decision accepted=%v replay=%v reason=%q events=%d", cmd, d.Accepted, d.Replay, d.Reason, len(d.Events))
	}
	assertStateEqual(t, state, before)
	assertStateEqual(t, d.State, before)
	if d.State.ActorRevealedClues != nil {
		d.State.ActorRevealedClues["tamper-key"] = []string{"x"}
		if _, ok := state.ActorRevealedClues["tamper-key"]; ok {
			t.Fatal("rejection aliases revealed clues")
		}
	}
}

func assertStateEqual(t *testing.T, got, want State) {
	t.Helper()
	if got.Version != want.Version {
		t.Fatalf("version = %d, want %d", got.Version, want.Version)
	}
	if got.Phase != want.Phase {
		t.Fatalf("phase = %q, want %q", got.Phase, want.Phase)
	}
	if got.KeyHolder != want.KeyHolder {
		t.Fatalf("keyHolder = %q, want %q", got.KeyHolder, want.KeyHolder)
	}
	if got.WatchLocation != want.WatchLocation {
		t.Fatalf("watchLocation = %q, want %q", got.WatchLocation, want.WatchLocation)
	}
	if got.Ended != want.Ended {
		t.Fatalf("ended = %v, want %v", got.Ended, want.Ended)
	}
	if !reflect.DeepEqual(got.PlayerClues, want.PlayerClues) {
		t.Fatalf("playerClues = %#v, want %#v", got.PlayerClues, want.PlayerClues)
	}
	if !reflect.DeepEqual(got.ActorRevealedClues, want.ActorRevealedClues) {
		t.Fatalf("revealed = %#v, want %#v", got.ActorRevealedClues, want.ActorRevealedClues)
	}
	if len(got.Events) != len(want.Events) {
		t.Fatalf("events = %d, want %d", len(got.Events), len(want.Events))
	}
	for i := range want.Events {
		assertEventEqual(t, got.Events[i], want.Events[i])
	}
}

func assertEventEqual(t *testing.T, got, want Event) {
	t.Helper()
	if got.ID != want.ID || got.ActionID != want.ActionID || got.ActorID != want.ActorID || got.WorldVersion != want.WorldVersion {
		t.Fatalf("event = %+v, want %+v", got, want)
	}
	if !reflect.DeepEqual(got.Visibility, want.Visibility) {
		t.Fatalf("visibility = %#v, want %#v", got.Visibility, want.Visibility)
	}
	if !bytes.Equal(bytes.TrimSpace(got.Body), bytes.TrimSpace(want.Body)) {
		t.Fatalf("body = %s, want %s", got.Body, want.Body)
	}
}

func assertRevealed(t *testing.T, state State, extra map[string][]string) {
	t.Helper()
	for _, id := range []string{"lin", "zhou", "su"} {
		got := state.ActorRevealedClues[id]
		want := extra[id]
		if len(want) == 0 {
			if len(got) != 0 {
				t.Fatalf("revealed %s = %#v", id, got)
			}
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("revealed %s = %#v, want %#v", id, got, want)
		}
	}
}

func assertActionBody(t *testing.T, ev Event, cmd Command, want stepExpect) {
	t.Helper()
	var body struct {
		Kind          string `json:"kind"`
		ActionID      string `json:"actionId"`
		Action        string `json:"action"`
		ActorID       string `json:"actorId"`
		RuleID        string `json:"ruleId"`
		Target        string `json:"target"`
		ClueID        string `json:"clueId"`
		ClueName      string `json:"clueName"`
		Qualification string `json:"qualification"`
		Phase         string `json:"phase"`
		Ended         *bool  `json:"ended"`
	}
	if err := json.Unmarshal(ev.Body, &body); err != nil {
		t.Fatal(err)
	}
	if body.Kind != "action" || body.ActionID != cmd.ActionID || body.Action != cmd.Action || body.ActorID != "player" || body.RuleID != want.rule {
		t.Fatalf("body = %+v", body)
	}
	actors := map[string]bool{"player": true, "lin": true, "zhou": true, "su": true}
	if actors[cmd.Target] {
		if body.Target != cmd.Target {
			t.Fatalf("target = %q, want %q", body.Target, cmd.Target)
		}
	} else if body.Target != "" || strings.Contains(string(ev.Body), cmd.Target) {
		t.Fatalf("location target leaked into body %s", ev.Body)
	}
	if body.ClueID != want.clue || body.ClueName != want.clueName || body.Qualification != want.qualification {
		t.Fatalf("clue body = %+v", body)
	}
	if want.ended {
		if body.Phase != "resolved" || body.Ended == nil || !*body.Ended {
			t.Fatalf("ending body = %+v", body)
		}
	} else if body.Phase != "" || body.Ended != nil {
		t.Fatalf("unexpected ending body = %+v", body)
	}
}

func assertEventAudience(t *testing.T, state State, actionID string, audience []string) {
	t.Helper()
	want := map[string]bool{}
	for _, id := range audience {
		want[id] = true
	}
	for _, actor := range []string{"player", "lin", "zhou", "su"} {
		seen := viewHasAction(t, viewFor(t, actor, state), actionID)
		if seen != want[actor] {
			t.Fatalf("actor %s sees %s = %v, want %v", actor, actionID, seen, want[actor])
		}
	}
}

func viewHasAction(t *testing.T, view View, actionID string) bool {
	t.Helper()
	for _, ev := range view.Events {
		var body struct {
			ActionID string `json:"actionId"`
		}
		if err := json.Unmarshal(ev.Body, &body); err != nil {
			t.Fatal(err)
		}
		if body.ActionID == actionID {
			return true
		}
	}
	return false
}

func viewFor(t *testing.T, actor string, state State) View {
	t.Helper()
	view, err := ActorView(rainyInnID, Scope{
		ConversationID: 1, RunID: 1, BranchID: 1, ActorID: actor, WorldVersion: state.Version,
	}, state.Events)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func marshalView(t *testing.T, actor string, state State) string {
	t.Helper()
	raw, err := json.Marshal(viewFor(t, actor, state))
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func assertViewsSafe(t *testing.T, state State) {
	t.Helper()
	for _, actor := range []string{"player", "lin", "zhou", "su"} {
		raw := marshalView(t, actor, state)
		if strings.Contains(raw, "workshop_cabinet") || strings.Contains(raw, "GM_ONLY_WATCH_TRUTH_92") || strings.Contains(raw, "grant_player_clue") {
			t.Fatalf("%s view leaked a secret marker: %s", actor, raw)
		}
		if err := CheckOutbound(rainyInnID, actor, []string{raw}, false); err != nil {
			t.Fatalf("%s view rejected by outbound check: %v", actor, err)
		}
	}
}

func assertNoSecretInEvents(t *testing.T, events []Event) {
	t.Helper()
	for _, ev := range events {
		body := string(ev.Body)
		for _, secret := range outboundOracleSecrets(t) {
			if secret != "" && strings.Contains(body, secret) {
				t.Fatalf("event %s contains %q: %s", ev.ActionID, secret, body)
			}
		}
	}
}

func cloneForTest(s State) State {
	out := s
	if s.PlayerClues == nil {
		out.PlayerClues = nil
	} else {
		out.PlayerClues = append([]string(nil), s.PlayerClues...)
	}
	if s.ActorRevealedClues == nil {
		out.ActorRevealedClues = nil
	} else {
		out.ActorRevealedClues = make(map[string][]string, len(s.ActorRevealedClues))
		for k, v := range s.ActorRevealedClues {
			if v == nil {
				out.ActorRevealedClues[k] = nil
				continue
			}
			out.ActorRevealedClues[k] = append([]string(nil), v...)
		}
	}
	if s.Events == nil {
		out.Events = nil
		return out
	}
	out.Events = make([]Event, len(s.Events))
	for i, ev := range s.Events {
		out.Events[i] = ev
		if ev.Visibility != nil {
			out.Events[i].Visibility = append([]string(nil), ev.Visibility...)
		}
		if ev.Body != nil {
			out.Events[i].Body = append(json.RawMessage(nil), ev.Body...)
		}
	}
	return out
}
