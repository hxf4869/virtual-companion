package postgres

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/hxf4869/virtual-companion/internal/companion"
	"github.com/hxf4869/virtual-companion/internal/realtime"
	"github.com/hxf4869/virtual-companion/internal/turn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedMemoryWindow is the model-context history window and the recall
// selection cap. It must stay >= the builder's context entry budget so the
// SQL-side cut never changes which rows the builder would pick from a full
// read.
const seedWindow = 64

// GenerationView is the KEEP send/cancel response.
type GenerationView struct {
	ID                  int64
	ConversationID      int64
	LogicalGenerationID string
	Status              string
	Mode                string
	CreatedAt           time.Time
	Created             bool
	JobID               int64
}

// GenerationSnapshot is the durable reconnect view. Partial text is never
// invented here.
type GenerationSnapshot struct {
	Status             string
	AssistantMessageID *int64
	AssistantContent   string
	InputTokens        *int64
	OutputTokens       *int64
	FailureCode        string
	// SourceMessageID is the persisted user message this generation was
	// sourced from (N-06); nil for legacy turns without one.
	SourceMessageID *int64
}

// GenerationFeedback is one recorded (generation, kind) row.
type GenerationFeedback struct {
	GenerationID int64
	Kind         string
	Note         *string
	CreatedAt    time.Time
}

// StartTurn is the durable intake command.
type StartTurn struct {
	ConversationID  int64
	IdempotencyKey  string
	UserContent     string
	Mode            string
	SourceMessageID *int64
	MaxOutstanding  int
}

func parseTurnID(raw string) (int64, error) {
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return 0, ErrInvalid
	}
	return n, nil
}

func (s *Store) StartTurn(ctx context.Context, owner int64, in StartTurn) (GenerationView, error) {
	if in.ConversationID <= 0 || in.IdempotencyKey == "" {
		return GenerationView{}, ErrInvalid
	}
	if in.MaxOutstanding < 1 {
		in.MaxOutstanding = 4
	}
	content := in.UserContent
	if in.SourceMessageID == nil {
		stored, err := s.encryptStored(content)
		if err != nil {
			return GenerationView{}, errStore
		}
		content = stored
	}
	var out GenerationView
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var createdAt time.Time
		var job pgtype.Int8
		err := tx.QueryRow(ctx,
			`SELECT out_generation_id, out_logical_generation_id, out_conversation_id,
			        out_status, out_mode, out_created, out_created_at, out_job_id
			   FROM vc.go_start_turn($1,$2,$3,$4,$5,$6,$7)`,
			owner, in.ConversationID, in.IdempotencyKey, content, in.Mode,
			in.SourceMessageID, in.MaxOutstanding,
		).Scan(&out.ID, &out.LogicalGenerationID, &out.ConversationID,
			&out.Status, &out.Mode, &out.Created, &createdAt, &job)
		if err != nil {
			return err
		}
		out.CreatedAt = createdAt.UTC()
		if job.Valid {
			out.JobID = job.Int64
		}
		return nil
	})
	if err != nil {
		return GenerationView{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) CancelTurn(ctx context.Context, owner, generationID int64) (GenerationView, error) {
	if generationID <= 0 {
		return GenerationView{}, ErrInvalid
	}
	var out GenerationView
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var createdAt time.Time
		err := tx.QueryRow(ctx,
			`SELECT out_generation_id, out_status, out_logical_generation_id,
			        out_conversation_id, out_mode, out_created_at
			   FROM vc.go_request_cancel($1,$2)`, owner, generationID,
		).Scan(&out.ID, &out.Status, &out.LogicalGenerationID, &out.ConversationID, &out.Mode, &createdAt)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out.CreatedAt = createdAt.UTC()
		return nil
	})
	if err != nil {
		return GenerationView{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) GenerationSnapshot(ctx context.Context, owner, generationID int64) (GenerationSnapshot, error) {
	snap, ok, err := s.loadSnapshot(ctx, owner, generationID)
	if err != nil {
		return GenerationSnapshot{}, err
	}
	if !ok {
		return GenerationSnapshot{}, ErrNotFound
	}
	return snap, nil
}

func (s *Store) loadSnapshot(ctx context.Context, owner, generationID int64) (GenerationSnapshot, bool, error) {
	var out GenerationSnapshot
	var found bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var assistant pgtype.Int8
		var content, failure pgtype.Text
		var inTok, outTok pgtype.Int8
		err := tx.QueryRow(ctx,
			`SELECT out_status, out_assistant_message_id, out_assistant_content,
			        out_input_tokens, out_output_tokens, out_failure_code
			   FROM vc.go_read_generation_snapshot_with_failure($1,$2)`, owner, generationID,
		).Scan(&out.Status, &assistant, &content, &inTok, &outTok, &failure)
		if err == pgx.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		found = true
		if assistant.Valid {
			id := assistant.Int64
			out.AssistantMessageID = &id
		}
		if content.Valid && content.String != "" {
			plain, err := s.decryptStored(content.String)
			if err != nil {
				return errStore
			}
			out.AssistantContent = plain
		}
		if inTok.Valid {
			v := inTok.Int64
			out.InputTokens = &v
		}
		if outTok.Valid {
			v := outTok.Int64
			out.OutputTokens = &v
		}
		if failure.Valid {
			out.FailureCode = failure.String
		}
		// N-06: reuse the existing owner-scoped generation read inside the same
		// WithOwner transaction for the source message id; no SQL change. A
		// missing row (inconsistent race) just leaves the field nil.
		var src pgtype.Int8
		srcErr := tx.QueryRow(ctx,
			`SELECT out_source_message_id FROM vc.go_get_generation($1,$2)`, owner, generationID,
		).Scan(&src)
		if srcErr == nil && src.Valid {
			id := src.Int64
			out.SourceMessageID = &id
		} else if srcErr != nil && srcErr != pgx.ErrNoRows {
			return srcErr
		}
		return nil
	})
	if err != nil {
		return GenerationSnapshot{}, false, mapStoreErr(err)
	}
	return out, found, nil
}

