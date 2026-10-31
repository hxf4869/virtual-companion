package postgres

import (
	"context"
	"errors"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/hxf4869/virtual-companion/internal/proactive"
	"github.com/hxf4869/virtual-companion/internal/voice"
	"github.com/jackc/pgx/v5"
)

// ErrProactiveNoConversation means a due body has no companion chat to file into.
var ErrProactiveNoConversation = errors.New("proactive conversation missing")

// CompanionState is the read model for GET companion-state.
type CompanionState struct {
	MoodTier    string
	MoodVibe    string
	MoodLine    string
	EmotionLine string
	Closeness   int
	Mood        int
	Energy      int
	BusyUntil   *time.Time
}

// ProactiveRunResult is one forced or scheduled pass for a relationship.
type ProactiveRunResult struct {
	Outcome string
	Reason  string
	EventID string
}

// ProactiveReady is one pre-generated body waiting for its send time.
type ProactiveReady struct {
	ID       int64
	Reminder bool
	Body     string
	Planned  time.Time
	Armed    time.Time
}

// ProactiveContext is the pure-engine snapshot plus the last judgment instant.
type ProactiveContext struct {
	World        proactive.World
	LastJudgment time.Time
}

// CompanionAffect is the stored emotion, busy flag and reply counters.
type CompanionAffect struct {
	Closeness      int
	Mood           int
	Energy         int
	CloseBase      int
	MoodBase       int
	EnergyBase     int
	UpdatedAt      time.Time
	LastSourceRef  string
	BusyUntil      time.Time
	Unanswered     int
	LastUserAt     time.Time
	LastProactive  time.Time
	LastJudgmentAt time.Time
}

