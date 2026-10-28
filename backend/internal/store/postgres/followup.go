package postgres

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Follow-ups are built from a saved memory time. These phrases are the whole
// verified user message, after trimming, and nothing else counts as an outcome.
var followUpOutcomePhrases = []string{
	"已经有结果了",
	"已经完成了",
	"已经做完了",
	"已经去过了",
	"不用问了",
}

var followUpClock = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)

// FollowUp is one Go-owned follow-up. TriggerAt is set only for SCHEDULED.
type FollowUp struct {
	ID                    int64
	RelationshipID        int64
	MemoryItemID          *int64
	SourceRef             *string
	SourceRevision        *int64
	Status                string
	Body                  string
	NormalizationStatus   string
	TimePrecision         *string
	ReminderRuleConfirmed bool
	EventDate             *string
	EventTime             *string
	EventTimezone         *string
	TriggerAt             *time.Time
	EventID               string
	Deliverable           string
}

// ProactivePolicy is the per-character greeting policy. A missing row is off.
type ProactivePolicy struct {
	RelationshipID           int64
	Enabled                  bool
	QuietHoursStart          *string
	QuietHoursEnd            *string
	QuietHoursTimezone       *string
	DailyLimit               int
	RecentInteractionMinutes int
	AllowedModes             []string
	OfflineCapable           bool
}

// ProactivePolicyWrite replaces one character's policy. It does not start work.
type ProactivePolicyWrite struct {
	Enabled                  bool
	QuietHoursStart          *string
	QuietHoursEnd            *string
	QuietHoursTimezone       *string
	DailyLimit               int
	RecentInteractionMinutes int
	AllowedModes             []string
	OfflineCapable           bool
}

type followUpPlan struct {
	Create        bool
	Status        string
	Normalization string
	Precision     *string
	EventDate     *string
	EventTime     *string
	EventTimezone *string
	TriggerAt     *time.Time
}

type followMemory struct {
	id      int64
	summary string
}

// planFollowUp reads the event already stored on the memory. It does not
// interpret the summary again. An unclear time, a missing timezone, or a
// date without a confirmed reminder rule stays non-triggerable.
func planFollowUp(saved *MemoryTime) followUpPlan {
	if saved == nil {
		return followUpPlan{}
	}
	switch saved.NormalizationStatus {
	case "explicit_date", "normalized", "needs_clarification":
	default:
		return followUpPlan{}
	}
	plan := followUpPlan{
		Create:        true,
		Status:        "NEEDS_CLARIFICATION",
		Normalization: saved.NormalizationStatus,
		EventDate:     cleanEventDate(saved.EventDate),
		EventTime:     cleanEventTime(saved.EventTime),
		EventTimezone: cleanZone(saved.EventTimezone),
		Precision:     cleanPrecision(saved.TimePrecision),
	}
	if plan.Precision != nil && *plan.Precision == "date" {
		plan.EventTime = nil
	}
	if saved.NormalizationStatus == "needs_clarification" || !followUpTriggerable(plan) {
		plan.Status = "NEEDS_CLARIFICATION"
		plan.TriggerAt = nil
		return plan
	}
	loc, err := time.LoadLocation(*plan.EventTimezone)
	if err != nil {
		plan.TriggerAt = nil
		return plan
	}
	at, err := time.ParseInLocation("2006-01-02 15:04", *plan.EventDate+" "+*plan.EventTime, loc)
	if err != nil {
		plan.TriggerAt = nil
		return plan
	}
	plan.Status = "SCHEDULED"
	plan.TriggerAt = &at
	return plan
}

func followUpTriggerable(plan followUpPlan) bool {
	return plan.Precision != nil && *plan.Precision == "minute" &&
		plan.EventDate != nil && plan.EventTime != nil && plan.EventTimezone != nil
}

func cleanEventDate(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	at, err := time.Parse("2006-01-02", s)
	if err != nil || at.Format("2006-01-02") != s {
		return nil
	}
	return &s
}

func cleanEventTime(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	if !followUpClock.MatchString(s) {
		return nil
	}
	return &s
}

func cleanZone(v *string) *string {
	if v == nil {
		return nil
	}
	s := strings.TrimSpace(*v)
	if s == "" {
		return nil
	}
	return &s
}