func (s *Store) Load(ctx context.Context, ownerUserID int64, generationID string) (realtime.Snapshot, bool, error) {
	id, err := parseTurnID(generationID)
	if err != nil {
		return realtime.Snapshot{}, false, nil
	}
	row, ok, err := s.loadSnapshot(ctx, ownerUserID, id)
	if err != nil || !ok {
		return realtime.Snapshot{}, ok, err
	}
	snap := realtime.Snapshot{Text: ""}
	if row.Status == "COMPLETED" || row.Status == "COMPLETED_FALLBACK" {
		snap.Terminal = companion.EventCompleted
		snap.Text = row.AssistantContent
	} else if row.Status == "INPUT_BLOCKED" || row.Status == "OUTPUT_BLOCKED" {
		snap.Terminal = companion.EventBlocked
	} else if row.Status == "CANCELLED" {
		snap.Terminal = companion.EventCancelled
	} else if row.Status == "FAILED_FINAL" {
		snap.Terminal = companion.EventFailed
	}
	return snap, true, nil
}

func (s *Store) RecordGenerationFeedback(ctx context.Context, owner, generationID int64, kind, note string) (GenerationFeedback, error) {
	if generationID <= 0 || kind == "" {
		return GenerationFeedback{}, ErrInvalid
	}
	var out GenerationFeedback
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var noteVal pgtype.Text
		var created time.Time
		err := tx.QueryRow(ctx,
			`SELECT o_generation_id, o_kind, o_note, o_created_at
			   FROM vc.record_generation_feedback($1,$2,$3,$4)`,
			owner, generationID, kind, nullIfBlank(note),
		).Scan(&out.GenerationID, &out.Kind, &noteVal, &created)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		out.CreatedAt = created.UTC()
		if noteVal.Valid {
			n := noteVal.String
			out.Note = &n
		}
		return nil
	})
	if err != nil {
		return GenerationFeedback{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) LoadSeed(ctx context.Context, key turn.TurnKey) (turn.ContextSeed, error) {
	genID, err := parseTurnID(key.TurnID)
	if err != nil {
		return turn.ContextSeed{}, err
	}
	view, err := s.getGenerationMeta(ctx, key.OwnerID, genID)
	if err != nil {
		return turn.ContextSeed{}, err
	}
	var seed turn.ContextSeed
	seed.ConversationMode = view.mode
	seed.Incognito = view.incognito
	seed.NoMemory = view.noMemory
	seed.CurrentUserMessage = view.userContent
	seed.UserPersona = view.persona
	seed.ConfigVersion = "go-v1"

	// The seed history ends at the current turn: read the recent window BEFORE
	// the generation's source user message (exclusive) instead of the earliest
	// window, so long conversations still see the latest history. Rows come
	// back in ascending id order. Model-facing reads filter on the persisted
	// vc.message.model_eligible fact (V112) before the LIMIT; the user-facing
	// reads behind history and export keep seeing every row. A retried turn
	// re-checks its own source message before re-sending it as current input.
	// Legacy generations without a source message keep the historical forward
	// read, equally eligibility-filtered.
	var msgs []Message
	if view.sourceID != 0 {
		eligible, err := s.MessageModelEligible(ctx, key.OwnerID, view.sourceID)
		if err != nil {
			return turn.ContextSeed{}, err
		}
		if !eligible {
			return turn.ContextSeed{}, fmt.Errorf(
				"generation source message %d lost model eligibility", view.sourceID)
		}
		before := view.sourceID
		msgs, err = s.ListRecentModelMessages(ctx, key.OwnerID, view.conversationID, &before, seedWindow)
	} else {
		msgs, err = s.ListModelHistoryMessages(ctx, key.OwnerID, view.conversationID, nil, seedWindow)
	}
	if err != nil {
		return turn.ContextSeed{}, err
	}
	for _, m := range msgs {
		if view.sourceID != 0 && m.ID == view.sourceID {
			continue
		}
		seed.RecentMessages = append(seed.RecentMessages, turn.HistoryMessage{
			Role:    companion.Role(m.Role),
			Content: m.Content,
		})
	}
	if !view.incognito && !view.noMemory {
		// Effective-memory selection (N-02): ACCEPTED, not deleted, not
		// superseded, not expired, scope-filtered in SQL before truncation.
		// Auto-save stays RELATIONSHIP; only the read side honours the
		// relationship's memoryShareScope read convention.
		shareScope := view.persona.MemoryShareScope
		if shareScope == "" {
			shareScope = "RELATIONSHIP"
		}
		mems, err := s.SelectRecallMemories(ctx, key.OwnerID, view.relationshipID, view.conversationID, shareScope)
		if err != nil {
			return turn.ContextSeed{}, err
		}
		for _, mem := range mems {
			seed.EligibleMemories = append(seed.EligibleMemories, turn.MemoryCandidate{
				SourceID:  strconv.FormatInt(mem.ID, 10),
				Summary:   mem.Summary,
				Relevance: 50,
				Confirmed: true,
			})
		}
	}
	gate, err := s.OutboundCheck(ctx, key.OwnerID)
	if err != nil {
		return turn.ContextSeed{}, err
	}
	for _, c := range gate.Categories {
		seed.AllowedCategories = append(seed.AllowedCategories, turn.DataCategory(c))
	}
	seed.TurnID = key.TurnID
	return seed, nil
}

// ListRecentModelMessages reads the most recent MODEL-ELIGIBLE message window
// for the turn context (V131). before is the exclusive oldest already-counted
// message id (nil = conversation tail). Rows are returned in ascending id
// order and eligibility filters before the LIMIT, so an ineligible recent
// page cannot shorten the eligible window. This is a model-facing read only:
// the user-facing go_list_recent_messages keeps seeing every row.
func (s *Store) ListRecentModelMessages(ctx context.Context, owner, conversationID int64, before *int64, limit int) ([]Message, error) {
	var limitPtr *int
	if limit > 0 {
		limitPtr = &limit
	}
	var out []Message
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_role, out_content, out_created_at, out_no_memory
			   FROM vc.go_list_model_recent_messages($1, $2, $3, $4)`,
			owner, conversationID, before, limitPtr)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Message
			var stored string
			if err := rows.Scan(&m.ID, &m.Role, &stored, &m.CreatedAt, &m.NoMemory); err != nil {
				return err
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return errStore
			}
			m.ConversationID = conversationID
			m.Content = plain
			out = append(out, m)
		}
		if out == nil {
			out = []Message{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

// ListModelHistoryMessages is the model-facing forward read for legacy seed
// turns without a source message (V131): the earliest eligible window,
// ascending, with the same eligibility predicate as the recent-window read.
func (s *Store) ListModelHistoryMessages(ctx context.Context, owner, conversationID int64, after *int64, limit int) ([]Message, error) {
	var limitPtr *int
	if limit > 0 {
		limitPtr = &limit
	}
	var out []Message
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_role, out_content, out_created_at, out_no_memory
			   FROM vc.go_list_model_history_messages($1, $2, $3, $4)`,
			owner, conversationID, after, limitPtr)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var m Message
			var stored string
			if err := rows.Scan(&m.ID, &m.Role, &stored, &m.CreatedAt, &m.NoMemory); err != nil {
				return err
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return errStore
			}
			m.ConversationID = conversationID
			m.Content = plain
			out = append(out, m)
		}
		if out == nil {
			out = []Message{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

// MessageModelEligible reports the persisted egress fact (V112) for one
// message, so a retried turn re-checks its own source before re-sending it.
func (s *Store) MessageModelEligible(ctx context.Context, owner, messageID int64) (bool, error) {
	if messageID <= 0 {
		return false, ErrInvalid
	}
	var eligible bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT vc.go_message_model_eligible($1, $2)`,
			owner, messageID).Scan(&eligible)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return eligible, nil
}

// SelectRecallMemories reads the effective recall set for one turn (V132):
// ACCEPTED, not deleted, not superseded, due events lazily expired, scope
// filtered by the relationship's memoryShareScope read convention, cut and
// ordered in SQL. The management read vc.list_memory stays untouched.
func (s *Store) SelectRecallMemories(ctx context.Context, owner, relationshipID, conversationID int64, shareScope string) ([]Memory, error) {
	if shareScope == "" {
		shareScope = "RELATIONSHIP"
	}
	var out []Memory
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx,
			`SELECT out_id, out_scope, out_summary, out_conversation_id
			   FROM vc.go_select_recall_memories($1, $2, $3, $4, $5)`,
			owner, relationshipID, conversationID, shareScope, seedWindow)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var mem Memory
			var stored string
			if err := rows.Scan(&mem.ID, &mem.Scope, &stored, &mem.ConversationID); err != nil {
				return err
			}
			plain, err := s.decryptStored(stored)
			if err != nil {
				return errStore
			}
			mem.Summary = plain
			mem.RelationshipID = relationshipID
			out = append(out, mem)
		}
		if out == nil {
			out = []Memory{}
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapStoreErr(err)
	}
	return out, nil
}

type generationMeta struct {
	conversationID int64
	relationshipID int64
	sourceID       int64
	mode           string
	incognito      bool
	noMemory       bool
	userContent    string
	persona        turn.UserPersona
}

func (s *Store) getGenerationMeta(ctx context.Context, owner, genID int64) (generationMeta, error) {
	var m generationMeta
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var src pgtype.Int8
		var assistant pgtype.Int8
		var content pgtype.Text
		var cancel bool
		var logical, status string
		var created time.Time
		var job pgtype.Int8
		var jobStatus pgtype.Text
		var gid int64
		err := tx.QueryRow(ctx,
			`SELECT out_generation_id, out_conversation_id, out_relationship_id,
			        out_logical_generation_id, out_status, out_mode, out_created_at,
			        out_source_message_id, out_assistant_message_id, out_cancel_requested,
			        out_incognito, out_user_content, out_user_no_memory, out_job_id, out_job_status
			   FROM vc.go_get_generation($1,$2)`, owner, genID,
		).Scan(&gid, &m.conversationID, &m.relationshipID, &logical, &status, &m.mode, &created,
			&src, &assistant, &cancel, &m.incognito, &content, &m.noMemory, &job, &jobStatus)
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if src.Valid {
			m.sourceID = src.Int64
		}
		if content.Valid {
			plain, err := s.decryptStored(content.String)
			if err != nil {
				return errStore
			}
			m.userContent = plain
		}
		rel, ok, err := scanRelationship(ctx, tx, owner, m.relationshipID)
		if err != nil {
			return err
		}
		if ok {
			m.persona = turn.UserPersona{
				CompanionName:    deref(rel.CompanionName),
				UserAddressAs:    deref(rel.UserAddressAs),
				ReplyLength:      rel.ReplyLength,
				Initiative:       rel.Initiative,
				Humor:            rel.Humor,
				AdvicePref:       rel.AdvicePref,
				MemoryShareScope: rel.MemoryShareScope,
				AvoidTopics:      rel.AvoidTopics,
				Gender:           rel.Gender,
			}
		}
		return nil
	})
	if err != nil {
		return generationMeta{}, mapStoreErr(err)
	}
	return m, nil
}

func (s *Store) PrepareAttempt(ctx context.Context, cmd turn.PrepareAttempt) (turn.PreparedAttempt, error) {
	if cmd.OwnerID <= 0 || cmd.JobID <= 0 || cmd.ClaimToken == "" || cmd.ClaimFence == "" {
		return turn.PreparedAttempt{}, ErrInvalid
	}
	genID, err := parseTurnID(cmd.TurnID)
	if err != nil {
		return turn.PreparedAttempt{}, err
	}
	cats := make([]string, 0, len(cmd.Categories))
	for _, c := range cmd.Categories {
		cats = append(cats, string(c))
	}
	if cats == nil {
		cats = []string{}
	}
	providerID := cmd.ProviderID
	if providerID == "" {
		providerID = "openai-compatible"
	}
	supplier := cmd.SupplierName
	if supplier == "" {
		supplier = providerID
	}
	var out turn.PreparedAttempt
	err = s.WithOwner(ctx, cmd.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var attemptID int64
		var attemptNo int
		var paid string
		err := tx.QueryRow(ctx,
			`SELECT out_attempt_id, out_attempt_no, out_provider_attempt_id
			   FROM vc.go_prepare_model_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
			cmd.OwnerID, cmd.JobID, genID, cmd.ClaimToken, cmd.ClaimFence,
			providerID, supplier, cmd.ModelID, cats,
			cmd.ConsentVersion, cmd.ProviderContractVersion,
			cmd.PromptVersion, cmd.PersonaVersion, cmd.ConfigVersion,
			cmd.ReservedCost, cmd.MonthlyCostLimit,
		).Scan(&attemptID, &attemptNo, &paid)
		if err != nil {
			return err
		}
		out = turn.PreparedAttempt{
			AttemptID: strconv.FormatInt(attemptID, 10),
			Budget:    cmd.Budget,
			Fence:     int64(attemptNo),
		}
		return nil
	})
	if err != nil {
		return turn.PreparedAttempt{}, mapStoreErr(err)
	}
	return out, nil
}

