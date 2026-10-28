package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/jackc/pgx/v5"
)

const storySummaryRunes = 2000

var storyChatIdentity = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$`)

// StoryCommit is one action or dialogue statement. An empty Action is a statement.
// ExpectedWorldVersion and BranchID must name the run's current head, except when
// ActionID was already committed: that replay does not write.
type StoryCommit struct {
	RunID                int64
	BranchID             int64
	ExpectedWorldVersion int64
	ActionID             string
	ActorID              string
	Action               string
	Target               string
	ClueID               string
	Text                 string
}

// StoryCommitResult is the world after a commit, or the unchanged world after a refusal.
// On replay, WorldVersion and EventID are the values from the original commit.
type StoryCommitResult struct {
	Accepted     bool
	Replay       bool
	Reason       string
	WorldVersion int64
	EventID      int64
	BranchID     int64
	Stage        string
	Ended        bool
}

// StoryRewind forks the current head at an earlier version and makes the fork current.
type StoryRewind struct {
	RunID          int64
	ToWorldVersion int64
	ChatIdentity   string
}

// StoryRewindResult is the new head. WorldVersion is the restored version.
type StoryRewindResult struct {
	BranchID     int64
	WorldVersion int64
	Stage        string
}

// StoryEpilogue saves or discards one shared-play summary after the run has ended.
// Save inserts a pending memory candidate and does not confirm it.
type StoryEpilogue struct {
	RunID          int64
	Decision       string
	RelationshipID int64
	Summary        string
}

// StoryEpilogueResult is the stored decision. MemoryID is zero when nothing was written.
type StoryEpilogueResult struct {
	Decision       string
	RelationshipID int64
	MemoryID       int64
	MemoryStatus   string
	Summary        string
}

type storyHead struct {
	caseID  string
	version int64
	stage   string
	headID  int64
	world   []byte
	ending  *string
}

type foundAction struct {
	EventID  int64
	BranchID int64
	Version  int64
}

type storedWorld struct {
	Items     []string            `json:"items"`
	Clues     []string            `json:"clues"`
	Truth     storedTruth         `json:"truth"`
	Knowledge map[string][]string `json:"knowledge"`
	Stage     string              `json:"stage"`
}

type storedTruth struct {
	KeyHolder     string `json:"keyHolder"`
	WatchLocation string `json:"watchLocation"`
	Ended         bool   `json:"ended"`
}

// CommitStoryCommand applies the embedded case rules and, when the decision writes
// a new event, commits it atomically with its pending projection.
func (s *Store) CommitStoryCommand(ctx context.Context, owner int64, in StoryCommit) (StoryCommitResult, error) {
	var out StoryCommitResult
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = commitStoryCommandTx(ctx, tx, owner, in)
		return err
	})
	if err != nil {
		return StoryCommitResult{}, mapStoryErr(err)
	}
	return out, nil
}

func commitStoryCommandTx(ctx context.Context, tx pgx.Tx, owner int64, in StoryCommit) (StoryCommitResult, error) {
	if err := validateStoryCommit(in); err != nil {
		return StoryCommitResult{}, err
	}
	head, err := loadStoryHead(ctx, tx, owner, in.RunID)
	if err != nil {
		return StoryCommitResult{}, err
	}
	// The action key is unique for the whole run, including events that rewind
	// left behind the current prefix. SQL returns that row before it checks the head.
	found, err := findStoryAction(ctx, tx, owner, in.RunID, in.ActionID)
	if err != nil {
		return StoryCommitResult{}, err
	}
	if found != nil {
		return replayResult(head, *found), nil
	}
	if in.BranchID != head.headID || in.ExpectedWorldVersion != head.version {
		return StoryCommitResult{}, ErrStoryWorldVersion
	}
	events, err := loadPrefixEvents(ctx, tx, owner, head.headID)
	if err != nil {
		return StoryCommitResult{}, err
	}
	state, err := storyState(head, events)
	if err != nil {
		return StoryCommitResult{}, err
	}
	decision, err := story.Apply(head.caseID, state, story.Command{
		ActionID: in.ActionID, ActorID: in.ActorID, Action: in.Action,
		Target: in.Target, ClueID: in.ClueID, Text: in.Text,
	})
	if err != nil {
		return StoryCommitResult{}, err
	}
	if decision.Replay {
		found, err = findStoryAction(ctx, tx, owner, in.RunID, in.ActionID)
		if err != nil {
			return StoryCommitResult{}, err
		}
		if found == nil {
			return StoryCommitResult{}, ErrNotFound
		}
		return replayResult(head, *found), nil
	}
	if !decision.Accepted {
		return StoryCommitResult{
			Reason: decision.Reason, WorldVersion: head.version, BranchID: head.headID,
			Stage: head.stage, Ended: head.ending != nil,
		}, nil
	}
	if len(decision.Events) != 1 {
		return StoryCommitResult{}, ErrInvalid
	}
	event := decision.Events[0]
	kind, err := eventKind(event.Body)
	if err != nil {
		return StoryCommitResult{}, err
	}
	if len(event.Visibility) == 0 || event.ActorID == "" {
		return StoryCommitResult{}, ErrInvalid
	}
	var worldArg any
	var stageArg any
	if kind == "action" {
		if decision.State.Phase == "" {
			return StoryCommitResult{}, ErrInvalid
		}
		raw, err := encodeWorldState(decision.State)
		if err != nil {
			return StoryCommitResult{}, err
		}
		worldArg = string(raw)
		stageArg = decision.State.Phase
	}
	var eventID, version, projectionID int64
	var replayed bool
	err = tx.QueryRow(ctx, `SELECT out_event_id, out_world_version, out_projection_id, out_replayed
		FROM vc.commit_story_event($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11)`,
		owner, in.RunID, in.BranchID, in.ActionID, in.ExpectedWorldVersion, kind, event.ActorID,
		append([]string(nil), event.Visibility...), string(event.Body), worldArg, stageArg,
	).Scan(&eventID, &version, &projectionID, &replayed)
	if err != nil {
		return StoryCommitResult{}, err
	}
	if replayed {
		found, err = findStoryAction(ctx, tx, owner, in.RunID, in.ActionID)
		if err != nil {
			return StoryCommitResult{}, err
		}
		if found == nil {
			return StoryCommitResult{}, ErrNotFound
		}
		return replayResult(head, *found), nil
	}
	if decision.State.Ended && head.ending == nil {
		code := decision.State.Phase
		if code == "" {
			code = "resolved"
		}
		var marked bool
		if err := tx.QueryRow(ctx, `SELECT vc.mark_story_ending($1,$2,$3)`, owner, in.RunID, code).Scan(&marked); err != nil {
			return StoryCommitResult{}, err
		}
		if !marked {
			return StoryCommitResult{}, ErrConflict
		}
	}
	stage := decision.State.Phase
	if stage == "" {
		stage = head.stage
	}
	return StoryCommitResult{
		Accepted: true, WorldVersion: version, EventID: eventID, BranchID: in.BranchID,
		Stage: stage, Ended: decision.State.Ended,
	}, nil
}

// RewindStory moves the run to a new branch headed at an earlier committed version.
func (s *Store) RewindStory(ctx context.Context, owner int64, in StoryRewind) (StoryRewindResult, error) {
	if in.RunID <= 0 || in.ToWorldVersion < 0 || !storyChatIdentity.MatchString(in.ChatIdentity) {
		return StoryRewindResult{}, ErrInvalid
	}
	var out StoryRewindResult
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT out_branch_id, out_world_version FROM vc.rewind_story($1,$2,$3,$4)`,
			owner, in.RunID, in.ToWorldVersion, in.ChatIdentity).Scan(&out.BranchID, &out.WorldVersion)
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT stage FROM vc.story_run WHERE owner_user_id=$1 AND id=$2`,
			owner, in.RunID).Scan(&out.Stage)
	})
	if err != nil {
		return StoryRewindResult{}, mapStoryErr(err)
	}
	return out, nil
}

// ConfirmStoryProjection marks one pending world event's chat projection confirmed.
// A cancelled or user-deleted projection returns false and is left unchanged.
func (s *Store) ConfirmStoryProjection(ctx context.Context, owner, runID, eventID int64) (bool, error) {
	if runID <= 0 || eventID <= 0 {
		return false, ErrInvalid
	}
	var confirmed bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var foundRun int64
		err := tx.QueryRow(ctx, `SELECT run_id FROM vc.story_event WHERE owner_user_id=$1 AND id=$2`,
			owner, eventID).Scan(&foundRun)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && foundRun != runID) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT vc.confirm_story_projection($1,$2)`, owner, eventID).Scan(&confirmed)
	})
	if err != nil {
		return false, mapStoryErr(err)
	}
	return confirmed, nil
}

