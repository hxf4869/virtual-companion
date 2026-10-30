package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/hxf4869/virtual-companion/internal/stsource"
	"github.com/hxf4869/virtual-companion/internal/voice"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const voiceSettingsColumns = `kokoro_enabled,cosy_voice_enabled,asr_enabled,kokoro_timeout_seconds,
 cosy_voice_timeout_seconds,asr_timeout_seconds,daily_chat_limit,daily_proactive_limit,voice_frequency,
 cosy_voice_instructions,proactive_voice_rates,kokoro_mood_speeds,max_recording_seconds,revision,updated_at`
const voiceClipColumns = `owner_user_id,id,relationship_id,message_ref,purpose,engine,voice,params,text,status,
 error_kind,coalesce(object_key,''),duration_ms,generation_ms,created_at,ready_at,retry_count,started_at`

func (s *Store) ResolveVoiceMessage(ctx context.Context, owner, relationship int64, ref string) (string, error) {
	parts := strings.Split(ref, ":")
	if len(parts) != 4 || parts[0] != "stmsg" || !stsource.ValidIdentity(parts[1]) || !stsource.ValidIdentity(parts[2]) || !stsource.ValidIdentity(parts[3]) {
		return "", voice.ErrInvalid
	}
	var resolved string
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT s.source_ref FROM vc.st_message_source s JOIN vc.conversation c
 ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE s.owner_user_id=$1 AND c.relationship_id=$2 AND c.st_chat_identity=$3
 AND s.message_id=$4::uuid AND s.candidate_id=$5::uuid AND s.role='assistant'
 AND s.present AND s.settled AND c.st_source_state='PRESENT'`, owner, relationship, parts[1], parts[2], parts[3]).Scan(&resolved)
	})
	return resolved, voiceStoreErr(err)
}

func voiceStoreErr(err error) error {
	if err == nil {
		return nil
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "P0001" {
		switch {
		case pg.Message == "voice: not found":
			return voice.ErrNotFound
		case pg.Message == "voice: unavailable" || pg.Message == "owner deletion is in progress":
			return voice.ErrUnavailable
		case pg.Message == "voice: rate limited":
			return voice.ErrRateLimited
		case strings.HasPrefix(pg.Message, "voice: invalid"):
			return voice.ErrInvalid
		}
	}
	err = mapStoreErr(err)
	var revision *RevisionConflictError
	switch {
	case errors.As(err, &revision):
		return voice.ErrConflict
	case errors.Is(err, ErrNotFound):
		return voice.ErrNotFound
	case errors.Is(err, ErrInvalid):
		return voice.ErrInvalid
	case errors.Is(err, ErrRateLimited):
		return voice.ErrRateLimited
	default:
		return voice.ErrStore
	}
}

func scanVoiceSettings(row pgx.Row) (voice.Settings, error) {
	var out voice.Settings
	err := row.Scan(&out.KokoroEnabled, &out.CosyVoiceEnabled, &out.ASREnabled, &out.KokoroTimeoutSeconds,
		&out.CosyVoiceTimeoutSeconds, &out.ASRTimeoutSeconds, &out.DailyChatLimit, &out.DailyProactiveLimit,
		&out.VoiceFrequency, &out.CosyVoiceInstructions, &out.ProactiveVoiceRates, &out.KokoroMoodSpeeds, &out.MaxRecordingSeconds, &out.Revision, &out.UpdatedAt)
	return out, err
}

func scanVoiceClip(row pgx.Row) (voice.Clip, error) {
	var out voice.Clip
	err := row.Scan(&out.OwnerID, &out.ID, &out.RelationshipID, &out.MessageRef, &out.Purpose, &out.Engine,
		&out.Voice, &out.Params, &out.Text, &out.Status, &out.ErrorKind, &out.ObjectKey, &out.DurationMS,
		&out.GenerationMS, &out.CreatedAt, &out.ReadyAt, &out.RetryCount, &out.StartedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return voice.Clip{}, voice.ErrNotFound
	}
	return out, err
}

func (s *Store) GetVoiceSettings(ctx context.Context, owner int64) (voice.Settings, error) {
	var out voice.Settings
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceSettings(tx.QueryRow(ctx, `SELECT `+voiceSettingsColumns+` FROM vc.voice_settings WHERE owner_user_id=$1`, owner))
		if errors.Is(err, pgx.ErrNoRows) {
			out = voice.DefaultSettings()
			return nil
		}
		return err
	})
	return out, voiceStoreErr(err)
}

func (s *Store) SaveVoiceSettings(ctx context.Context, owner int64, in voice.SettingsWrite) (voice.Settings, error) {
	encoded, err := json.Marshal(in.SettingsValues)
	if err != nil {
		return voice.Settings{}, voice.ErrInvalid
	}
	var out voice.Settings
	err = s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceSettings(tx.QueryRow(ctx, `SELECT `+voiceSettingsColumns+` FROM vc.save_voice_settings($1,$2,$3::jsonb)`, owner, in.ExpectedRevision, encoded))
		return err
	})
	return out, voiceStoreErr(err)
}

func (s *Store) GetVoiceRelationship(ctx context.Context, owner, id int64) (voice.Relationship, error) {
	var out voice.Relationship
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT r.id,r.gender,r.kokoro_voice,r.cosy_voice,r.voice_speed,r.voice_frequency,r.proactive_voice,
 r.proactive_engine,coalesce((SELECT m.vibe FROM vc.companion_daily_mood m WHERE m.owner_user_id=r.owner_user_id
 AND m.relationship_id=r.id AND m.local_date=(clock_timestamp() AT TIME ZONE coalesce(p.quiet_hours_timezone,'Asia/Shanghai'))::date),'')
 FROM vc.relationship r LEFT JOIN vc.proactive_policy p ON (p.owner_user_id,p.relationship_id)=(r.owner_user_id,r.id)
 WHERE r.owner_user_id=$1 AND r.id=$2`, owner, id).Scan(&out.ID, &out.Gender, &out.KokoroVoice, &out.CosyVoice, &out.Speed, &out.VoiceFrequency, &out.ProactiveVoice, &out.ProactiveEngine, &out.Mood)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return err
	})
	return out, voiceStoreErr(err)
}

