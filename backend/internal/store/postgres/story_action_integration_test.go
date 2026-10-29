//go:build integration

package postgres

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/jackc/pgx/v5"
)

func TestStoryCommitIdempotencyAndVersionConflict(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-commit")

	rejected, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 0,
		ActionID: "no-key", ActorID: "player", Action: "inspect", Target: "workshop_cabinet",
	})
	if err != nil || rejected.Accepted || rejected.Reason != story.RejectPrecondition || rejected.EventID != 0 || rejected.WorldVersion != 0 {
		t.Fatalf("reject = %+v, %v", rejected, err)
	}
	if got := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_event WHERE run_id=`+sqlID(run.RunID)); got != "0" {
		t.Fatalf("rejection wrote events: %s", got)
	}

	first := mustCommitStep(t, ctx, run, 0, story.Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"})
	if first.Replay || first.WorldVersion != 1 || first.EventID <= 0 || first.Stage != "investigation" || first.Ended {
		t.Fatalf("first = %+v", first)
	}
	again, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 0,
		ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin",
	})
	if err != nil || !again.Accepted || !again.Replay || again.EventID != first.EventID || again.WorldVersion != first.WorldVersion {
		t.Fatalf("replay = %+v, %v", again, err)
	}
	current, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: first.WorldVersion,
		ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin",
	})
	if err != nil || !current.Replay || current.EventID != first.EventID {
		t.Fatalf("current replay = %+v, %v", current, err)
	}
	if got := storySQL(t, run.RunID, `SELECT world_version::text || ' ' || (world_state->'clues')::text || ' ' || (SELECT count(*) FROM vc.story_event e WHERE e.run_id=r.id AND e.action_id='a1') FROM vc.story_run r WHERE id=`+sqlID(run.RunID)); got != "1 [\"loan_note\"] 1" {
		t.Fatalf("idempotent state = %s", got)
	}

	_, err = testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 0,
		ActionID: "a2", ActorID: "player", Action: "request_evidence", Target: "su",
	})
	if !errors.Is(err, ErrStoryWorldVersion) {
		t.Fatalf("stale version = %v", err)
	}
	if got := storySQL(t, run.RunID, `SELECT world_version::text || ' ' || (world_state->'clues')::text || ' ' || (SELECT count(*) FROM vc.story_event e WHERE e.run_id=r.id) || ' ' || (SELECT count(*) FROM vc.story_branch b WHERE b.run_id=r.id) FROM vc.story_run r WHERE id=`+sqlID(run.RunID)); got != "1 [\"loan_note\"] 1 1" {
		t.Fatalf("conflict changed state: %s", got)
	}
	if _, err := testEnv.store.CommitStoryCommand(ctx, 2, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 1,
		ActionID: "a2", ActorID: "player", Action: "request_evidence", Target: "su",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign commit = %v", err)
	}
}

func TestStoryProjectionCommitsWithEvent(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-projection")
	var eventID int64
	sentinel := errors.New("rollback projection")
	err := testEnv.store.WithOwner(ctx, 1, func(ctx context.Context, tx pgx.Tx) error {
		res, err := commitStoryCommandTx(ctx, tx, 1, StoryCommit{
			RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 0,
			ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin",
		})
		if err != nil {
			return err
		}
		if !res.Accepted || res.EventID <= 0 {
			return errors.New("rollback setup missed the event")
		}
		eventID = res.EventID
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	if got := storySQL(t, run.RunID, `SELECT (SELECT count(*) FROM vc.story_event WHERE run_id=`+sqlID(run.RunID)+`)::text || ' ' || (SELECT count(*) FROM vc.work_item WHERE kind='STORY_PROJECTION' AND ref_id=`+sqlID(eventID)+`)::text`); got != "0 0" {
		t.Fatalf("rolled back commit left rows: %s", got)
	}

	first := mustCommitStep(t, ctx, run, 0, story.Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"})
	if got := storySQL(t, run.RunID, `SELECT e.projection_state || ' ' || w.status || ' ' || w.kind FROM vc.story_event e JOIN vc.work_item w ON w.owner_user_id=e.owner_user_id AND w.ref_id=e.id AND w.kind='STORY_PROJECTION' WHERE e.id=`+sqlID(first.EventID)); got != "PENDING PENDING STORY_PROJECTION" {
		t.Fatalf("projection pair = %s", got)
	}
	ok, err := testEnv.store.ConfirmStoryProjection(ctx, 1, run.RunID, first.EventID)
	if err != nil || !ok {
		t.Fatalf("confirm = %v, %v", ok, err)
	}
	if got := storySQL(t, run.RunID, `SELECT e.projection_state || ' ' || w.status FROM vc.story_event e JOIN vc.work_item w ON w.owner_user_id=e.owner_user_id AND w.ref_id=e.id AND w.kind='STORY_PROJECTION' WHERE e.id=`+sqlID(first.EventID)); got != "CONFIRMED DONE" {
		t.Fatalf("confirmed projection = %s", got)
	}
	if _, err := testEnv.store.ConfirmStoryProjection(ctx, 2, run.RunID, first.EventID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign confirm = %v", err)
	}
}

func TestStoryRewindRejectsLateCommitWithoutNewBranch(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-rewind")
	mustCommitStep(t, ctx, run, 0, story.Command{ActionID: "a1", ActorID: "player", Action: "request_evidence", Target: "lin"})
	mustCommitStep(t, ctx, run, 1, story.Command{ActionID: "a2", ActorID: "player", Action: "request_evidence", Target: "su"})
	before := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_branch WHERE run_id=`+sqlID(run.RunID))

	rewound, err := testEnv.store.RewindStory(ctx, 1, StoryRewind{
		RunID: run.RunID, ToWorldVersion: 1, ChatIdentity: "w14-rewind-chat",
	})
	if err != nil || rewound.BranchID == run.BranchID || rewound.WorldVersion != 1 || rewound.Stage != "investigation" {
		t.Fatalf("rewind = %+v, %v", rewound, err)
	}
	if got := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_branch WHERE run_id=`+sqlID(run.RunID)); got != incrementDecimal(t, before) {
		t.Fatalf("rewind branches = %s, before %s", got, before)
	}

	_, err = testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: 1,
		ActionID: "late", ActorID: "player", Action: "request_evidence", Target: "su",
	})
	if !errors.Is(err, ErrStoryWorldVersion) {
		t.Fatalf("late commit = %v", err)
	}
	if got := storySQL(t, run.RunID, `SELECT (SELECT count(*) FROM vc.story_branch b WHERE b.run_id=r.id)::text || ' ' || r.world_version::text || ' ' || (r.world_state->'clues')::text FROM vc.story_run r WHERE r.id=`+sqlID(run.RunID)); got != incrementDecimal(t, before)+" 1 [\"loan_note\"]" {
		t.Fatalf("late commit changed the fork: %s", got)
	}

	next, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: rewound.BranchID, ExpectedWorldVersion: 1,
		ActionID: "late", ActorID: "player", Action: "request_evidence", Target: "su",
	})
	if err != nil || !next.Accepted || next.Replay || next.WorldVersion != 2 || next.BranchID != rewound.BranchID {
		t.Fatalf("current head commit = %+v, %v", next, err)
	}
	if got := storySQL(t, run.RunID, `SELECT count(*) FROM vc.story_branch WHERE run_id=`+sqlID(run.RunID)); got != incrementDecimal(t, before) {
		t.Fatalf("timely commit added a branch: %s", got)
	}
	lin := mustActorFacts(t, ctx, run.RunID, rewound.BranchID, "lin", 2)
	zhou := mustActorFacts(t, ctx, run.RunID, rewound.BranchID, "zhou", 2)
	if !strings.Contains(string(mustJSON(t, lin.Events)), "loan_note") || strings.Contains(string(mustJSON(t, zhou.Events)), "loan_note") {
		t.Fatalf("prefix visibility lin=%s zhou=%s", mustJSON(t, lin.Events), mustJSON(t, zhou.Events))
	}
}

func TestStoryCompanionUnmapKeepsParticipant(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-unmap")
	rel, err := testEnv.store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil || rel.ID <= 0 {
		t.Fatal(err)
	}
	mapped, err := testEnv.store.MapStoryParticipant(ctx, 1, run.RunID, "lin", rel.ID)
	if err != nil || mapped != rel.ID {
		t.Fatalf("map = %d, %v", mapped, err)
	}
	if _, err := testEnv.store.MapStoryParticipant(ctx, 1, run.RunID, "player", rel.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("player map = %v", err)
	}
	if err := testEnv.store.DeleteRelationship(ctx, 1, rel.ID, false); err != nil {
		t.Fatal(err)
	}
	if got := storySQL(t, run.RunID, `SELECT (SELECT count(*) FROM vc.story_participant p WHERE p.run_id=`+sqlID(run.RunID)+`)::text || ' ' || actor_id || ' ' || coalesce(relationship_id::text, 'null') FROM vc.story_participant WHERE run_id=`+sqlID(run.RunID)+` AND actor_id='lin'`); got != "4 lin null" {
		t.Fatalf("participant after delete = %s", got)
	}
	if _, err := testEnv.store.MapStoryParticipant(ctx, 2, run.RunID, "lin", 20); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign map = %v", err)
	}
}

func TestStoryEpilogueDiscardWritesNoMemory(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-discard")
	mustPlayStory(t, ctx, run)
	done, err := testEnv.store.DecideStoryEpilogue(ctx, 1, StoryEpilogue{RunID: run.RunID, Decision: "discard"})
	if err != nil || done.Decision != "discard" || done.MemoryID != 0 || done.RelationshipID != 0 {
		t.Fatalf("discard = %+v, %v", done, err)
	}
	again, err := testEnv.store.DecideStoryEpilogue(ctx, 1, StoryEpilogue{RunID: run.RunID, Decision: "discard"})
	if err != nil || again.MemoryID != 0 {
		t.Fatalf("discard replay = %+v, %v", again, err)
	}
	if got := storySQL(t, run.RunID, `SELECT (SELECT count(*) FROM vc.memory_item WHERE owner_user_id=1)::text || ' ' || decision || ' ' || coalesce(memory_id::text, 'null') FROM vc.story_epilogue WHERE run_id=`+sqlID(run.RunID)); got != "0 discard null" {
		t.Fatalf("discard wrote memory: %s", got)
	}
}

func TestStoryEpilogueSaveStaysUnconfirmed(t *testing.T) {
	resetFixtures(t)
	ctx := context.Background()
	run := mustOpenStory(t, ctx, "w14-story-save")
	mustPlayStory(t, ctx, run)
	rel, err := testEnv.store.CreateRelationship(ctx, 1, "gentle-listener")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testEnv.store.MapStoryParticipant(ctx, 1, run.RunID, "lin", rel.ID); err != nil {
		t.Fatal(err)
	}
	const summary = "我们一起玩过雨夜旅馆这一局"
	saved, err := testEnv.store.DecideStoryEpilogue(ctx, 1, StoryEpilogue{
		RunID: run.RunID, Decision: "save", RelationshipID: rel.ID, Summary: summary,
	})
	if err != nil || saved.MemoryID <= 0 || saved.RelationshipID != rel.ID || saved.MemoryStatus != "PENDING_CONFIRMATION" || saved.Summary != summary {
		t.Fatalf("save = %+v, %v", saved, err)
	}
	if got := storySQL(t, run.RunID, `SELECT status || ' ' || (SELECT count(*) FROM vc.memory_item WHERE owner_user_id=1 AND status='ACCEPTED')::text || ' ' || relationship_id::text FROM vc.memory_item WHERE owner_user_id=1 AND id=`+sqlID(saved.MemoryID)); got != "PENDING_CONFIRMATION 0 "+sqlID(rel.ID) {
		t.Fatalf("unconfirmed save = %s", got)
	}
	confirmed, err := testEnv.store.ConfirmMemory(ctx, 1, saved.MemoryID, nil)
	if err != nil || confirmed.Status != "ACCEPTED" || confirmed.RelationshipID != rel.ID || confirmed.Summary != summary {
		t.Fatalf("confirm existing candidate = %+v, %v", confirmed, err)
	}
}

func mustOpenStory(t *testing.T, ctx context.Context, chat string) StoryRun {
	t.Helper()
	conversationID := mustStoryConversation(t, ctx, 1, chat)
	run, err := testEnv.store.StartStoryRun(ctx, 1, conversationID, "rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func mustCommitStep(t *testing.T, ctx context.Context, run StoryRun, version int64, cmd story.Command) StoryCommitResult {
	t.Helper()
	res, err := testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
		RunID: run.RunID, BranchID: run.BranchID, ExpectedWorldVersion: version,
		ActionID: cmd.ActionID, ActorID: cmd.ActorID, Action: cmd.Action, Target: cmd.Target, ClueID: cmd.ClueID, Text: cmd.Text,
	})
	if err != nil || !res.Accepted || res.Replay {
		t.Fatalf("commit %+v = %+v, %v", cmd, res, err)
	}
	return res
}

func mustPlayStory(t *testing.T, ctx context.Context, run StoryRun) StoryCommitResult {
	t.Helper()
	steps, err := story.DeterministicSuccessPath("rainy-inn-v1")
	if err != nil {
		t.Fatal(err)
	}
	var last StoryCommitResult
	version := run.WorldVersion
	branch := run.BranchID
	for _, step := range steps {
		last, err = testEnv.store.CommitStoryCommand(ctx, 1, StoryCommit{
			RunID: run.RunID, BranchID: branch, ExpectedWorldVersion: version,
			ActionID: step.ActionID, ActorID: step.ActorID, Action: step.Action, Target: step.Target, ClueID: step.ClueID,
		})
		if err != nil || !last.Accepted || last.Replay || last.WorldVersion != version+1 || last.BranchID != branch {
			t.Fatalf("step %+v = %+v, %v", step, last, err)
		}
		version = last.WorldVersion
	}
	if !last.Ended || last.Stage != "resolved" || version != 7 {
		t.Fatalf("path ended at %+v", last)
	}
	return last
}

func mustActorFacts(t *testing.T, ctx context.Context, runID, branchID int64, actor string, version int64) StoryActorFacts {
	t.Helper()
	facts, err := testEnv.store.LoadStoryActor(ctx, 1, runID, branchID, actor, version)
	if err != nil {
		t.Fatal(err)
	}
	return facts
}

func storySQL(t *testing.T, runID int64, query string) string {
	t.Helper()
	got, err := psqlSuper(query)
	if err != nil {
		t.Fatalf("run %d: %v", runID, err)
	}
	return got
}

func sqlID(id int64) string {
	return strconv.FormatInt(id, 10)
}

func incrementDecimal(t *testing.T, raw string) string {
	t.Helper()
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		t.Fatal(err)
	}
	return strconv.Itoa(n + 1)
}