// MapStoryParticipant binds one owned companion to lin, zhou, or su.
// The returned id is the relationship id now stored on that participant.
func (s *Store) MapStoryParticipant(ctx context.Context, owner, runID int64, actorID string, relationshipID int64) (int64, error) {
	if runID <= 0 || relationshipID <= 0 || !validStoryLabel(actorID, 64) {
		return 0, ErrInvalid
	}
	var participantID int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.map_story_participant($1,$2,$3,$4)`,
			owner, runID, actorID, relationshipID).Scan(&participantID)
	})
	if err != nil {
		return 0, mapStoryErr(err)
	}
	if participantID <= 0 {
		return 0, ErrNotFound
	}
	return relationshipID, nil
}

// DecideStoryEpilogue records the owner's save or discard choice.
// Discard writes no memory. Save creates one pending candidate; confirmation
// stays on the existing memory-candidate path.
func (s *Store) DecideStoryEpilogue(ctx context.Context, owner int64, in StoryEpilogue) (StoryEpilogueResult, error) {
	if in.RunID <= 0 || (in.Decision != "save" && in.Decision != "discard") {
		return StoryEpilogueResult{}, ErrInvalid
	}
	summary := strings.TrimSpace(in.Summary)
	if in.Decision == "discard" {
		if in.RelationshipID != 0 || summary != "" {
			return StoryEpilogueResult{}, ErrInvalid
		}
	} else if in.RelationshipID <= 0 || summary == "" || utf8.RuneCountInString(summary) > storySummaryRunes {
		return StoryEpilogueResult{}, ErrInvalid
	}
	var out StoryEpilogueResult
	out.Decision = in.Decision
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var relationship any
		var summaryArg any
		if in.Decision == "save" {
			relationship = in.RelationshipID
			summaryArg = summary
		}
		var memoryID *int64
		if err := tx.QueryRow(ctx, `SELECT vc.decide_story_epilogue($1,$2,$3,$4,$5)`,
			owner, in.RunID, in.Decision, relationship, summaryArg).Scan(&memoryID); err != nil {
			return err
		}
		if in.Decision == "discard" {
			return nil
		}
		if memoryID == nil || *memoryID <= 0 {
			return ErrNotFound
		}
		out.MemoryID = *memoryID
		out.RelationshipID = in.RelationshipID
		out.Summary = summary
		err := tx.QueryRow(ctx, `SELECT out_status FROM vc.list_memory($1,$2,false) WHERE out_id=$3`,
			owner, in.RelationshipID, *memoryID).Scan(&out.MemoryStatus)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	if err != nil {
		return StoryEpilogueResult{}, mapStoryErr(err)
	}
	return out, nil
}

func loadStoryHead(ctx context.Context, tx pgx.Tx, owner, runID int64) (storyHead, error) {
	var head storyHead
	err := tx.QueryRow(ctx, `SELECT case_id, world_version, stage, current_branch_id, world_state, ending_code
		FROM vc.story_run WHERE owner_user_id=$1 AND id=$2`, owner, runID).Scan(
		&head.caseID, &head.version, &head.stage, &head.headID, &head.world, &head.ending)
	if errors.Is(err, pgx.ErrNoRows) {
		return storyHead{}, ErrNotFound
	}
	if err != nil {
		return storyHead{}, err
	}
	return head, nil
}

func findStoryAction(ctx context.Context, tx pgx.Tx, owner, runID int64, actionID string) (*foundAction, error) {
	var found foundAction
	err := tx.QueryRow(ctx, `SELECT id, branch_id, world_version FROM vc.story_event
		WHERE owner_user_id=$1 AND run_id=$2 AND action_id=$3 ORDER BY id LIMIT 1`,
		owner, runID, actionID).Scan(&found.EventID, &found.BranchID, &found.Version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &found, nil
}

func replayResult(head storyHead, found foundAction) StoryCommitResult {
	return StoryCommitResult{
		Accepted: true, Replay: true, WorldVersion: found.Version, EventID: found.EventID,
		BranchID: found.BranchID, Stage: head.stage, Ended: head.ending != nil,
	}
}

func validateStoryCommit(in StoryCommit) error {
	if in.RunID <= 0 || in.BranchID <= 0 || in.ExpectedWorldVersion < 0 {
		return ErrInvalid
	}
	if !validStoryLabel(in.ActionID, 128) || !validStoryLabel(in.ActorID, 64) {
		return ErrInvalid
	}
	if (in.Action != "" && !validStoryLabel(in.Action, 64)) ||
		(in.Target != "" && !validStoryLabel(in.Target, 64)) ||
		(in.ClueID != "" && !validStoryLabel(in.ClueID, 64)) ||
		utf8.RuneCountInString(in.Text) > 4000 {
		return ErrInvalid
	}
	return nil
}

func validStoryLabel(value string, max int) bool {
	return value != "" && value == strings.TrimSpace(value) && utf8.RuneCountInString(value) <= max
}

func eventKind(body json.RawMessage) (string, error) {
	var parsed struct {
		Kind string `json:"kind"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", ErrInvalid
	}
	if parsed.Kind != "action" && parsed.Kind != "statement" {
		return "", ErrInvalid
	}
	return parsed.Kind, nil
}

