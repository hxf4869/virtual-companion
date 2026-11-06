package postgres

import (
	"context"
	"errors"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/jackc/pgx/v5"
)

// SetMemoryPin pins or unpins one owned memory that is neither forgotten nor
// superseded. Absent, foreign and inactive rows are all ErrNotFound.
func (s *Store) SetMemoryPin(ctx context.Context, owner, id int64, pinned bool) error {
	var ok bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.memory_set_pin($1,$2,$3)`, owner, id, pinned).Scan(&ok)
	})
	if err != nil {
		return mapStoreErr(err)
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// Favorite is one saved message snapshot. It is never read into memory or prompts.
type Favorite struct {
	ID             int64
	RelationshipID int64
	ChatFile       string
	MesID          int
	Role           string
	MessageAt      *time.Time
	Body           string
	CreatedAt      time.Time
}

// FavoriteWrite is the client-supplied snapshot and source position.
type FavoriteWrite struct {
	ChatFile  string
	MesID     int
	Role      string
	MessageAt *time.Time
	Body      string
}

func (s *Store) CreateFavorite(ctx context.Context, owner, relationshipID int64, in FavoriteWrite) (Favorite, error) {
	in.ChatFile, in.Body = strings.TrimSpace(in.ChatFile), strings.TrimSpace(in.Body)
	if in.ChatFile == "" || utf8.RuneCountInString(in.ChatFile) > 256 || in.MesID < 0 ||
		(in.Role != "user" && in.Role != "character") || in.Body == "" {
		return Favorite{}, ErrInvalid
	}
	if utf8.RuneCountInString(in.Body) > 2000 {
		in.Body = string([]rune(in.Body)[:2000])
	}
	var out Favorite
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.create_favorite($1,$2,$3,$4,$5,$6,$7)`,
			owner, relationshipID, in.ChatFile, in.MesID, in.Role, in.MessageAt, in.Body).Scan(&id); err != nil {
			return err
		}
		return scanFavorite(tx.QueryRow(ctx, favoriteSelect+` WHERE owner_user_id=$1 AND id=$2`, owner, id), &out)
	})
	return out, mapStoreErr(err)
}

// ListFavorites pages newest first. after is the last favorite id already seen.
func (s *Store) ListFavorites(ctx context.Context, owner, relationshipID, after int64, limit int) ([]Favorite, string, error) {
	if limit < 1 || limit > 100 || after < 0 {
		return nil, "", ErrInvalid
	}
	out := []Favorite{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.relationship WHERE owner_user_id=$1 AND id=$2)`, owner, relationshipID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		rows, err := tx.Query(ctx, favoriteSelect+`
			 WHERE owner_user_id=$1 AND relationship_id=$2 AND ($3=0 OR id<$3)
			 ORDER BY id DESC LIMIT $4`, owner, relationshipID, after, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var f Favorite
			if err := scanFavorite(rows, &f); err != nil {
				return err
			}
			out = append(out, f)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, "", mapStoreErr(err)
	}
	next := ""
	if len(out) > limit {
		out = out[:limit]
		next = strconv.FormatInt(out[len(out)-1].ID, 10)
	}
	return out, next, nil
}

func (s *Store) DeleteFavorite(ctx context.Context, owner, id int64) error {
	var ok bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.delete_favorite($1,$2)`, owner, id).Scan(&ok)
	})
	if err != nil {
		return mapStoreErr(err)
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

const favoriteSelect = `SELECT id, relationship_id, chat_file, mes_id, role, message_at, body, created_at FROM vc.favorite`

func scanFavorite(row pgx.Row, f *Favorite) error {
	return row.Scan(&f.ID, &f.RelationshipID, &f.ChatFile, &f.MesID, &f.Role, &f.MessageAt, &f.Body, &f.CreatedAt)
}

// DueReminder is one ACTIVE vc.reminder whose instant has passed.
type DueReminder struct {
	ID       int64
	Text     string
	RemindAt time.Time
	CharName string
	UserName string
}

// reminderFreshness: a reminder later than this is consumed without a message.
const reminderFreshness = 2 * time.Hour

const reminderRetryGap = 10 * time.Minute

func reminderCooldownKey(id int64) string {
	// V271 permits only letters, colons and underscores; encode digits as a..j.
	return "reminder:" + strings.Map(func(r rune) rune { return 'a' + r - '0' }, strconv.FormatInt(id, 10))
}

// NextDueReminder returns the oldest still-fresh due reminder outside retry
// cooldown. Older reminders are consumed silently, even during cooldown.
func (s *Store) NextDueReminder(ctx context.Context, owner, relationshipID int64, now time.Time) (*DueReminder, error) {
	var found *DueReminder
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT vc.prune_reminder_cooldowns($1,$2,$3)`, owner, relationshipID, now); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT out_id, out_text, out_remind_at FROM vc.due_reminders($1,$2,$3)`, owner, relationshipID, now)
		if err != nil {
			return err
		}
		var due []DueReminder
		for rows.Next() {
			var r DueReminder
			if err := rows.Scan(&r.ID, &r.Text, &r.RemindAt); err != nil {
				rows.Close()
				return err
			}
			due = append(due, r)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		cooldowns, err := loadCooldownsTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		for _, r := range due {
			if now.Sub(r.RemindAt) > reminderFreshness {
				if _, err := tx.Exec(ctx, `SELECT vc.consume_reminder($1,$2,$3)`, owner, r.ID, now); err != nil {
					return err
				}
				continue
			}
			if now.Before(cooldowns[reminderCooldownKey(r.ID)]) {
				continue
			}
			if found == nil {
				pick := r
				found = &pick
			}
		}
		if found == nil {
			return nil
		}
		var charName, userName *string
		if err := tx.QueryRow(ctx, `SELECT companion_name, user_address_as FROM vc.relationship WHERE owner_user_id=$1 AND id=$2`,
			owner, relationshipID).Scan(&charName, &userName); err != nil {
			return err
		}
		found.CharName, found.UserName = valueOrEmpty(charName), valueOrEmpty(userName)
		return nil
	})
	return found, mapStoreErr(err)
}

