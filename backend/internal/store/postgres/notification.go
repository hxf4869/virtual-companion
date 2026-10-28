package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	NotificationSkip  = "skip"
	NotificationStop  = "stop"
	NotificationDefer = "defer"
	NotificationSend  = "send"

	// DefaultNotificationDailyLimit is the notification send cap used when
	// the delivery view has no positive limit of its own. It is not
	// proactive_policy.daily_limit. A character with no greeting policy
	// stores 0 there; treating 0 as the notification cap would defer every
	// notice until the next local midnight and never send it.
	DefaultNotificationDailyLimit = 20
)

// NotificationDue is one pending delivery the worker may look at. It carries
// no body and no credential.
type NotificationDue struct {
	OwnerID int64
	ID      int64
}

// NotificationTarget is one enabled channel a new inbox event should notify.
type NotificationTarget struct {
	ID      int64
	Channel string
	Target  string
}

// NotificationDelivery is the send-time view of one delivery. Credential
// material is not loaded.
type NotificationDelivery struct {
	OwnerID            int64
	ID                 int64
	EventID            string
	Channel            string
	ConfiguredTarget   string
	Status             string
	AttemptCount       int
	NextAttemptAt      *time.Time
	Intent             string
	Body               *string
	Preview            bool
	RelationshipID     int64
	ChannelEnabled     bool
	PolicyEnabled      bool
	QuietHoursStart    *string
	QuietHoursEnd      *string
	QuietHoursTimezone *string
	DailyLimit         int
	ConsentGranted     bool
	DeletionActive     bool
	SentToday          int
	TriggerAt          *time.Time
	FollowStatus       string
	STDelivered        bool
	ExpiresAt          *time.Time
	// ConversationID is the inbox conversation. The login-protected link is
	// built from it. Zero means the caller has no conversation to name.
	ConversationID int64
}

// NotificationDecision is the pre-send gate. Defer changes only the delivery's
// next attempt. It does not carry a follow-up trigger.
type NotificationDecision struct {
	Action       string
	NextAttempt  *time.Time
	AttemptCount int
	StopReason   string
}

// NotificationQuietUntil reports whether now is inside the character's quiet
// hours. The window is the same one the follow-up planner stores. The end
// minute is outside the window. This does not move a follow-up trigger.
func NotificationQuietUntil(now time.Time, start, end, zone *string) (bool, time.Time) {
	return followUpQuietUntil(now, start, end, zone)
}