func (s *Store) ListProactiveTargets(ctx context.Context) ([]FollowUpSyncTarget, error) {
	var out []FollowUpSyncTarget
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT out_owner, out_relationship FROM vc.list_proactive_targets()`)
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

func (s *Store) GetCompanionState(ctx context.Context, owner, relationshipID int64, now time.Time) (CompanionState, error) {
	loaded, err := s.LoadProactiveContext(ctx, owner, relationshipID, now)
	if err != nil {
		return CompanionState{}, err
	}
	state := CompanionState{
		MoodTier: loaded.World.Mood.Tier, MoodVibe: loaded.World.Mood.Vibe, MoodLine: loaded.World.Mood.Line,
		EmotionLine: loaded.World.Emotion.Line, Closeness: loaded.World.Emotion.Closeness,
		Mood: loaded.World.Emotion.Mood, Energy: loaded.World.Emotion.Energy,
	}
	if !loaded.World.BusyUntil.IsZero() && now.Before(loaded.World.BusyUntil) {
		until := loaded.World.BusyUntil.UTC()
		state.BusyUntil = &until
	}
	return state, nil
}

func (s *Store) reconcileOpenTopic(ctx context.Context, owner, relationshipID int64) error {
	var topicRef string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT COALESCE(open_topic_source_ref,'') FROM vc.companion_affect WHERE owner_user_id=$1 AND relationship_id=$2`, owner, relationshipID).Scan(&topicRef)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	})
	if err != nil {
		return mapFollowUpErr(err)
	}
	if chats := sourceChats([]string{topicRef}); len(chats) > 0 {
		if _, err := s.ReconcileSTSources(ctx, owner, chats); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) LoadProactiveContext(ctx context.Context, owner, relationshipID int64, now time.Time) (ProactiveContext, error) {
	var out ProactiveContext
	if err := s.reconcileOpenTopic(ctx, owner, relationshipID); err != nil {
		return out, err
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		policy, err := scanProactivePolicy(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		loc := proactive.Zone(valueOrEmpty(policy.QuietHoursTimezone))
		affect, err := loadCompanionAffectTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		mood, err := ensureMoodTx(ctx, tx, owner, relationshipID, now, loc, affect)
		if err != nil {
			return err
		}
		var deletion bool
		if err := tx.QueryRow(ctx, `SELECT vc.account_deletion_intent_active_current()`).Scan(&deletion); err != nil {
			return err
		}
		start, end := localDay(now, loc)
		var sent int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM vc.proactive_message
			 WHERE owner_user_id=$1 AND relationship_id=$2 AND status='INBOX'
			   AND delivered_at >= $3 AND delivered_at < $4`,
			owner, relationshipID, start, end).Scan(&sent); err != nil {
			return err
		}
		var ready bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM vc.proactive_message
			 WHERE owner_user_id=$1 AND relationship_id=$2 AND status='READY')`,
			owner, relationshipID).Scan(&ready); err != nil {
			return err
		}
		var due bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
			    SELECT 1 FROM vc.follow_up
			     WHERE owner_user_id=$1 AND relationship_id=$2
			       AND ((status='SCHEDULED' AND trigger_at IS NOT NULL AND trigger_at <= $3)
			         OR (status='DEFERRED' AND deferred_until IS NOT NULL AND deferred_until <= $3)))`,
			owner, relationshipID, now).Scan(&due); err != nil {
			return err
		}
		cooldowns, err := loadCooldownsTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		turns, err := loadRecentTurnsTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		topicRef, topic, err := openTopicTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		recent, err := loadRecentProactiveTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		var charName, userName *string
		if err := tx.QueryRow(ctx, `
			SELECT companion_name, user_address_as FROM vc.relationship
			 WHERE owner_user_id=$1 AND id=$2`, owner, relationshipID).Scan(&charName, &userName); err != nil {
			return err
		}
		emotion := proactive.Decay(affectEmotion(affect), now)
		out.LastJudgment = affect.LastJudgmentAt
		out.World = proactive.World{
			Now: now, Location: loc,
			Policy: proactive.PolicyView{
				Mode: policy.Mode, CheckInAfterMinutes: policy.CheckInAfterMinutes,
				DailyLimit: policy.DailyLimit, QuietStart: valueOrEmpty(policy.QuietHoursStart),
				QuietEnd: valueOrEmpty(policy.QuietHoursEnd), Timezone: loc.String(),
				OfflineCapable: policy.OfflineCapable, DeletionIntent: deletion,
			},
			Mood: mood, Emotion: emotion,
			LastUserAt: affect.LastUserAt, LastProactiveAt: affect.LastProactive,
			SentToday: sent, Unanswered: affect.Unanswered, BusyUntil: affect.BusyUntil,
			HasReady: ready, DueFollowUp: due, Topic: topic, TopicRef: topicRef,
			RecentTurns: turns, RecentProactive: recent,
			CharName: valueOrEmpty(charName), UserName: valueOrEmpty(userName),
			Cooldown: cooldowns,
		}
		return nil
	})
	return out, mapFollowUpErr(err)
}

func (s *Store) ObserveCompanionUserText(ctx context.Context, owner, relationshipID int64, ref, text string, at time.Time) error {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	if at.IsZero() {
		at = time.Now()
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		affect, err := loadCompanionAffectTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		next, applied := proactive.ApplyText(affectEmotion(affect), text, ref, affect.LastSourceRef, at)
		if !applied {
			return nil
		}
		affect.Closeness, affect.Mood, affect.Energy = next.Closeness, next.Mood, next.Energy
		affect.CloseBase, affect.MoodBase, affect.EnergyBase = next.CloseBase, next.MoodBase, next.EnergyBase
		affect.UpdatedAt = at
		affect.LastSourceRef = ref
		affect.BusyUntil = proactive.BusyUntil(text, at)
		affect.Unanswered = 0
		affect.LastUserAt = at
		if err := saveCompanionAffectTx(ctx, tx, owner, relationshipID, affect); err != nil {
			return err
		}
		switch proactive.TopicAction(text) {
		case "open":
			if _, err := tx.Exec(ctx, `SELECT vc.set_companion_topic($1,$2,$3)`, owner, relationshipID, ref); err != nil {
				return err
			}
		case "clear":
			if _, err := tx.Exec(ctx, `SELECT vc.set_companion_topic($1,$2,NULL)`, owner, relationshipID); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `SELECT vc.cancel_open_proactive($1,$2,$3)`, owner, relationshipID, at)
		return err
	})
	return mapFollowUpErr(err)
}

func (s *Store) SuppressProactiveSources(ctx context.Context, owner int64, chat string) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.suppress_proactive_sources($1,$2)`, owner, chat)
		return err
	})
	return mapFollowUpErr(err)
}

