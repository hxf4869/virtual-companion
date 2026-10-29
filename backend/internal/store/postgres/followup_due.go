package postgres

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
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
// A closed policy is left as it is, SCHEDULED or DEFERRED. That does not move
// deferred_until and does not spend a generation backoff: turning proactive
// messaging off is not a failed greeting. The next open pass enqueues a row
// that is already due. The event date is not rewritten.
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

// quietUnparsedDefer is how long a stored zone Go cannot parse postpones a
// send. The window end is unknown, so the row is not treated as outside
// quiet hours.
const quietUnparsedDefer = time.Hour

// CanonicalQuietHoursZone accepts a zone only when time.LoadLocation can
// read it, and returns that location's name. A blank zone is stored as nil.
// Local is rejected because it is the process zone, not a saved name.
func CanonicalQuietHoursZone(zone *string) (*string, error) {
	if zone == nil {
		return nil, nil
	}
	name := strings.TrimSpace(*zone)
	if name == "" {
		return nil, nil
	}
	loc, err := time.LoadLocation(name)
	if err != nil || !acceptedZoneName(name) {
		return nil, ErrInvalid
	}
	canonical := loc.String()
	if canonical == "" || canonical == "Local" || canonical != name {
		return nil, ErrInvalid
	}
	return &canonical, nil
}

// acceptedZoneName is true only for the exact zoneinfo entry. LoadLocation
// on a case-insensitive filesystem also opens Asia/Shanghai for
// asia/shanghai, and String() keeps the caller's spelling. Quiet hours must
// store and read the zoneinfo name.
func acceptedZoneName(name string) bool {
	if name == "UTC" {
		return true
	}
	_, ok := zoneinfoNames()[name]
	return ok
}

var zoneinfoNames = sync.OnceValue(func() map[string]struct{} {
	names := make(map[string]struct{})
	if zone, ok := os.LookupEnv("ZONEINFO"); ok && zone != "" {
		if strings.HasSuffix(strings.ToLower(zone), ".zip") {
			addZoneinfoZip(zone, names)
		} else {
			addZoneinfoTree(zone, names)
		}
	}
	if root := runtime.GOROOT(); root != "" {
		addZoneinfoZip(filepath.Join(root, "lib", "time", "zoneinfo.zip"), names)
	}
	for _, dir := range []string{"/usr/share/zoneinfo", "/usr/share/lib/zoneinfo", "/usr/lib/locale/TZ"} {
		addZoneinfoTree(dir, names)
	}
	return names
})

func addZoneinfoTree(root string, names map[string]struct{}) {
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		return
	}
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if rel == "" || strings.HasPrefix(rel, "../") {
			return nil
		}
		names[rel] = struct{}{}
		return nil
	})
}

func addZoneinfoZip(path string, names map[string]struct{}) {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return
	}
	defer reader.Close()
	for _, file := range reader.File {
		name := filepath.ToSlash(file.Name)
		if file.FileInfo().IsDir() || name == "" || strings.HasSuffix(name, "/") {
			continue
		}
		names[name] = struct{}{}
	}
}

// followUpQuietUntil reports whether now is inside the user's quiet hours and
// the absolute instant those hours end. A window that starts after it ends
// crosses midnight. The end minute is outside the window. A zone Go cannot
// parse postpones the send.
func followUpQuietUntil(now time.Time, start, end, zone *string) (bool, time.Time) {
	if start == nil || end == nil || zone == nil {
		return false, time.Time{}
	}
	trimmed := strings.TrimSpace(*zone)
	loc, err := time.LoadLocation(trimmed)
	if err != nil || !acceptedZoneName(trimmed) {
		return true, now.Add(quietUnparsedDefer)
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