// NotificationNextMidnight is the next local midnight in the policy zone.
// A missing or unknown zone uses UTC, matching vc.follow_up_zone.
func NotificationNextMidnight(now time.Time, zone *string) time.Time {
	name := "UTC"
	if zone != nil && strings.TrimSpace(*zone) != "" {
		name = strings.TrimSpace(*zone)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		loc = time.UTC
	}
	local := now.In(loc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return start.AddDate(0, 0, 1)
}

// DecideNotificationSend checks the channel, quiet hours, the notification
// daily cap, deletion and the current push consent before any network call.
// A closed proactive switch does not by itself stop a channel. Quiet hours
// still come from the character policy. A non-positive DailyLimit means
// DefaultNotificationDailyLimit, not proactive_policy.daily_limit.
func DecideNotificationSend(now time.Time, row NotificationDelivery) NotificationDecision {
	if row.Status != "pending" {
		return NotificationDecision{Action: NotificationSkip}
	}
	if row.DeletionActive {
		return NotificationDecision{Action: NotificationSkip}
	}
	switch row.FollowStatus {
	case "CANCELLED":
		return NotificationDecision{Action: NotificationStop, StopReason: "cancelled"}
	}
	if row.ExpiresAt != nil && !row.ExpiresAt.After(now) {
		return NotificationDecision{Action: NotificationStop, StopReason: "expired"}
	}
	if !row.ConsentGranted {
		return NotificationDecision{Action: NotificationStop, StopReason: "consent_withdrawn"}
	}
	if !row.ChannelEnabled {
		return NotificationDecision{Action: NotificationSkip}
	}
	if quiet, until := NotificationQuietUntil(now, row.QuietHoursStart, row.QuietHoursEnd, row.QuietHoursTimezone); quiet {
		return NotificationDecision{Action: NotificationDefer, NextAttempt: &until, AttemptCount: row.AttemptCount}
	}
	if row.SentToday >= notificationDailyLimit(row.DailyLimit) {
		next := NotificationNextMidnight(now, row.QuietHoursTimezone)
		return NotificationDecision{Action: NotificationDefer, NextAttempt: &next, AttemptCount: row.AttemptCount}
	}
	return NotificationDecision{Action: NotificationSend}
}

func notificationDailyLimit(limit int) int {
	if limit <= 0 {
		return DefaultNotificationDailyLimit
	}
	return limit
}

// CreateNotificationDeliveries inserts one pending delivery for each enabled
// channel of the event's character. A disabled channel is omitted. An existing
// key returns the current id.
func (s *Store) CreateNotificationDeliveries(ctx context.Context, owner int64, eventID string) ([]NotificationTarget, error) {
	var out []NotificationTarget
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM vc.inbox_event
				 WHERE owner_user_id = $1 AND event_id = $2)`, owner, eventID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		rows, err := tx.Query(ctx, `
			SELECT c.channel, c.configured_target
			  FROM vc.inbox_event i
			  JOIN vc.notification_channel c
			    ON c.owner_user_id = i.owner_user_id
			   AND c.enabled
			   AND i.relationship_id = ANY (c.relationship_ids)
			 WHERE i.owner_user_id = $1 AND i.event_id = $2
			 ORDER BY c.id`, owner, eventID)
		if err != nil {
			return err
		}
		defer rows.Close()
		type pair struct{ channel, target string }
		var channels []pair
		for rows.Next() {
			var item pair
			if err := rows.Scan(&item.channel, &item.target); err != nil {
				return err
			}
			channels = append(channels, item)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		out = make([]NotificationTarget, 0, len(channels))
		for _, item := range channels {
			id, err := ensureNotificationDelivery(ctx, tx, owner, eventID, item.channel, item.target)
			if err != nil {
				return err
			}
			out = append(out, NotificationTarget{ID: id, Channel: item.channel, Target: item.target})
		}
		return nil
	})
	if err != nil {
		return nil, mapNotificationErr(err)
	}
	return out, nil
}

func ensureNotificationDelivery(ctx context.Context, tx pgx.Tx, owner int64, eventID, channel, target string) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx, `
		SELECT id FROM vc.notification_delivery
		 WHERE owner_user_id = $1 AND event_id = $2 AND channel = $3 AND configured_target = $4`,
		owner, eventID, channel, target).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return 0, err
	}
	if _, err := tx.Exec(ctx, "SAVEPOINT nd"); err != nil {
		return 0, err
	}
	err = tx.QueryRow(ctx, `SELECT vc.create_notification_delivery($1, $2, $3, $4)`,
		owner, eventID, channel, target).Scan(&id)
	if err == nil {
		if _, relErr := tx.Exec(ctx, "RELEASE SAVEPOINT nd"); relErr != nil {
			return 0, relErr
		}
		return id, nil
	}
	if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT nd"); rbErr != nil {
		return 0, err
	}
	if !notificationDuplicate(err) {
		return 0, err
	}
	if err := tx.QueryRow(ctx, `
		SELECT id FROM vc.notification_delivery
		 WHERE owner_user_id = $1 AND event_id = $2 AND channel = $3 AND configured_target = $4`,
		owner, eventID, channel, target).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// ListDueNotificationDeliveries returns pending deliveries whose next attempt
// is due. Owners with a deletion intent are left out so the poll does not
// write those rows.
func (s *Store) ListDueNotificationDeliveries(ctx context.Context, now time.Time) ([]NotificationDue, error) {
	var out []NotificationDue
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT out_owner, out_id
			  FROM vc.list_due_notification_deliveries($1)`, now)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []NotificationDue{}
		for rows.Next() {
			var row NotificationDue
			if err := rows.Scan(&row.OwnerID, &row.ID); err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapNotificationErr(err)
	}
	return out, nil
}