func cleanPrecision(v *string) *string {
	if v == nil {
		return nil
	}
	switch strings.TrimSpace(*v) {
	case "date":
		s := "date"
		return &s
	case "minute":
		s := "minute"
		return &s
	default:
		return nil
	}
}

func followUpHasOutcome(text string) bool {
	text = strings.TrimSpace(text)
	for _, phrase := range followUpOutcomePhrases {
		if text == phrase {
			return true
		}
	}
	return false
}

// SyncFollowUps creates or cancels follow-ups for one character from published
// memories whose source still passes the source guard. A cancelled follow-up
// is left cancelled.
func (s *Store) SyncFollowUps(ctx context.Context, owner, relationshipID int64) error {
	if relationshipID <= 0 {
		return ErrInvalid
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if err := requireFollowRelationship(ctx, tx, owner, relationshipID); err != nil {
			return err
		}
		memories, err := listFollowMemories(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		existing, err := followUpsByMemory(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		seen := map[int64]bool{}
		for _, mem := range memories {
			seen[mem.id] = true
			if err := s.syncOneFollowUp(ctx, tx, owner, relationshipID, mem, existing[mem.id]); err != nil {
				return err
			}
		}
		for memoryID, row := range existing {
			if seen[memoryID] || row.Status == "CANCELLED" {
				continue
			}
			if err := cancelFollowUpTx(ctx, tx, owner, row.ID); err != nil {
				return err
			}
		}
		return nil
	})
	return mapFollowUpErr(err)
}

func (s *Store) syncOneFollowUp(ctx context.Context, tx pgx.Tx, owner, relationshipID int64, mem followMemory, existing *FollowUp) error {
	current, err := memoryCurrentForFollowUp(ctx, tx, owner, relationshipID, mem.id)
	if err != nil {
		return err
	}
	if !current {
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	refs, err := memoryEvidenceRefs(ctx, tx, owner, mem.id)
	if err != nil {
		return err
	}
	ref, ok := oneSTEvidence(refs)
	if !ok {
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	parsed, ok := stsource.ParseRef(ref)
	if !ok {
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	guard, err := guardFollowSource(ctx, tx, owner, relationshipID, ref)
	if err != nil || !guard {
		if err != nil {
			return err
		}
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	source, ok, err := loadFollowSource(ctx, tx, owner, ref)
	if err != nil || !ok || source.revision != parsed.Revision {
		if err != nil {
			return err
		}
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	outcome, err := s.laterFollowOutcome(ctx, tx, owner, source)
	if err != nil || outcome {
		if err != nil {
			return err
		}
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	saved, err := s.readMemoryTime(ctx, tx, owner, mem.id)
	if err != nil {
		return err
	}
	plan := planFollowUp(saved)
	if !plan.Create {
		return cancelExistingFollowUp(ctx, tx, owner, existing)
	}
	body := strings.TrimSpace(mem.summary)
	if body == "" || utf8.RuneCountInString(body) > 4000 {
		return ErrInvalid
	}
	_, err = insertFollowUpTx(ctx, tx, owner, relationshipID, mem.id, ref, source.revision, body, plan)
	return err
}

func cancelExistingFollowUp(ctx context.Context, tx pgx.Tx, owner int64, existing *FollowUp) error {
	if existing == nil || existing.Status == "CANCELLED" {
		return nil
	}
	return cancelFollowUpTx(ctx, tx, owner, existing.ID)
}

type followSource struct {
	id           int64
	conversation int64
	revision     int64
	position     int
	text         string
}

func loadFollowSource(ctx context.Context, tx pgx.Tx, owner int64, ref string) (followSource, bool, error) {
	var out followSource
	err := tx.QueryRow(ctx, `
		SELECT id, conversation_id, source_revision, source_position, content_cipher
		  FROM vc.st_message_source
		 WHERE owner_user_id = $1
		   AND source_ref = $2
		   AND present AND settled AND eligible AND NOT suppressed`, owner, ref).
		Scan(&out.id, &out.conversation, &out.revision, &out.position, &out.text)
	if errors.Is(err, pgx.ErrNoRows) {
		return followSource{}, false, nil
	}
	if err != nil {
		return followSource{}, false, err
	}
	return out, true, nil
}

func (s *Store) laterFollowOutcome(ctx context.Context, tx pgx.Tx, owner int64, source followSource) (bool, error) {
	rows, err := tx.Query(ctx, `
		SELECT content_cipher
		  FROM vc.st_message_source
		 WHERE owner_user_id = $1
		   AND conversation_id = $2
		   AND present AND settled AND eligible AND NOT suppressed
		   AND role = 'user'
		   AND (source_position > $3 OR (source_position = $3 AND id > $4))
		 ORDER BY source_position, id`, owner, source.conversation, source.position, source.id)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var stored string
		if err := rows.Scan(&stored); err != nil {
			return false, err
		}
		if followUpHasOutcome(s.followSourceText(stored)) {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (s *Store) followSourceText(stored string) string {
	if s == nil || s.cipher == nil {
		return stored
	}
	plain, err := s.cipher.Decrypt(stored)
	if err != nil {
		return ""
	}
	return plain
}

func oneSTEvidence(refs []string) (string, bool) {
	if len(refs) != 1 || !strings.HasPrefix(refs[0], "st:") {
		return "", false
	}
	return refs[0], true
}

func memoryCurrentForFollowUp(ctx context.Context, tx pgx.Tx, owner, relationshipID, memoryID int64) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT vc.memory_current_for_follow_up($1,$2,$3)`, owner, relationshipID, memoryID).Scan(&ok)
	return ok, err
}

func guardFollowSource(ctx context.Context, tx pgx.Tx, owner, relationshipID int64, ref string) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT vc.guard_st_memory_source($1,$2,$3)`, owner, relationshipID, ref).Scan(&ok)
	return ok, err
}

func listFollowMemories(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) ([]followMemory, error) {
	rows, err := tx.Query(ctx, `SELECT out_id, out_summary FROM vc.list_memory($1,$2,true)`, owner, relationshipID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []followMemory{}
	for rows.Next() {
		var mem followMemory
		if err := rows.Scan(&mem.id, &mem.summary); err != nil {
			return nil, err
		}
		out = append(out, mem)
	}
	return out, rows.Err()
}

func followUpsByMemory(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (map[int64]*FollowUp, error) {
	rows, err := tx.Query(ctx, followUpSelect+` WHERE owner_user_id = $1 AND relationship_id = $2`, owner, relationshipID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]*FollowUp{}
	for rows.Next() {
		row, err := scanFollowUp(rows)
		if err != nil {
			return nil, err
		}
		if row.MemoryItemID == nil {
			continue
		}
		copied := row
		out[*row.MemoryItemID] = &copied
	}
	return out, rows.Err()
}

func insertFollowUpTx(ctx context.Context, tx pgx.Tx, owner, relationshipID, memoryID int64, ref string, revision int64, body string, plan followUpPlan) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx, `
		SELECT vc.insert_follow_up($1,$2,$3,$4,$5,$6,$7,$8,$9,false,NULLIF($10::text, '')::date,$11,$12,$13)`,
		owner, relationshipID, memoryID, ref, revision, body, plan.Status, plan.Normalization,
		plan.Precision, plan.EventDate, plan.EventTime, plan.EventTimezone, plan.TriggerAt).Scan(&id)
	return id, err
}

func (s *Store) GetProactivePolicy(ctx context.Context, owner, relationshipID int64) (ProactivePolicy, error) {
	var out ProactivePolicy
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		row, err := scanProactivePolicy(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		out = row
		return nil
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) PutProactivePolicy(ctx context.Context, owner, relationshipID int64, in ProactivePolicyWrite) (ProactivePolicy, error) {
	var out ProactivePolicy
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			SELECT vc.put_proactive_policy($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			owner, relationshipID, in.Enabled, nullIfBlankPtr(in.QuietHoursStart), nullIfBlankPtr(in.QuietHoursEnd),
			nullIfBlankPtr(in.QuietHoursTimezone), in.DailyLimit, in.RecentInteractionMinutes, in.AllowedModes, in.OfflineCapable)
		if err != nil {
			return err
		}
		out, err = scanProactivePolicy(ctx, tx, owner, relationshipID)
		return err
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) ListFollowUps(ctx context.Context, owner, relationshipID int64) ([]FollowUp, error) {
	var out []FollowUp
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if err := requireFollowRelationship(ctx, tx, owner, relationshipID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, followUpSelect+` WHERE owner_user_id = $1 AND relationship_id = $2 ORDER BY id`, owner, relationshipID)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []FollowUp{}
		for rows.Next() {
			row, err := scanFollowUp(rows)
			if err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) GetFollowUp(ctx context.Context, owner, id int64) (FollowUp, error) {
	var out FollowUp
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		row, ok, err := getFollowUpTx(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = row
		return nil
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) CancelFollowUp(ctx context.Context, owner, id int64) (FollowUp, error) {
	var out FollowUp
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if err := cancelFollowUpTx(ctx, tx, owner, id); err != nil {
			return err
		}
		row, ok, err := getFollowUpTx(ctx, tx, owner, id)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotFound
		}
		out = row
		return nil
	})
	return out, mapFollowUpErr(err)
}

func requireFollowRelationship(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) error {
	var id int64
	err := tx.QueryRow(ctx, `SELECT out_id FROM vc.get_relationship($1,$2)`, owner, relationshipID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func scanProactivePolicy(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (ProactivePolicy, error) {
	var out ProactivePolicy
	err := tx.QueryRow(ctx, `
		SELECT $2::bigint, out_enabled,
		       to_char(out_quiet_start, 'HH24:MI'),
		       to_char(out_quiet_end, 'HH24:MI'),
		       out_quiet_timezone, out_daily_limit, out_recent_interaction_minutes,
		       out_allowed_modes, out_offline_capable
		  FROM vc.get_proactive_policy($1,$2)`, owner, relationshipID).
		Scan(&out.RelationshipID, &out.Enabled, &out.QuietHoursStart, &out.QuietHoursEnd,
			&out.QuietHoursTimezone, &out.DailyLimit, &out.RecentInteractionMinutes,
			&out.AllowedModes, &out.OfflineCapable)
	if errors.Is(err, pgx.ErrNoRows) {
		return ProactivePolicy{}, ErrNotFound
	}
	if err != nil {
		return ProactivePolicy{}, err
	}
	if out.AllowedModes == nil {
		out.AllowedModes = []string{"COMPANION"}
	}
	return out, nil
}

const followUpSelect = `
	SELECT id, relationship_id, memory_item_id, source_ref, source_revision,
	       status, body, normalization_status, time_precision, reminder_rule_confirmed,
	       to_char(event_date, 'YYYY-MM-DD'), event_time, event_timezone, trigger_at,
	       event_id, deliverable
	  FROM vc.follow_up`

type followScanner interface {
	Scan(dest ...any) error
}

func scanFollowUp(row followScanner) (FollowUp, error) {
	var out FollowUp
	err := row.Scan(&out.ID, &out.RelationshipID, &out.MemoryItemID, &out.SourceRef, &out.SourceRevision,
		&out.Status, &out.Body, &out.NormalizationStatus, &out.TimePrecision, &out.ReminderRuleConfirmed,
		&out.EventDate, &out.EventTime, &out.EventTimezone, &out.TriggerAt, &out.EventID, &out.Deliverable)
	return out, err
}

func getFollowUpTx(ctx context.Context, tx pgx.Tx, owner, id int64) (FollowUp, bool, error) {
	row, err := scanFollowUp(tx.QueryRow(ctx, followUpSelect+` WHERE owner_user_id = $1 AND id = $2`, owner, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return FollowUp{}, false, nil
	}
	if err != nil {
		return FollowUp{}, false, err
	}
	return row, true, nil
}

func cancelFollowUpTx(ctx context.Context, tx pgx.Tx, owner, id int64) error {
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT vc.cancel_follow_up($1,$2)`, owner, id).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func nullIfBlankPtr(v *string) any {
	if v == nil {
		return nil
	}
	return nullIfBlank(strings.TrimSpace(*v))
}

func mapFollowUpErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23505":
			return ErrConflict
		case "P0001":
			switch {
			case strings.Contains(pgErr.Message, "not found"):
				return ErrNotFound
			case strings.Contains(pgErr.Message, "follow_up:"), strings.Contains(pgErr.Message, "proactive_policy:"):
				return ErrInvalid
			}
		}
	}
	return mapStoreErr(err)
}
