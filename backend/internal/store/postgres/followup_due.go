package postgres

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	FollowUpDueLeave   = "leave"
	FollowUpDueEnqueue = "enqueue"
	FollowUpDueSilent  = "silent"
	FollowUpDueDefer   = "defer"
)

// FollowUpSyncTarget is one character whose published memories or live
// follow-ups the due pass should sync.
type FollowUpSyncTarget struct {
	OwnerID        int64
	RelationshipID int64
}

// FollowUpDueFacts is one due follow-up plus the policy and source facts the
// decision needs. Event fields are the stored plan.
type FollowUpDueFacts struct {
	OwnerID                  int64
	ID                       int64
	RelationshipID           int64
	Status                   string
	EventDate                *string
	EventTime                *string
	EventTimezone            *string
	TriggerAt                *time.Time
	DeferredUntil            *time.Time
	sourceRef                string
	PolicyEnabled            bool
	QuietHoursStart          *string
	QuietHoursEnd            *string
	QuietHoursTimezone       *string
	DailyLimit               int
	RecentInteractionMinutes int
	AllowedModes             []string
	ConversationMode         string
	LastInteraction          *time.Time
	SentToday                int
	Asked                    bool
	TopicResolved            bool
	ConversationChanged      bool
	AlreadyQueued            bool
}

// FollowUpDueDecision is the stored plan plus the action to apply. Defer is
// the only action that carries a next instant. The event fields are copies.
type FollowUpDueDecision struct {
	Action        string
	DeferredUntil *time.Time
	EventDate     *string
	EventTime     *string
	EventTimezone *string
	TriggerAt     *time.Time
}

// DecideFollowUpDue chooses leave, defer, silent, or enqueue. Quiet hours and
// the recent-interaction window use the user's zone and an absolute instant.
// A closed policy stays scheduled. The event date is not rewritten.
func DecideFollowUpDue(now time.Time, in FollowUpDueFacts) FollowUpDueDecision {
	if followUpNotDue(now, in) || in.Asked || in.AlreadyQueued || !in.PolicyEnabled || in.TopicResolved {
		return duePlan(FollowUpDueLeave, nil, in)
	}
	if in.ConversationChanged || !followUpModeAllowed(in.ConversationMode, in.AllowedModes) {
		return duePlan(FollowUpDueSilent, nil, in)
	}
	if quiet, until := followUpQuietUntil(now, in.QuietHoursStart, in.QuietHoursEnd, in.QuietHoursTimezone); quiet {
		return duePlan(FollowUpDueDefer, &until, in)
	}
	if recent, until := followUpRecentUntil(now, in.RecentInteractionMinutes, in.LastInteraction); recent {
		return duePlan(FollowUpDueDefer, &until, in)
	}
	if in.SentToday >= in.DailyLimit {
		return duePlan(FollowUpDueSilent, nil, in)
	}
	return duePlan(FollowUpDueEnqueue, nil, in)
}

func (s *Store) ListFollowUpSyncTargets(ctx context.Context) ([]FollowUpSyncTarget, error) {
	var out []FollowUpSyncTarget
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_owner, out_relationship
			  FROM vc.list_follow_up_sync_targets()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []FollowUpSyncTarget{}
		for rows.Next() {
			var row FollowUpSyncTarget
			if err := rows.Scan(&row.OwnerID, &row.RelationshipID); err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) ListDueFollowUps(ctx context.Context, now time.Time) ([]FollowUpDueFacts, error) {
	var out []FollowUpDueFacts
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_owner, out_id, out_relationship, out_status,
			       out_event_date, out_event_time, out_event_timezone,
			       out_trigger_at, out_deferred_until, out_source_ref,
			       out_enabled, out_quiet_start, out_quiet_end, out_quiet_timezone,
			       out_daily_limit, out_recent_minutes, out_allowed_modes, out_mode,
			       out_changed, out_last_interaction, out_sent_today, out_queued, out_asked
			  FROM vc.list_due_follow_ups($1)`, now)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []FollowUpDueFacts{}
		for rows.Next() {
			var row FollowUpDueFacts
			var source *string
			if err := rows.Scan(
				&row.OwnerID, &row.ID, &row.RelationshipID, &row.Status,
				&row.EventDate, &row.EventTime, &row.EventTimezone,
				&row.TriggerAt, &row.DeferredUntil, &source,
				&row.PolicyEnabled, &row.QuietHoursStart, &row.QuietHoursEnd, &row.QuietHoursTimezone,
				&row.DailyLimit, &row.RecentInteractionMinutes, &row.AllowedModes, &row.ConversationMode,
				&row.ConversationChanged, &row.LastInteraction, &row.SentToday, &row.AlreadyQueued, &row.Asked,
			); err != nil {
				return err
			}
			if source != nil {
				row.sourceRef = *source
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapFollowUpErr(err)
	}
	for i := range out {
		if err := s.enrichFollowUpDue(ctx, &out[i]); err != nil {
			return nil, mapFollowUpErr(err)
		}
	}
	return out, nil
}

func (s *Store) enrichFollowUpDue(ctx context.Context, row *FollowUpDueFacts) error {
	if row == nil || row.sourceRef == "" {
		return nil
	}
	return s.WithOwner(ctx, row.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		source, ok, err := loadFollowSource(ctx, tx, row.OwnerID, row.sourceRef)
		if err != nil || !ok {
			return err
		}
		row.TopicResolved, err = s.laterFollowOutcome(ctx, tx, row.OwnerID, source)
		return err
	})
}

// ApplyFollowUpDue writes one decision. The bool is true only when this call
// inserts a new FOLLOW_UP job. Leave and a repeated enqueue do not.
func (s *Store) ApplyFollowUpDue(ctx context.Context, owner, id int64, decision FollowUpDueDecision) (bool, error) {
	var created bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT out_created
			  FROM vc.apply_follow_up_due($1,$2,$3,$4)`,
			owner, id, decision.Action, decision.DeferredUntil).Scan(&created)
	})
	return created, mapFollowUpErr(err)
}