func (s *Store) NoteProactiveJudgment(ctx context.Context, owner, relationshipID int64, at time.Time) error {
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.note_proactive_judgment($1,$2,$3)`, owner, relationshipID, at)
		return err
	})
	return mapFollowUpErr(err)
}

func (s *Store) InsertProactiveWorkItem(ctx context.Context, owner, relationshipID int64) (int64, error) {
	var id int64
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.insert_proactive_work_item($1,$2)`, owner, relationshipID).Scan(&id)
	})
	return id, mapFollowUpErr(err)
}

func (s *Store) SaveProactivePlan(ctx context.Context, owner, relationshipID int64, plan proactive.Plan, body string, at time.Time) error {
	if plan.Trigger.Kind == proactive.KindContinue {
		if err := s.reconcileOpenTopic(ctx, owner, relationshipID); err != nil {
			return err
		}
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		if plan.Trigger.Kind == proactive.KindContinue {
			ref, _, err := openTopicTx(ctx, tx, owner, relationshipID)
			if err != nil {
				return err
			}
			if ref == "" || ref != plan.TopicRef {
				return ErrConflict
			}
		}
		var messageID int64
		if err := tx.QueryRow(ctx, `
			SELECT vc.insert_proactive_message($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
			owner, relationshipID, plan.Trigger.Key, plan.Trigger.Kind, plan.Trigger.Cluster, plan.Trigger.Reminder,
			body, plan.TopicRef, plan.SendAt, nullTime(plan.ArmedAt)).Scan(&messageID); err != nil {
			return err
		}
		var rates map[string]float64
		err := tx.QueryRow(ctx, `SELECT proactive_voice_rates FROM vc.voice_settings WHERE owner_user_id=$1`, owner).Scan(&rates)
		if errors.Is(err, pgx.ErrNoRows) {
			rates = voice.DefaultSettings().ProactiveVoiceRates
		} else if err != nil {
			return err
		}
		selected := rand.Float64() < rates[voice.ProactiveScene(plan.Trigger.Key)]
		if _, err := tx.Exec(ctx, `SELECT vc.select_proactive_voice($1,$2,$3)`, owner, messageID, selected); err != nil {
			return err
		}
		if plan.Trigger.Cooldown > 0 {
			if _, err := tx.Exec(ctx, `SELECT vc.save_proactive_cooldown($1,$2,$3,$4)`,
				owner, relationshipID, "trigger:"+plan.Trigger.Key, at.Add(plan.Trigger.Cooldown)); err != nil {
				return err
			}
		}
		if plan.Trigger.ClusterCD > 0 {
			if _, err := tx.Exec(ctx, `SELECT vc.save_proactive_cooldown($1,$2,$3,$4)`,
				owner, relationshipID, "cluster:"+plan.Trigger.Cluster, at.Add(plan.Trigger.ClusterCD)); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `SELECT vc.note_proactive_judgment($1,$2,$3)`, owner, relationshipID, at)
		return err
	})
	return mapFollowUpErr(err)
}

type ProactiveVoiceCandidate struct {
	ID            int64
	Body, Trigger string
	PlannedAt     time.Time
}

func (s *Store) ListProactiveVoiceCandidates(ctx context.Context, owner, relationshipID int64) ([]ProactiveVoiceCandidate, error) {
	var out []ProactiveVoiceCandidate
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT id,body,trigger_key,planned_at FROM vc.proactive_message WHERE owner_user_id=$1 AND relationship_id=$2 AND status='READY' AND voice_selected ORDER BY planned_at LIMIT 12`, owner, relationshipID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item ProactiveVoiceCandidate
			if err := rows.Scan(&item.ID, &item.Body, &item.Trigger, &item.PlannedAt); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, mapStoreErr(err)
}

// DeliverDueProactive files the earliest due READY body. accept is the safety
// review; a false result cancels that body and the pass continues.
func (s *Store) DeliverDueProactive(ctx context.Context, owner, relationshipID int64, now time.Time, snapshot FollowUpGenerationFinish, accept func(string) bool) (string, bool, error) {
	var eventID string
	var delivered bool
	if err := s.reconcileOpenTopic(ctx, owner, relationshipID); err != nil {
		return "", false, err
	}
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		affect, err := loadCompanionAffectTx(ctx, tx, owner, relationshipID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT * FROM vc.lock_ready_proactive($1,$2)`, owner, relationshipID)
		if err != nil {
			return err
		}
		defer rows.Close()
		type readyRow struct {
			id             int64
			reminder       bool
			body           string
			planned        time.Time
			armed          *time.Time
			kind, topicRef string
		}
		var pending []readyRow
		for rows.Next() {
			var row readyRow
			if err := rows.Scan(&row.id, &row.reminder, &row.body, &row.planned, &row.armed, &row.kind, &row.topicRef); err != nil {
				return err
			}
			pending = append(pending, row)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		rows.Close()
		for _, row := range pending {
			armed := time.Time{}
			if row.armed != nil {
				armed = *row.armed
			}
			ok, reason := proactive.Delivery(now, row.planned, affect.LastUserAt, armed, row.reminder)
			if row.kind == proactive.KindContinue {
				ref, _, err := openTopicTx(ctx, tx, owner, relationshipID)
				if err != nil {
					return err
				}
				if ref == "" || ref != row.topicRef {
					ok, reason = false, proactive.ReasonCancelled
				}
			}
			switch reason {
			case proactive.ReasonExpired, proactive.ReasonCancelled:
				status := "EXPIRED"
				if reason == proactive.ReasonCancelled {
					status = "CANCELLED"
				}
				if _, err := tx.Exec(ctx, `SELECT vc.finish_proactive_message($1,$2,$3,NULL,NULL,NULL)`, owner, row.id, status); err != nil {
					return err
				}
				continue
			}
			if !ok {
				continue
			}
			if accept != nil && !accept(row.body) {
				if _, err := tx.Exec(ctx, `SELECT vc.finish_proactive_message($1,$2,'CANCELLED',NULL,NULL,NULL)`, owner, row.id); err != nil {
					return err
				}
				continue
			}
			var conversation int64
			var branch *string
			err := tx.QueryRow(ctx, `
				SELECT id, NULLIF(btrim(COALESCE(st_branch_root, st_chat_identity, '')), '')
				  FROM vc.conversation
				 WHERE owner_user_id=$1 AND relationship_id=$2
				   AND st_mode='COMPANION' AND NOT incognito
				   AND st_source_state IS DISTINCT FROM 'DELETED'
				 ORDER BY id DESC LIMIT 1`, owner, relationshipID).Scan(&conversation, &branch)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrProactiveNoConversation
			}
			if err != nil {
				return err
			}
			var followID int64
			if err := tx.QueryRow(ctx, `
				SELECT vc.insert_follow_up($1,$2,NULL,NULL,NULL,$3,'NEEDS_CLARIFICATION','none',NULL,false,NULL,NULL,NULL,NULL)`,
				owner, relationshipID, row.body).Scan(&followID); err != nil {
				return err
			}
			var params any
			if len(snapshot.Params) > 0 {
				params = string(snapshot.Params)
			}
			if _, err := tx.Exec(ctx, `
				SELECT vc.finish_follow_up_generation($1,$2,'BODY_READY','PROACTIVE',$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
				owner, followID, row.body, nullIfBlank(snapshot.ProviderID), nullIfBlank(snapshot.ModelID), nullIfBlank(snapshot.Protocol),
				snapshot.ProviderRevision, snapshot.BindingRevision, params, now); err != nil {
				return err
			}
			filed := "fu-" + strconv.FormatInt(followID, 10)
			if _, err := tx.Exec(ctx, `SELECT vc.create_inbox_event($1,$2,$3,$4,NULL,NULL)`,
				owner, filed, conversation, branch); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `SELECT vc.attach_inbox_voice($1,$2,$3)`, owner, filed, row.id); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `SELECT vc.finish_proactive_message($1,$2,'INBOX',$3,$4,$5)`,
				owner, row.id, now, followID, filed); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `SELECT vc.note_proactive_sent($1,$2,$3)`, owner, relationshipID, now); err != nil {
				return err
			}
			eventID = filed
			delivered = true
			return nil
		}
		return nil
	})
	if errors.Is(err, ErrProactiveNoConversation) {
		return "", false, ErrProactiveNoConversation
	}
	return eventID, delivered, mapFollowUpErr(err)
}