// BeginReminderAttempt records cooldown before the model call, including failed
// or cancelled calls. Concurrent passes may start only one attempt per gap.
func (s *Store) BeginReminderAttempt(ctx context.Context, owner, relationshipID, reminderID int64, now time.Time) (bool, error) {
	if reminderID <= 0 {
		return false, ErrInvalid
	}
	key := reminderCooldownKey(reminderID)
	started := false
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		lockKey := strconv.FormatInt(owner, 10) + ":" + strconv.FormatInt(relationshipID, 10) + ":" + key
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, lockKey); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT vc.prune_reminder_cooldowns($1,$2,$3)`, owner, relationshipID, now); err != nil {
			return err
		}
		cooldowns, err := loadCooldownsTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		if now.Before(cooldowns[key]) {
			return nil
		}
		if _, err := tx.Exec(ctx, `SELECT vc.save_proactive_cooldown($1,$2,$3,$4)`, owner, relationshipID, key, now.Add(reminderRetryGap)); err != nil {
			return err
		}
		started = true
		return nil
	})
	return started, mapStoreErr(err)
}

// SaveReminderMessage files the generated body as a READY proactive message and
// consumes the reminder in the same transaction, so a repeated pass cannot
// deliver it twice. ErrConflict means another pass already consumed it.
func (s *Store) SaveReminderMessage(ctx context.Context, owner, relationshipID int64, reminder DueReminder, body string, at time.Time) error {
	plan := proactive.ReminderPlan(reminder.RemindAt)
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var ok bool
		if err := tx.QueryRow(ctx, `SELECT vc.consume_reminder($1,$2,$3)`, owner, reminder.ID, at).Scan(&ok); err != nil {
			return err
		}
		if !ok {
			return ErrConflict
		}
		return saveProactivePlanTx(ctx, tx, owner, relationshipID, plan, body, at)
	})
	return mapFollowUpErr(err)
}

// DiaryInput is what the nightly pass needs for one relationship.
type DiaryInput struct {
	Day      string // local date YYYY-MM-DD
	Vibe     string
	CharName string
	UserName string
	Turns    string // that day's transcript, clipped, oldest first
}

// ListDiaryTargets returns relationships with companion chat activity since the given instant.
func (s *Store) ListDiaryTargets(ctx context.Context, since time.Time) ([]FollowUpSyncTarget, error) {
	var out []FollowUpSyncTarget
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT out_owner, out_relationship FROM vc.list_diary_targets($1)`, since)
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
	return out, mapStoreErr(err)
}