// LoadNotificationDelivery reads the facts the send gate needs.
func (s *Store) LoadNotificationDelivery(ctx context.Context, owner, id int64, now time.Time) (NotificationDelivery, error) {
	var row NotificationDelivery
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var follow *string
		err := tx.QueryRow(ctx, `
			SELECT out_id, out_event_id, out_channel, out_configured_target, out_status,
			       out_attempt_count, out_next_attempt_at, out_intent, out_body, out_preview,
			       out_relationship, out_channel_enabled, out_policy_enabled,
			       out_quiet_start, out_quiet_end, out_quiet_timezone, out_daily_limit,
			       out_consent, out_deletion, out_sent_today, out_trigger_at,
			       out_follow_status, out_st_delivered, out_expires_at
			  FROM vc.load_notification_delivery($1, $2, $3)`, owner, id, now).Scan(
			&row.ID, &row.EventID, &row.Channel, &row.ConfiguredTarget, &row.Status,
			&row.AttemptCount, &row.NextAttemptAt, &row.Intent, &row.Body, &row.Preview,
			&row.RelationshipID, &row.ChannelEnabled, &row.PolicyEnabled,
			&row.QuietHoursStart, &row.QuietHoursEnd, &row.QuietHoursTimezone, &row.DailyLimit,
			&row.ConsentGranted, &row.DeletionActive, &row.SentToday, &row.TriggerAt,
			&follow, &row.STDelivered, &row.ExpiresAt,
		)
		if err != nil {
			return err
		}
		if follow != nil {
			row.FollowStatus = *follow
		}
		row.OwnerID = owner
		// The SQL column is the greeting policy's daily_limit, including 0
		// when that policy is absent. Notifications do not borrow it.
		row.DailyLimit = DefaultNotificationDailyLimit
		return tx.QueryRow(ctx, `
			SELECT i.conversation_id
			  FROM vc.notification_delivery d
			  JOIN vc.inbox_event i
			    ON i.owner_user_id = d.owner_user_id AND i.event_id = d.event_id
			 WHERE d.owner_user_id = $1 AND d.id = $2`, owner, id).Scan(&row.ConversationID)
	})
	if err != nil {
		return NotificationDelivery{}, mapNotificationErr(err)
	}
	return row, nil
}

// RecordNotificationOutcome stores a terminal channel result. accepted is not
// an inbox ACK. The inbox row is left as it is.
func (s *Store) RecordNotificationOutcome(ctx context.Context, owner, id int64, outcome, failureCode, correlation string) (string, error) {
	var status string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT vc.record_notification_delivery_outcome($1, $2, $3, $4, $5)`,
			owner, id, outcome, nullText(failureCode), nullText(correlation)).Scan(&status)
	})
	if err != nil {
		return "", mapNotificationErr(err)
	}
	return status, nil
}

// ScheduleNotificationDelivery keeps a delivery pending and sets the next
// absolute attempt. The attempt count must not decrease.
func (s *Store) ScheduleNotificationDelivery(ctx context.Context, owner, id int64, attempt int, next time.Time) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.schedule_notification_delivery($1, $2, $3, $4)`, owner, id, attempt, next)
		return err
	})
	return mapNotificationErr(err)
}

