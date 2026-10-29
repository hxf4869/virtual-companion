package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/story"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrStoryWorldVersion means the caller's expected world version is not the run's.
var ErrStoryWorldVersion = errors.New("story world version conflict")

// StoryParticipant is one person in a run. RelationshipID is set when an owned
// companion is mapped onto lin, zhou, or su, and becomes nil if that companion is deleted.
type StoryParticipant struct {
	ActorID        string
	Name           string
	Role           string
	Scene          string
	RelationshipID *int64
}

// StoryRun is the current branch head of one STORY conversation.
type StoryRun struct {
	ConversationID int64
	RunID          int64
	BranchID       int64
	CaseID         string
	WorldVersion   int64
	Stage          string
	Participants   []StoryParticipant
}

// StoryActorFacts is the stored identity and branch events for one actor.
// Events come from this branch and its parent prefix, limited to rows whose
// visibility includes the actor. Each row keeps its full visibility.
// ChatIdentity is that run's STORY conversation st_chat_identity.
type StoryActorFacts struct {
	ConversationID int64
	RunID          int64
	BranchID       int64
	ActorID        string
	CaseID         string
	WorldVersion   int64
	ChatIdentity   string
	Events         []story.Event
}

// StartStoryRun opens rainy-inn-v1 on one STORY conversation, or returns the
// existing run when the case matches. A second case conflicts. COMPANION
// conversations are rejected. NPCs are participants, not relationships.
func (s *Store) StartStoryRun(ctx context.Context, owner, conversationID int64, caseID string) (StoryRun, error) {
	spec, err := story.Open(caseID)
	if err != nil || conversationID <= 0 {
		return StoryRun{}, ErrInvalid
	}
	var out StoryRun
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		created, err := startStoryRunTx(ctx, tx, owner, conversationID, spec)
		if err != nil {
			return err
		}
		out = created
		return nil
	})
	if err != nil {
		return StoryRun{}, mapStoryErr(err)
	}
	return out, nil
}

func startStoryRunTx(ctx context.Context, tx pgx.Tx, owner, conversationID int64, spec story.Spec) (StoryRun, error) {
	var mode string
	err := tx.QueryRow(ctx, `SELECT st_mode FROM vc.conversation WHERE owner_user_id=$1 AND id=$2`,
		owner, conversationID).Scan(&mode)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoryRun{}, ErrNotFound
	}
	if err != nil {
		return StoryRun{}, err
	}
	if mode != "STORY" {
		return StoryRun{}, ErrConflict
	}
	_, caseID, found, err := lookupStoryRun(ctx, tx, owner, conversationID)
	if err != nil {
		return StoryRun{}, err
	}
	if found {
		if caseID != spec.CaseID {
			return StoryRun{}, ErrConflict
		}
		return loadStoryRun(ctx, tx, owner, conversationID, spec)
	}
	if _, err := tx.Exec(ctx, "SAVEPOINT story_run_create"); err != nil {
		return StoryRun{}, err
	}
	var runID, branchID int64
	err = tx.QueryRow(ctx, `SELECT out_run_id, out_branch_id FROM vc.create_story_run($1,$2,$3,$4,$5)`,
		owner, spec.CaseID, spec.WorldVersion, spec.Stage, conversationID).Scan(&runID, &branchID)
	if uniqueViolation(err) {
		if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT story_run_create"); rbErr != nil {
			return StoryRun{}, rbErr
		}
		_, caseID, found, err = lookupStoryRun(ctx, tx, owner, conversationID)
		if err != nil {
			return StoryRun{}, err
		}
		if !found {
			return StoryRun{}, ErrNotFound
		}
		if caseID != spec.CaseID {
			return StoryRun{}, ErrConflict
		}
		return loadStoryRun(ctx, tx, owner, conversationID, spec)
	}
	if err != nil {
		return StoryRun{}, err
	}
	for _, participant := range spec.Participants {
		var id int64
		var relationshipID *int64
		if err := tx.QueryRow(ctx, `SELECT vc.add_story_participant($1,$2,$3,$4,$5,$6)`,
			owner, runID, participant.ActorID, participant.Role, participant.Scene, relationshipID).Scan(&id); err != nil {
			return StoryRun{}, err
		}
	}
	return loadStoryRun(ctx, tx, owner, conversationID, spec)
}

func lookupStoryRun(ctx context.Context, tx pgx.Tx, owner, conversationID int64) (int64, string, bool, error) {
	var runID int64
	var caseID string
	err := tx.QueryRow(ctx, `SELECT id, case_id FROM vc.story_run WHERE owner_user_id=$1 AND conversation_id=$2`,
		owner, conversationID).Scan(&runID, &caseID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}
	return runID, caseID, true, nil
}