func encodeWorldState(state story.State) ([]byte, error) {
	clues := state.PlayerClues
	if clues == nil {
		clues = []string{}
	}
	return json.Marshal(storedWorld{
		Items: []string{},
		Clues: clues,
		Truth: storedTruth{
			KeyHolder: state.KeyHolder, WatchLocation: state.WatchLocation, Ended: state.Ended,
		},
		Knowledge: coerceKnowledge(state.ActorRevealedClues),
		Stage:     state.Phase,
	})
}

func coerceKnowledge(in map[string][]string) map[string][]string {
	out := map[string][]string{}
	for actor, clues := range in {
		if clues == nil {
			clues = []string{}
		}
		out[actor] = clues
	}
	return out
}

func storyState(head storyHead, events []story.Event) (story.State, error) {
	state, err := story.InitialState(head.caseID)
	if err != nil {
		return story.State{}, err
	}
	var stored storedWorld
	if len(head.world) > 0 {
		if err := json.Unmarshal(head.world, &stored); err != nil {
			return story.State{}, ErrInvalid
		}
	}
	if stored.Truth.KeyHolder != "" {
		state.KeyHolder = stored.Truth.KeyHolder
		state.WatchLocation = stored.Truth.WatchLocation
		state.Ended = stored.Truth.Ended
		state.PlayerClues = stored.Clues
		if state.PlayerClues == nil {
			state.PlayerClues = []string{}
		}
		state.ActorRevealedClues = coerceKnowledge(stored.Knowledge)
	}
	if head.stage != "" {
		state.Phase = head.stage
	}
	if head.ending != nil {
		state.Ended = true
	}
	state.Version = head.version
	if events == nil {
		events = []story.Event{}
	}
	state.Events = events
	return state, nil
}