// StopNotificationDeliveries stops pending deliveries for one event, or for
// every event when eventID is nil.
func (s *Store) StopNotificationDeliveries(ctx context.Context, owner int64, eventID *string, reason string) (int, error) {
	var n int
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.stop_unsent_notification_deliveries($1, $2, $3)`, owner, eventID, reason).Scan(&n)
	})
	if err != nil {
		return 0, mapNotificationErr(err)
	}
	return n, nil
}

// NotificationChannel is one saved target. The credential is never copied
// into this view.
type NotificationChannel struct {
	ID               int64
	Channel          string
	Enabled          bool
	ConfiguredTarget string
	PreviewBody      bool
	RelationshipIDs  []int64
}

// NotificationChannelInput is a channel write. CredentialMode is keep, clear
// or set. set encrypts CredentialPlain with the field cipher. keep reads the
// stored ciphertext and writes it back. clear stores null. An omitted HTTP
// credential is keep, so a later save does not wipe the secret.
type NotificationChannelInput struct {
	Channel          string
	Enabled          bool
	ConfiguredTarget string
	PreviewBody      bool
	RelationshipIDs  []int64
	CredentialMode   string
	CredentialPlain  string
}

// NotificationDeliveryList is the owner-facing delivery row. It has no body
// and no credential.
type NotificationDeliveryList struct {
	ID               int64
	EventID          string
	Channel          string
	ConfiguredTarget string
	Status           string
	AttemptCount     int
	NextAttemptAt    *time.Time
	CorrelationID    *string
	FailureCode      *string
	StoppedReason    *string
}

// PutNotificationChannel stores one channel. The plaintext credential is
// encrypted here and is not returned.
func (s *Store) PutNotificationChannel(ctx context.Context, owner int64, in NotificationChannelInput) (NotificationChannel, error) {
	if strings.TrimSpace(in.ConfiguredTarget) == "" || strings.Contains(strings.ToLower(in.ConfiguredTarget), "://") {
		return NotificationChannel{}, ErrInvalid
	}
	if in.CredentialMode == "set" && in.CredentialPlain == "" {
		return NotificationChannel{}, ErrInvalid
	}
	var out NotificationChannel
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		cipher, err := notificationCredentialArg(ctx, tx, s, owner, in)
		if err != nil {
			return err
		}
		var id int64
		if err := tx.QueryRow(ctx, `SELECT vc.put_notification_channel($1,$2,$3,$4,$5,$6,$7)`,
			owner, in.Channel, in.Enabled, in.ConfiguredTarget, cipher, in.PreviewBody, in.RelationshipIDs).Scan(&id); err != nil {
			return err
		}
		return scanNotificationChannel(ctx, tx, owner, id, &out)
	})
	if err != nil {
		return NotificationChannel{}, mapNotificationErr(err)
	}
	return out, nil
}

func notificationCredentialArg(ctx context.Context, tx pgx.Tx, s *Store, owner int64, in NotificationChannelInput) (any, error) {
	switch in.CredentialMode {
	case "clear":
		return nil, nil
	case "set":
		stored, err := s.encryptStored(in.CredentialPlain)
		if err != nil || !IsEncrypted(stored) {
			return nil, ErrInvalid
		}
		return stored, nil
	default:
		var existing *string
		err := tx.QueryRow(ctx, `
			SELECT credential_cipher FROM vc.notification_channel
			 WHERE owner_user_id = $1 AND channel = $2 AND configured_target = $3`,
			owner, in.Channel, in.ConfiguredTarget).Scan(&existing)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if existing == nil {
			return nil, nil
		}
		return *existing, nil
	}
}

func scanNotificationChannel(ctx context.Context, tx pgx.Tx, owner, id int64, out *NotificationChannel) error {
	var rels []int64
	err := tx.QueryRow(ctx, `
		SELECT id, channel, enabled, configured_target, preview_body, relationship_ids
		  FROM vc.notification_channel
		 WHERE owner_user_id = $1 AND id = $2`, owner, id).Scan(
		&out.ID, &out.Channel, &out.Enabled, &out.ConfiguredTarget, &out.PreviewBody, &rels)
	if err != nil {
		return err
	}
	if rels == nil {
		rels = []int64{}
	}
	out.RelationshipIDs = rels
	return nil
}

// ListNotificationChannels returns the owner's channels without credentials.
func (s *Store) ListNotificationChannels(ctx context.Context, owner int64) ([]NotificationChannel, error) {
	var out []NotificationChannel
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, channel, enabled, configured_target, preview_body, relationship_ids
			  FROM vc.notification_channel
			 WHERE owner_user_id = $1
			 ORDER BY id`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []NotificationChannel{}
		for rows.Next() {
			var row NotificationChannel
			var rels []int64
			if err := rows.Scan(&row.ID, &row.Channel, &row.Enabled, &row.ConfiguredTarget, &row.PreviewBody, &rels); err != nil {
				return err
			}
			if rels == nil {
				rels = []int64{}
			}
			row.RelationshipIDs = rels
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapNotificationErr(err)
	}
	return out, nil
}