const (
	diaryCooldownKey   = "diary:attempt"
	diaryMinUserTurns  = 1
	diaryTranscriptCap = 24 // most recent messages of the day that enter the prompt
)

// LoadDiaryInput returns nil when no page is due: before the evening hour, an
// entry already exists, this local day was already attempted, or the day had no user turn.
func (s *Store) LoadDiaryInput(ctx context.Context, owner, relationshipID int64, now time.Time) (*DiaryInput, error) {
	var out *DiaryInput
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		policy, err := scanProactivePolicy(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		loc := proactive.Zone(valueOrEmpty(policy.QuietHoursTimezone))
		local := now.In(loc)
		if !diaryDue(local, valueOrEmpty(policy.QuietHoursStart)) {
			return nil
		}
		day := local.Format("2006-01-02")
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.diary_entry WHERE owner_user_id=$1 AND relationship_id=$2 AND day=$3::date)`,
			owner, relationshipID, day).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return nil
		}
		cooldowns, err := loadCooldownsTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		if until, ok := cooldowns[diaryCooldownKey]; ok && now.Before(until) {
			return nil
		}
		start, end := localDay(now, loc)
		rows, err := tx.Query(ctx, `
			SELECT s.role, s.content_cipher
			  FROM vc.st_message_source s
			  JOIN vc.conversation c ON c.owner_user_id=s.owner_user_id AND c.id=s.conversation_id
			 WHERE s.owner_user_id=$1 AND c.relationship_id=$2
			   AND s.present AND NOT s.suppressed AND s.role IN ('user','assistant')
			   AND s.source_timestamp >= $3 AND s.source_timestamp < $4
			   AND c.st_mode='COMPANION' AND NOT c.incognito
			 ORDER BY s.source_timestamp DESC, s.source_position DESC, s.id DESC
			 LIMIT $5`, owner, relationshipID, start, end, diaryTranscriptCap)
		if err != nil {
			return err
		}
		type turn struct{ role, text string }
		var got []turn
		userTurns := 0
		for rows.Next() {
			var t turn
			if err := rows.Scan(&t.role, &t.text); err != nil {
				rows.Close()
				return err
			}
			if t.role == "user" {
				userTurns++
			}
			got = append(got, t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if userTurns < diaryMinUserTurns {
			return nil
		}
		affect, err := loadCompanionAffectTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		mood, err := ensureMoodTx(ctx, tx, owner, relationshipID, now, loc, affect)
		if err != nil {
			return err
		}
		var charName, userName *string
		if err := tx.QueryRow(ctx, `SELECT companion_name, user_address_as FROM vc.relationship WHERE owner_user_id=$1 AND id=$2`,
			owner, relationshipID).Scan(&charName, &userName); err != nil {
			return err
		}
		var lines []string
		for i := len(got) - 1; i >= 0; i-- {
			label := "你"
			if got[i].role == "user" {
				label = "用户"
			}
			lines = append(lines, label+"："+clipRunes(got[i].text, 120))
		}
		out = &DiaryInput{Day: day, Vibe: mood.Vibe, CharName: valueOrEmpty(charName), UserName: valueOrEmpty(userName), Turns: strings.Join(lines, "\n")}
		return nil
	})
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	return out, mapFollowUpErr(err)
}

// diaryDue: one hour before the quiet window starts, or 22:00 without one.
// A slot before 06:00 belongs to the previous night; use the evening default.
func diaryDue(local time.Time, quietStart string) bool {
	hour, minute := 22, 0
	if h, m, ok := parseClock(quietStart); ok {
		hour, minute = h, m
		minute -= 60
		for minute < 0 {
			minute += 60
			hour--
		}
		if hour < 6 {
			hour, minute = 22, 0
		}
	}
	return local.Hour()*60+local.Minute() >= hour*60+minute
}

func parseClock(value string) (int, int, bool) {
	if len(value) != 5 || value[2] != ':' {
		return 0, 0, false
	}
	h, errH := strconv.Atoi(value[:2])
	m, errM := strconv.Atoi(value[3:])
	if errH != nil || errM != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, false
	}
	return h, m, true
}

// NoteDiaryAttempt holds further tries until the next local midnight, whether or
// not the model produced a page.
func (s *Store) NoteDiaryAttempt(ctx context.Context, owner, relationshipID int64, now time.Time) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		policy, err := scanProactivePolicy(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		_, end := localDay(now, proactive.Zone(valueOrEmpty(policy.QuietHoursTimezone)))
		_, err = tx.Exec(ctx, `SELECT vc.save_proactive_cooldown($1,$2,$3,$4)`, owner, relationshipID, diaryCooldownKey, end)
		return err
	})
	return mapFollowUpErr(err)
}

// SaveDiaryEntry writes the page; a page that already exists for the day wins.
func (s *Store) SaveDiaryEntry(ctx context.Context, owner, relationshipID int64, day, body, vibe string, moments []string) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.insert_diary_entry($1,$2,$3::date,$4,$5,$6)`, owner, relationshipID, day, body, vibe, moments)
		return err
	})
	return mapStoreErr(err)
}