func loadStoryRun(ctx context.Context, tx pgx.Tx, owner, conversationID int64, spec story.Spec) (StoryRun, error) {
	var out StoryRun
	var branchID sql.NullInt64
	err := tx.QueryRow(ctx, `SELECT id, case_id, world_version, stage, conversation_id, current_branch_id
		FROM vc.story_run WHERE owner_user_id=$1 AND conversation_id=$2`,
		owner, conversationID).Scan(&out.RunID, &out.CaseID, &out.WorldVersion, &out.Stage, &out.ConversationID, &branchID)
	if errors.Is(err, pgx.ErrNoRows) {
		return StoryRun{}, ErrNotFound
	}
	if err != nil {
		return StoryRun{}, err
	}
	if !branchID.Valid || branchID.Int64 <= 0 {
		return StoryRun{}, ErrNotFound
	}
	out.BranchID = branchID.Int64
	rows, err := tx.Query(ctx, `SELECT actor_id, role, scene, relationship_id
		FROM vc.story_participant WHERE owner_user_id=$1 AND run_id=$2 ORDER BY id`,
		owner, out.RunID)
	if err != nil {
		return StoryRun{}, err
	}
	defer rows.Close()
	names := map[string]string{}
	for _, participant := range spec.Participants {
		names[participant.ActorID] = participant.Name
	}
	out.Participants = []StoryParticipant{}
	for rows.Next() {
		var participant StoryParticipant
		if err := rows.Scan(&participant.ActorID, &participant.Role, &participant.Scene, &participant.RelationshipID); err != nil {
			return StoryRun{}, err
		}
		participant.Name = names[participant.ActorID]
		out.Participants = append(out.Participants, participant)
	}
	if err := rows.Err(); err != nil {
		return StoryRun{}, err
	}
	return out, nil
}

// LoadStoryActor reads one owned run at the expected world version.
func (s *Store) LoadStoryActor(ctx context.Context, owner, runID, branchID int64, actorID string, worldVersion int64) (StoryActorFacts, error) {
	if runID <= 0 || branchID <= 0 || actorID == "" || worldVersion < 0 {
		return StoryActorFacts{}, ErrInvalid
	}
	var out StoryActorFacts
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		// Session writes answer an active deletion intent with not-found.
		// ActorView and the service-token outbound check share this read.
		var deleting bool
		if err := tx.QueryRow(ctx, `SELECT vc.account_deletion_intent_active_current()`).Scan(&deleting); err != nil {
			return err
		}
		if deleting {
			return ErrNotFound
		}
		var mode string
		err := tx.QueryRow(ctx, `SELECT r.conversation_id, r.case_id, r.world_version,
				COALESCE(c.st_chat_identity, ''), COALESCE(c.st_mode, '')
			FROM vc.story_run r
			JOIN vc.conversation c ON c.owner_user_id = r.owner_user_id AND c.id = r.conversation_id
			WHERE r.owner_user_id=$1 AND r.id=$2`,
			owner, runID).Scan(&out.ConversationID, &out.CaseID, &out.WorldVersion, &out.ChatIdentity, &mode)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if mode != "STORY" || strings.TrimSpace(out.ChatIdentity) == "" {
			return ErrNotFound
		}
		if out.WorldVersion != worldVersion {
			return ErrStoryWorldVersion
		}
		var branch int
		err = tx.QueryRow(ctx, `SELECT 1 FROM vc.story_branch
			WHERE owner_user_id=$1 AND id=$2 AND run_id=$3`, owner, branchID, runID).Scan(&branch)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		var participant int
		err = tx.QueryRow(ctx, `SELECT 1 FROM vc.story_participant
			WHERE owner_user_id=$1 AND run_id=$2 AND actor_id=$3`, owner, runID, actorID).Scan(&participant)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		events, err := loadPrefixEvents(ctx, tx, owner, branchID)
		if err != nil {
			return err
		}
		out.Events = eventsVisibleTo(events, actorID)
		return nil
	})
	if err != nil {
		return StoryActorFacts{}, mapStoryErr(err)
	}
	out.RunID = runID
	out.BranchID = branchID
	out.ActorID = actorID
	return out, nil
}

func uniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func mapStoryErr(err error) error {
	if errors.Is(err, story.ErrInvalid) {
		return ErrInvalid
	}
	if err == nil || errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalid) ||
		errors.Is(err, ErrConflict) || errors.Is(err, ErrStoryWorldVersion) || errors.Is(err, errStore) {
		return err
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		msg := pgErr.Message
		switch {
		case strings.Contains(msg, "STORY conversation"):
			return ErrConflict
		case strings.Contains(msg, "conflicts with"):
			return ErrStoryWorldVersion
		case strings.Contains(msg, "requires an ending"), strings.Contains(msg, "already"):
			return ErrConflict
		case strings.Contains(msg, "deletion"):
			return ErrNotFound
		case strings.Contains(msg, "not owned"), strings.Contains(msg, "not mapped"),
			strings.Contains(msg, "not a participant"), strings.Contains(msg, "is not in this run"),
			strings.Contains(msg, "not found"):
			return ErrNotFound
		case strings.Contains(msg, "invalid input"), strings.Contains(msg, "cannot"),
			strings.Contains(msg, "not before"), strings.Contains(msg, "no stage"):
			return ErrInvalid
		}
	}
	return mapStoreErr(err)
}