func (s *Store) EnqueueVoiceClip(ctx context.Context, in voice.Clip) (voice.Clip, error) {
	params, err := json.Marshal(in.Params)
	if err != nil {
		return voice.Clip{}, voice.ErrInvalid
	}
	var out voice.Clip
	err = s.WithOwner(ctx, in.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceClip(tx.QueryRow(ctx, `SELECT `+voiceClipColumns+` FROM vc.enqueue_voice_clip($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, in.OwnerID, in.RelationshipID, in.MessageRef, in.Purpose, in.Engine, in.Voice, params, in.Text))
		return err
	})
	return out, voiceStoreErr(err)
}

func (s *Store) GetVoiceClip(ctx context.Context, owner, id int64) (voice.Clip, error) {
	var out voice.Clip
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceClip(tx.QueryRow(ctx, `SELECT `+voiceClipColumns+` FROM vc.voice_clip WHERE owner_user_id=$1 AND id=$2`, owner, id))
		return err
	})
	if errors.Is(err, voice.ErrNotFound) {
		return voice.Clip{}, err
	}
	return out, voiceStoreErr(err)
}

func (s *Store) FindVoiceClip(ctx context.Context, owner, relationshipID int64, purpose, ref string) (voice.Clip, error) {
	var out voice.Clip
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceClip(tx.QueryRow(ctx, `SELECT `+voiceClipColumns+` FROM vc.voice_clip
 WHERE owner_user_id=$1 AND relationship_id=$2 AND purpose=$3 AND message_ref=$4`, owner, relationshipID, purpose, ref))
		return err
	})
	if errors.Is(err, voice.ErrNotFound) {
		return voice.Clip{}, err
	}
	return out, voiceStoreErr(err)
}

func (s *Store) ClaimVoiceClip(ctx context.Context, engine string) (voice.Clip, error) {
	var out voice.Clip
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		out, err = scanVoiceClip(tx.QueryRow(ctx, `SELECT `+voiceClipColumns+` FROM vc.claim_voice_clip($1)`, engine))
		return err
	})
	if errors.Is(err, voice.ErrNotFound) {
		return voice.Clip{}, err
	}
	return out, voiceStoreErr(err)
}

func (s *Store) CompleteVoiceClip(ctx context.Context, clip voice.Clip, in voice.Completion) (bool, error) {
	var accepted bool
	err := s.WithOwner(ctx, clip.OwnerID, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.complete_voice_clip($1,$2,$3,$4,$5,$6,$7,$8)`, clip.OwnerID, clip.ID, clip.StartedAt, in.Status, in.ErrorKind, in.DurationMS, in.GenerationMS, int(in.RetryAfter.Seconds())).Scan(&accepted)
	})
	return accepted, voiceStoreErr(err)
}

func (s *Store) ListVoiceCleanup(ctx context.Context) ([]voice.CleanupObject, error) {
	var out []voice.CleanupObject
	err := s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT object_key FROM vc.list_voice_cleanup()`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item voice.CleanupObject
			if err := rows.Scan(&item.Key); err != nil {
				return err
			}
			out = append(out, item)
		}
		return rows.Err()
	})
	return out, voiceStoreErr(err)
}

func (s *Store) CompleteVoiceCleanup(ctx context.Context, key string) error {
	return voiceStoreErr(s.withoutOwner(ctx, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `SELECT vc.complete_voice_cleanup($1)`, key)
		return err
	}))
}

func (s *Store) ClearVoiceAccountData(ctx context.Context, owner int64) (bool, error) {
	var done bool
	err := s.WithOwner(ctx, owner, func(ctx context.Context, tx pgx.Tx) error {
		return tx.QueryRow(ctx, `SELECT vc.clear_voice_account_data($1)`, owner).Scan(&done)
	})
	return done, mapStoreErr(err)
}