// DiaryEntry is one page of the character's diary.
type DiaryEntry struct {
	ID             int64
	RelationshipID int64
	Day            string
	Body           string
	Vibe           string
	Moments        []string
	CreatedAt      time.Time
}

const diarySelect = `SELECT id, relationship_id, to_char(day,'YYYY-MM-DD'), body, vibe, moments, created_at FROM vc.diary_entry`

func scanDiary(row pgx.Row, d *DiaryEntry) error {
	return row.Scan(&d.ID, &d.RelationshipID, &d.Day, &d.Body, &d.Vibe, &d.Moments, &d.CreatedAt)
}

// ListDiaryMonth returns the pages of one month (YYYY-MM), oldest first.
func (s *Store) ListDiaryMonth(ctx context.Context, owner, relationshipID int64, month string) ([]DiaryEntry, error) {
	first, err := time.Parse("2006-01", month)
	if err != nil {
		return nil, ErrInvalid
	}
	out := []DiaryEntry{}
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.relationship WHERE owner_user_id=$1 AND id=$2)`, owner, relationshipID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		rows, err := tx.Query(ctx, diarySelect+` WHERE owner_user_id=$1 AND relationship_id=$2 AND day >= $3::date AND day < $4::date ORDER BY day`,
			owner, relationshipID, first.Format("2006-01-02"), first.AddDate(0, 1, 0).Format("2006-01-02"))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d DiaryEntry
			if err := scanDiary(rows, &d); err != nil {
				return err
			}
			out = append(out, d)
		}
		return rows.Err()
	})
	return out, mapStoreErr(err)
}

func (s *Store) GetDiaryEntry(ctx context.Context, owner, id int64) (DiaryEntry, error) {
	var d DiaryEntry
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := scanDiary(tx.QueryRow(ctx, diarySelect+` WHERE owner_user_id=$1 AND id=$2`, owner, id), &d)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	return d, mapStoreErr(err)
}

// Reminder is one vc.reminder row as the user routes show it.
type Reminder struct {
	ID             int64
	RelationshipID int64
	Text           string
	RemindAt       time.Time
	Recurrence     string
	Status         string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// CreateReminder stores a user reminder; delivery happens in the proactive pass.
func (s *Store) CreateReminder(ctx context.Context, owner, relationshipID int64, text string, remindAt time.Time, recurrence string) (Reminder, error) {
	text = strings.TrimSpace(text)
	if text == "" || utf8.RuneCountInString(text) > 500 {
		return Reminder{}, ErrInvalid
	}
	var out Reminder
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.create_reminder($1,$2,$3,$4,$5)`, owner, relationshipID, text, remindAt, recurrence).Scan(&id); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `
			SELECT out_id, out_relationship_id, out_text, out_remind_at, out_recurrence, out_status, out_created_at, out_updated_at
			  FROM vc.get_reminder($1,$2)`, owner, id).
			Scan(&out.ID, &out.RelationshipID, &out.Text, &out.RemindAt, &out.Recurrence, &out.Status, &out.CreatedAt, &out.UpdatedAt)
	})
	return out, mapStoreErr(err)
}