// ListNotificationDeliveries returns delivery status without a body or a credential.
func (s *Store) ListNotificationDeliveries(ctx context.Context, owner int64) ([]NotificationDeliveryList, error) {
	var out []NotificationDeliveryList
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT id, event_id, channel, configured_target, status, attempt_count,
			       next_attempt_at, correlation_id, failure_code, stopped_reason
			  FROM vc.notification_delivery
			 WHERE owner_user_id = $1
			 ORDER BY id`, owner)
		if err != nil {
			return err
		}
		defer rows.Close()
		out = []NotificationDeliveryList{}
		for rows.Next() {
			var row NotificationDeliveryList
			if err := rows.Scan(&row.ID, &row.EventID, &row.Channel, &row.ConfiguredTarget, &row.Status,
				&row.AttemptCount, &row.NextAttemptAt, &row.CorrelationID, &row.FailureCode, &row.StoppedReason); err != nil {
				return err
			}
			out = append(out, row)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, mapNotificationErr(err)
	}
	return out, nil
}

// LoadNotificationCredential decrypts the channel row for this target.
// A missing row or a null cipher is an empty string. The caller records that
// as a closed failure and does not try another channel or a process secret.
func (s *Store) LoadNotificationCredential(ctx context.Context, owner int64, channel, target string) (string, error) {
	var stored *string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			SELECT credential_cipher FROM vc.notification_channel
			 WHERE owner_user_id = $1 AND channel = $2 AND configured_target = $3`,
			owner, channel, target).Scan(&stored)
		if errors.Is(err, pgx.ErrNoRows) {
			stored = nil
			return nil
		}
		return err
	})
	if err != nil {
		return "", mapNotificationErr(err)
	}
	if stored == nil || *stored == "" {
		return "", nil
	}
	plain, err := s.decryptStored(*stored)
	if err != nil {
		return "", errStore
	}
	return plain, nil
}

// ClearNotificationDomain deletes this owner's deliveries and channels only
// while a deletion intent is active. Otherwise the rows stay pending.
func (s *Store) ClearNotificationDomain(ctx context.Context, owner int64) (bool, error) {
	return s.clearCurrentDomain(ctx, owner, `SELECT vc.clear_notification_domain_current()`)
}

// ClearInboxDomain deletes this owner's inbox rows only while a deletion
// intent is active. Call it after the notification domain so the delivery
// foreign key is already gone.
func (s *Store) ClearInboxDomain(ctx context.Context, owner int64) (bool, error) {
	return s.clearCurrentDomain(ctx, owner, `SELECT vc.clear_inbox_domain_current()`)
}

func (s *Store) clearCurrentDomain(ctx context.Context, owner int64, query string) (bool, error) {
	var done bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, query).Scan(&done)
	})
	if err != nil {
		return false, mapStoreErr(err)
	}
	return done, nil
}

func nullText(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func notificationDuplicate(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "P0001" &&
		(strings.Contains(pgErr.Message, "duplicate") || strings.Contains(pgErr.Message, "already exists"))
}

func mapNotificationErr(err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" {
		msg := pgErr.Message
		switch {
		case strings.Contains(msg, "duplicate"), strings.Contains(msg, "already exists"):
			return ErrConflict
		case strings.Contains(msg, "consent is not current"),
			strings.Contains(msg, "not enabled"),
			strings.Contains(msg, "schedule is invalid"),
			strings.Contains(msg, "target is invalid"),
			strings.Contains(msg, "must not carry a URL"),
			strings.Contains(msg, "credential must be field ciphertext"),
			strings.Contains(msg, "relationship not found"):
			return ErrInvalid
		}
	}
	return mapStoreErr(err)
}