func affectEmotion(row CompanionAffect) proactive.Emotion {
	base := proactive.Baseline()
	if row.CloseBase != 0 || row.MoodBase != 0 || row.EnergyBase != 0 || row.UpdatedAt.IsZero() == false {
		base.Closeness, base.Mood, base.Energy = row.Closeness, row.Mood, row.Energy
		base.CloseBase, base.MoodBase, base.EnergyBase = row.CloseBase, row.MoodBase, row.EnergyBase
		base.At = row.UpdatedAt
	}
	if base.CloseBase == 0 {
		base.CloseBase = 50
	}
	if base.MoodBase == 0 {
		base.MoodBase = 50
	}
	if base.EnergyBase == 0 {
		base.EnergyBase = 50
	}
	return base
}

func loadCompanionAffectTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (CompanionAffect, error) {
	var row CompanionAffect
	var updated, busy, lastUser, lastProactive, lastJudgment *time.Time
	var ref *string
	err := tx.QueryRow(ctx, `
		SELECT closeness, mood, energy, close_base, mood_base, energy_base, updated_at,
		       last_source_ref, busy_until, unanswered, last_user_message_at, last_proactive_at, last_judgment_at
		  FROM vc.companion_affect
		 WHERE owner_user_id=$1 AND relationship_id=$2`, owner, relationshipID).
		Scan(&row.Closeness, &row.Mood, &row.Energy, &row.CloseBase, &row.MoodBase, &row.EnergyBase, &updated,
			&ref, &busy, &row.Unanswered, &lastUser, &lastProactive, &lastJudgment)
	if errors.Is(err, pgx.ErrNoRows) {
		base := proactive.Baseline()
		return CompanionAffect{Closeness: base.Closeness, Mood: base.Mood, Energy: base.Energy, CloseBase: base.CloseBase, MoodBase: base.MoodBase, EnergyBase: base.EnergyBase}, nil
	}
	if err != nil {
		return CompanionAffect{}, err
	}
	row.UpdatedAt = derefTime(updated)
	row.BusyUntil = derefTime(busy)
	row.LastUserAt = derefTime(lastUser)
	row.LastProactive = derefTime(lastProactive)
	row.LastJudgmentAt = derefTime(lastJudgment)
	row.LastSourceRef = valueOrEmpty(ref)
	return row, nil
}

func saveCompanionAffectTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64, row CompanionAffect) error {
	_, err := tx.Exec(ctx, `
		SELECT vc.save_companion_affect($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		owner, relationshipID, row.Closeness, row.Mood, row.Energy, row.CloseBase, row.MoodBase, row.EnergyBase,
		nullTime(row.UpdatedAt), nullIfBlank(row.LastSourceRef), nullTime(row.BusyUntil), row.Unanswered,
		nullTime(row.LastUserAt), nullTime(row.LastProactive), nullTime(row.LastJudgmentAt))
	return err
}

func ensureMoodTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64, now time.Time, loc *time.Location, affect CompanionAffect) (proactive.Mood, error) {
	local := now.In(loc)
	date := local.Format("2006-01-02")
	var stored *proactive.Mood
	var tier, vibe, line string
	var redrawn bool
	err := tx.QueryRow(ctx, `
		SELECT tier, vibe, line, redrawn FROM vc.companion_daily_mood
		 WHERE owner_user_id=$1 AND relationship_id=$2 AND local_date=$3`,
		owner, relationshipID, date).Scan(&tier, &vibe, &line, &redrawn)
	if err == nil {
		stored = &proactive.Mood{Tier: tier, Vibe: vibe, Line: line, Redrawn: redrawn, Date: date}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return proactive.Mood{}, err
	}
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	spoke := (!affect.LastUserAt.IsZero() && !affect.LastUserAt.Before(dayStart)) || (!affect.LastProactive.IsZero() && !affect.LastProactive.Before(dayStart))
	mood := proactive.EnsureMood(relationshipID, now, loc, stored, spoke)
	if stored == nil || stored.Tier != mood.Tier || stored.Vibe != mood.Vibe || stored.Line != mood.Line || stored.Redrawn != mood.Redrawn {
		if _, err := tx.Exec(ctx, `SELECT vc.save_companion_mood($1,$2,$3,$4,$5,$6,$7)`,
			owner, relationshipID, date, mood.Tier, mood.Vibe, mood.Line, mood.Redrawn); err != nil {
			return proactive.Mood{}, err
		}
	}
	return mood, nil
}

func loadCooldownsTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (map[string]time.Time, error) {
	rows, err := tx.Query(ctx, `
		SELECT cooldown_key, until_at FROM vc.proactive_cooldown
		 WHERE owner_user_id=$1 AND relationship_id=$2`, owner, relationshipID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]time.Time{}
	for rows.Next() {
		var key string
		var until time.Time
		if err := rows.Scan(&key, &until); err != nil {
			return nil, err
		}
		out[key] = until
	}
	return out, rows.Err()
}

func openTopicTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (string, string, error) {
	var ref, text string
	err := tx.QueryRow(ctx, `SELECT a.open_topic_source_ref,s.content_cipher
        FROM vc.companion_affect a JOIN vc.st_message_source s ON s.owner_user_id=a.owner_user_id AND s.source_ref=a.open_topic_source_ref
        JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
        WHERE a.owner_user_id=$1 AND a.relationship_id=$2 AND c.relationship_id=$2
          AND s.role='user' AND s.present AND s.settled AND s.eligible AND NOT s.suppressed
          AND NOT c.incognito AND c.st_mode='COMPANION' AND c.st_source_state='PRESENT'`, owner, relationshipID).Scan(&ref, &text)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return ref, clipRunes(text, 160), err
}

func loadRecentTurnsTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (string, error) {
	rows, err := tx.Query(ctx, `
		SELECT s.role, s.content_cipher
		  FROM vc.st_message_source s
		  JOIN vc.conversation c ON c.owner_user_id=s.owner_user_id AND c.id=s.conversation_id
		 WHERE s.owner_user_id=$1 AND c.relationship_id=$2
		   AND s.present AND s.role IN ('user','assistant')
		   AND c.st_mode='COMPANION' AND NOT c.incognito
		 ORDER BY s.source_position DESC, s.id DESC
		 LIMIT 6`, owner, relationshipID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	type turn struct{ role, text string }
	var got []turn
	for rows.Next() {
		var row turn
		if err := rows.Scan(&row.role, &row.text); err != nil {
			return "", err
		}
		got = append(got, row)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	var lines []string
	for i := len(got) - 1; i >= 0; i-- {
		label := "你"
		if got[i].role == "user" {
			label = "用户"
		}
		lines = append(lines, label+"："+clipRunes(got[i].text, 80))
	}
	return strings.Join(lines, "\n"), nil
}

func loadRecentProactiveTx(ctx context.Context, tx pgx.Tx, owner, relationshipID int64) (string, error) {
	rows, err := tx.Query(ctx, `
		SELECT body FROM vc.proactive_message
		 WHERE owner_user_id=$1 AND relationship_id=$2 AND status='INBOX' AND body IS NOT NULL
		 ORDER BY delivered_at DESC NULLS LAST
		 LIMIT 3`, owner, relationshipID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var body string
		if err := rows.Scan(&body); err != nil {
			return "", err
		}
		lines = append(lines, clipRunes(body, 80))
	}
	return strings.Join(lines, "\n"), rows.Err()
}

func localDay(now time.Time, loc *time.Location) (time.Time, time.Time) {
	local := now.In(loc)
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
	return start, start.Add(24 * time.Hour)
}

func derefTime(v *time.Time) time.Time {
	if v == nil {
		return time.Time{}
	}
	return *v
}

func nullTime(v time.Time) any {
	if v.IsZero() {
		return nil
	}
	return v
}

func clipRunes(text string, limit int) string {
	text = strings.TrimSpace(strings.ReplaceAll(text, "\n", " "))
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	return string(runes[:limit])
}