func loadPrefixEvents(ctx context.Context, tx pgx.Tx, owner, branchID int64) ([]story.Event, error) {
	rows, err := tx.Query(ctx, `SELECT out_event_id, out_actor_id, out_action_id, out_world_version, out_visibility, out_body
		FROM vc.list_story_branch_events($1,$2)`, owner, branchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []story.Event{}
	for rows.Next() {
		var event story.Event
		var actionID *string
		var visibility []string
		var body []byte
		if err := rows.Scan(&event.ID, &event.ActorID, &actionID, &event.WorldVersion, &visibility, &body); err != nil {
			return nil, err
		}
		if actionID != nil {
			event.ActionID = *actionID
		}
		if event.ActionID == "" {
			var parsed struct {
				ActionID string `json:"actionId"`
			}
			if json.Unmarshal(body, &parsed) == nil {
				event.ActionID = parsed.ActionID
			}
		}
		if visibility == nil {
			visibility = []string{}
		}
		event.Visibility = append([]string(nil), visibility...)
		event.Body = append(json.RawMessage(nil), body...)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return events, nil
}

func eventsVisibleTo(events []story.Event, actorID string) []story.Event {
	out := []story.Event{}
	for _, event := range events {
		seen := false
		for _, actor := range event.Visibility {
			if actor == actorID {
				seen = true
				break
			}
		}
		if !seen {
			continue
		}
		event.Visibility = append([]string(nil), event.Visibility...)
		event.Body = append(json.RawMessage(nil), event.Body...)
		out = append(out, event)
	}
	return out
}