func followUpNotDue(now time.Time, in FollowUpDueFacts) bool {
	switch in.Status {
	case "SCHEDULED":
		return in.TriggerAt == nil || in.TriggerAt.After(now)
	case "DEFERRED":
		return in.DeferredUntil != nil && in.DeferredUntil.After(now)
	default:
		return true
	}
}

func followUpModeAllowed(mode string, allowed []string) bool {
	if mode == "" {
		return true
	}
	if len(allowed) == 0 {
		allowed = []string{"COMPANION"}
	}
	for _, item := range allowed {
		if item == mode {
			return true
		}
	}
	return false
}

// followUpQuietUntil reports whether now is inside the user's quiet hours and
// the absolute instant those hours end. A window that starts after it ends
// crosses midnight. The end minute is outside the window.
func followUpQuietUntil(now time.Time, start, end, zone *string) (bool, time.Time) {
	if start == nil || end == nil || zone == nil {
		return false, time.Time{}
	}
	loc, err := time.LoadLocation(strings.TrimSpace(*zone))
	if err != nil {
		return false, time.Time{}
	}
	sh, sm, okStart := followUpHourMinute(*start)
	eh, em, okEnd := followUpHourMinute(*end)
	if !okStart || !okEnd || (sh == eh && sm == em) {
		return false, time.Time{}
	}
	local := now.In(loc)
	startAt := time.Date(local.Year(), local.Month(), local.Day(), sh, sm, 0, 0, loc)
	endAt := time.Date(local.Year(), local.Month(), local.Day(), eh, em, 0, 0, loc)
	if !startAt.Before(endAt) {
		if !local.Before(startAt) {
			return true, endAt.AddDate(0, 0, 1)
		}
		if local.Before(endAt) {
			return true, endAt
		}
		return false, time.Time{}
	}
	if !local.Before(startAt) && local.Before(endAt) {
		return true, endAt
	}
	return false, time.Time{}
}

func followUpRecentUntil(now time.Time, minutes int, last *time.Time) (bool, time.Time) {
	if minutes <= 0 || last == nil {
		return false, time.Time{}
	}
	until := last.Add(time.Duration(minutes) * time.Minute)
	if now.Before(until) {
		return true, until
	}
	return false, time.Time{}
}

func followUpHourMinute(value string) (int, int, bool) {
	value = strings.TrimSpace(value)
	if len(value) != 5 || value[2] != ':' {
		return 0, 0, false
	}
	hour, errHour := strconv.Atoi(value[:2])
	minute, errMinute := strconv.Atoi(value[3:])
	if errHour != nil || errMinute != nil || hour > 23 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

func duePlan(action string, until *time.Time, in FollowUpDueFacts) FollowUpDueDecision {
	return FollowUpDueDecision{
		Action:        action,
		DeferredUntil: copyDueTime(until),
		EventDate:     copyDueString(in.EventDate),
		EventTime:     copyDueString(in.EventTime),
		EventTimezone: copyDueString(in.EventTimezone),
		TriggerAt:     copyDueTime(in.TriggerAt),
	}
}

func copyDueString(value *string) *string {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func copyDueTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}