// ListActiveReminders returns the soonest ACTIVE reminders, at most limit (1..100).
func (s *Store) ListActiveReminders(ctx context.Context, owner, relationshipID int64, limit int) ([]Reminder, error) {
	if limit < 1 || limit > 100 {
		return nil, ErrInvalid
	}
	out := []Reminder{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.relationship WHERE owner_user_id=$1 AND id=$2)`, owner, relationshipID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		// vc_api has no table SELECT grant. Page the owner-checked function;
		// later ids may be sooner, so inspect every page while retaining limit.
		for after := int64(0); ; {
			rows, err := tx.Query(ctx, `
				SELECT out_id, out_relationship_id, out_text, out_remind_at, out_recurrence, out_status, out_created_at, out_updated_at
				  FROM vc.list_reminders($1,$2,$3,100)`, owner, relationshipID, after)
			if err != nil {
				return err
			}
			count := 0
			for rows.Next() {
				var r Reminder
				if err := rows.Scan(&r.ID, &r.RelationshipID, &r.Text, &r.RemindAt, &r.Recurrence, &r.Status, &r.CreatedAt, &r.UpdatedAt); err != nil {
					rows.Close()
					return err
				}
				after = r.ID
				count++
				if r.Status == "ACTIVE" {
					out = append(out, r)
				}
			}
			rows.Close()
			if err := rows.Err(); err != nil {
				return err
			}
			sort.Slice(out, func(i, j int) bool {
				if out[i].RemindAt.Equal(out[j].RemindAt) {
					return out[i].ID < out[j].ID
				}
				return out[i].RemindAt.Before(out[j].RemindAt)
			})
			if len(out) > limit {
				out = out[:limit]
			}
			if count < 100 {
				return nil
			}
		}
	})
	return out, mapStoreErr(err)
}

// DeleteReminder removes one owned reminder. Absent and foreign ids are ErrNotFound.
func (s *Store) DeleteReminder(ctx context.Context, owner, id int64) error {
	var ok bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.delete_reminder($1,$2)`, owner, id).Scan(&ok)
	})
	if err != nil {
		return mapStoreErr(err)
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

// RelationshipOwned is ErrNotFound unless the relationship exists for the owner.
func (s *Store) RelationshipOwned(ctx context.Context, owner, relationshipID int64) error {
	var exists bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM vc.relationship WHERE owner_user_id=$1 AND id=$2)`, owner, relationshipID).Scan(&exists)
	})
	if err != nil {
		return mapStoreErr(err)
	}
	if !exists {
		return ErrNotFound
	}
	return nil
}

// exportUX24Rows adds the owner's favorites and diary pages to the Go export
// domain, in the same shape as the API returns them.
func (s *Store) exportUX24Rows(ctx context.Context, owner int64, into map[string]any) error {
	favorites, diaries := []any{}, []any{}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, favoriteSelect+` WHERE owner_user_id=$1 ORDER BY id`, owner)
		if err != nil {
			return err
		}
		for rows.Next() {
			var f Favorite
			if err := scanFavorite(rows, &f); err != nil {
				rows.Close()
				return err
			}
			row := map[string]any{"favoriteId": strconv.FormatInt(f.ID, 10), "relationshipId": strconv.FormatInt(f.RelationshipID, 10),
				"chatFile": f.ChatFile, "mesId": f.MesID, "role": f.Role, "body": f.Body, "createdAt": f.CreatedAt.UTC().Format(time.RFC3339Nano), "messageAt": nil}
			if f.MessageAt != nil {
				row["messageAt"] = f.MessageAt.UTC().Format(time.RFC3339Nano)
			}
			favorites = append(favorites, row)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		rows, err = tx.Query(ctx, diarySelect+` WHERE owner_user_id=$1 ORDER BY id`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var d DiaryEntry
			if err := scanDiary(rows, &d); err != nil {
				return err
			}
			moments := make([]any, 0, len(d.Moments))
			for _, m := range d.Moments {
				moments = append(moments, m)
			}
			diaries = append(diaries, map[string]any{"entryId": strconv.FormatInt(d.ID, 10), "relationshipId": strconv.FormatInt(d.RelationshipID, 10),
				"day": d.Day, "body": d.Body, "vibe": d.Vibe, "moments": moments, "createdAt": d.CreatedAt.UTC().Format(time.RFC3339Nano)})
		}
		return rows.Err()
	})
	if err != nil {
		return mapStoreErr(err)
	}
	into["favorites"], into["diaryEntries"] = favorites, diaries
	return nil
}