func (s *Store) RecordAttemptOutcome(ctx context.Context, outcome companion.AttemptOutcome) error {
	if outcome.OwnerID <= 0 || outcome.JobID <= 0 || outcome.ClaimToken == "" {
		return ErrInvalid
	}
	attemptID, err := parseTurnID(outcome.AttemptID)
	if err != nil {
		return err
	}
	logical := mapLogicalStatus(outcome.Status)
	err = s.WithOwner(ctx, outcome.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var n int
		if err := tx.QueryRow(ctx,
			`SELECT vc.go_record_attempt_outcome($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			outcome.OwnerID, attemptID, outcome.JobID, outcome.ClaimToken, outcome.ClaimFence,
			logical, outcome.Failure, string(outcome.Billing),
			outcome.Usage.InputTokens, outcome.Usage.OutputTokens, int64(0),
		).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return ErrConflict
		}
		return nil
	})
	return mapStoreErr(err)
}

func (s *Store) FinalizeGeneration(ctx context.Context, cmd turn.FinalizeCommand) error {
	if cmd.OwnerID <= 0 || cmd.JobID <= 0 || cmd.Text == "" {
		return ErrInvalid
	}
	genID, err := parseTurnID(cmd.TurnID)
	if err != nil {
		return err
	}
	attemptID, err := parseTurnID(cmd.AttemptID)
	if err != nil {
		return err
	}
	stored, err := s.encryptStored(cmd.Text)
	if err != nil {
		return errStore
	}
	err = s.WithOwner(ctx, cmd.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var gid, msgID int64
		var finalized bool
		if err := tx.QueryRow(ctx,
			`SELECT out_generation_id, out_assistant_message_id, out_finalized
			   FROM vc.go_finalize_generation($1,$2,$3,$4,$5,$6,$7)`,
			cmd.OwnerID, genID, attemptID, cmd.JobID, cmd.ClaimToken, cmd.ClaimFence, stored,
		).Scan(&gid, &msgID, &finalized); err != nil {
			return err
		}
		return nil
	})
	return mapStoreErr(err)
}

// TerminalizeGeneration persists a terminal phase and returns the durable
// terminal status actually stored. vc.go_terminalize_generation is idempotent:
// when a concurrent path already persisted a terminal state it returns that
// state, which may differ from the requested phase. An empty result means no
// status came back and callers must reconcile against the snapshot.
func (s *Store) TerminalizeGeneration(ctx context.Context, cmd turn.TerminalCommand) (string, error) {
	if cmd.OwnerID <= 0 {
		return "", ErrInvalid
	}
	genID, err := parseTurnID(cmd.TurnID)
	if err != nil {
		return "", err
	}
	phase := string(cmd.Phase)
	var status string
	err = s.WithOwner(ctx, cmd.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var token, fence *string
		if cmd.ClaimToken != "" {
			token = &cmd.ClaimToken
			fence = &cmd.ClaimFence
		}
		var scanned *string
		if err := tx.QueryRow(ctx,
			`SELECT vc.go_terminalize_generation($1,$2,$3,$4,$5,$6,$7)`,
			cmd.OwnerID, genID, cmd.JobID, token, fence, phase, cmd.Reason,
		).Scan(&scanned); err != nil {
			return err
		}
		if scanned != nil {
			status = *scanned
		}
		return nil
	})
	if err != nil {
		return "", mapStoreErr(err)
	}
	return status, nil
}

func mapLogicalStatus(s companion.AttemptStatus) string {
	switch s {
	case companion.AttemptSucceeded:
		return "SUCCEEDED"
	case companion.AttemptTimedOut:
		return "TIMED_OUT"
	case companion.AttemptCancelled:
		return "CANCELLED"
	case companion.AttemptOutcomeUnknown:
		return "OUTCOME_UNKNOWN"
	default:
		return "FAILED"
	}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

var _ turn.Store = (*Store)(nil)
var _ realtime.Snapshots = (*Store)(nil)
