-- 61_v8_v11_legacy_upgrade_fail_closed: §5.1.6 / RISK-10 evidence.
--
-- V8 and V11 were written when the Alpha tables were empty (their own comments say
-- "Alpha tables are empty (tests TRUNCATE)" / "Existing Alpha tables are empty").
-- Their backfill (V8 ADD COLUMN event_seq DEFAULT 0 + CREATE UNIQUE INDEX; V11 ADD
-- COLUMN conversation_id nullable + ADD CHECK + ADD FK) therefore assumes empty (or
-- at most single-row-per-key) tables. This test proves, by simulating those exact
-- migration steps on deliberately-incompatible legacy-shaped data, that V8/V11
-- fail CLOSED (abort the migration) rather than silently corrupting state — which
-- is RISK-10's required "upgrade test with incompatible historical data".
--
-- All DROP/recreate steps run inside BEGIN/ROLLBACK so the post-migration schema is
-- unchanged for any later test. Inserts run as the PostgreSQL superuser (no SET ROLE)
-- because TASK-0153 V16 revoked runtime-role DML on realtime_event/memory_item; the
-- constraints being tested are table-level and caller-role-independent (same pattern
-- as test 50's superuser CHECK verification at lines 146-162).
--
-- Scenarios:
--   1. V8 upgrade collision: V8's CREATE UNIQUE INDEX step aborts when DEFAULT 0
--      backfill collapses >=2 legacy rows for the same (owner,gen) onto (epoch=1,
--      seq=0). Plus a positive control: distinct (owner,gen) legacy rows with seq=0
--      do NOT collide, so the backfill is safe in the single-row-per-key case.
--   2. V8 post-migration guard: the index V8 created (realtime_event_seq_uniq)
--      continues to enforce INV-RT-001 by rejecting a duplicate (owner,gen,epoch,seq)
--      INSERT after migration.
--   3. V11 upgrade CHECK collision: V11's ADD CONSTRAINT ... CHECK
--      (scope <> 'SESSION' OR conversation_id IS NOT NULL) aborts when a legacy
--      SESSION memory (nullable backfill => conversation_id NULL) violates it.
--   4. V11 upgrade FK collision: V11's ADD CONSTRAINT ... FOREIGN KEY
--      (owner_user_id, conversation_id) REFERENCES vc.conversation aborts when a
--      legacy memory points at a conversation that no longer exists.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.memory_evidence, vc.memory_item,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
-- 7000/7001: IN_PROGRESS generations used as realtime_event FK targets.
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 7000, 100, 'gen-v8-a', 'IN_PROGRESS');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 7001, 100, 'gen-v8-b', 'IN_PROGRESS');

-- ===========================================================================
-- Scenario 1: V8 upgrade — CREATE UNIQUE INDEX aborts on DEFAULT 0 backfill
-- collision (>=2 legacy rows for the same owner,generation).
-- ===========================================================================
BEGIN;
DROP INDEX IF EXISTS vc.realtime_event_seq_uniq;
-- Simulate V8 DEFAULT backfill on two pre-existing V7 rows for the SAME
-- (owner_user_id=1, generation_id=7000): both collapse to (stream_epoch=1,
-- event_seq=0).
INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                              stream_epoch, event_seq, committed_at)
VALUES (1, 700001, 7000, 'chat.accepted', 1, 0, now());
INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                              stream_epoch, event_seq, committed_at)
VALUES (1, 700002, 7000, 'chat.accepted', 1, 0, now());
-- V8's CREATE UNIQUE INDEX step (V8:50-51) must abort on this collision data.
DO $$
BEGIN
    CREATE UNIQUE INDEX realtime_event_seq_uniq
        ON vc.realtime_event (owner_user_id, generation_id, stream_epoch, event_seq);
    RAISE EXCEPTION 'V8 CREATE UNIQUE INDEX must fail on backfill collision data';
EXCEPTION WHEN unique_violation THEN
    NULL; -- expected: V8 aborts (fail-closed) instead of corrupting the cursor
END $$;
ROLLBACK;  -- restores realtime_event_seq_uniq + removes the legacy-collision rows

-- Positive control: distinct (owner,generation) legacy rows each backfilled to
-- (epoch=1, seq=0) do NOT collide, so V8's CREATE UNIQUE INDEX succeeds — the
-- backfill is safe in the single-row-per-(owner,gen) case.
BEGIN;
DROP INDEX IF EXISTS vc.realtime_event_seq_uniq;
INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                              stream_epoch, event_seq, committed_at)
VALUES (1, 700010, 7000, 'chat.accepted', 1, 0, now());
INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                              stream_epoch, event_seq, committed_at)
VALUES (1, 700011, 7001, 'chat.accepted', 1, 0, now());
CREATE UNIQUE INDEX realtime_event_seq_uniq
    ON vc.realtime_event (owner_user_id, generation_id, stream_epoch, event_seq);
ROLLBACK;  -- restores the original V8 index + removes the rows

-- ===========================================================================
-- Scenario 2: V8 post-migration guard — realtime_event_seq_uniq (the index V8
-- created) still rejects a duplicate (owner,gen,epoch,seq) INSERT, enforcing
-- INV-RT-001's monotonic per-(owner,generation,epoch) cursor.
-- ===========================================================================
DO $$
BEGIN
    INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                                  stream_epoch, event_seq, committed_at)
    VALUES (1, 700020, 7000, 'chat.accepted', 1, 5, now());
    BEGIN
        INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type,
                                      stream_epoch, event_seq, committed_at)
        VALUES (1, 700021, 7000, 'chat.accepted', 1, 5, now());
        RAISE EXCEPTION 'duplicate (owner,gen,epoch,seq) must be rejected by realtime_event_seq_uniq';
    EXCEPTION WHEN unique_violation THEN
        NULL; -- expected: V8's index enforces INV-RT-001 post-migration
    END;
END $$;

-- ===========================================================================
-- Scenario 3: V11 upgrade — ADD CONSTRAINT CHECK aborts on a legacy SESSION
-- memory whose nullable conversation_id backfill is NULL.
-- ===========================================================================
BEGIN;
ALTER TABLE vc.memory_item DROP CONSTRAINT memory_item_session_requires_conversation;
-- Simulate a pre-V11 SESSION memory: V2 had no conversation_id column, so V11's
-- nullable ADD COLUMN backfills it to NULL. (The FK stays satisfied: default
-- MATCH SIMPLE skips a NULL conversation_id.)
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
VALUES (1, 710001, 10, 'SESSION', 'legacy session memory', 'PENDING_CONFIRMATION');
-- V11's ADD CONSTRAINT CHECK step (V11:36-38) must abort on this legacy row.
DO $$
BEGIN
    ALTER TABLE vc.memory_item
        ADD CONSTRAINT memory_item_session_requires_conversation
        CHECK (scope <> 'SESSION' OR conversation_id IS NOT NULL);
    RAISE EXCEPTION 'V11 ADD CONSTRAINT CHECK must fail on legacy SESSION memory without conversation';
EXCEPTION WHEN check_violation THEN
    NULL; -- expected: V11 aborts (fail-closed)
END $$;
ROLLBACK;  -- restores the CHECK constraint + removes the legacy row

-- ===========================================================================
-- Scenario 4: V11 upgrade — ADD CONSTRAINT FOREIGN KEY aborts on a legacy
-- memory whose conversation was since deleted (dangling reference).
-- ===========================================================================
BEGIN;
ALTER TABLE vc.memory_item DROP CONSTRAINT memory_item_conversation_fk;
-- Simulate a pre-V11 SESSION memory whose conversation_id (nullable backfill
-- preserved an old value) points at a conversation that no longer exists. The
-- CHECK (still present) is satisfied because conversation_id IS NOT NULL.
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary,
                           status, conversation_id)
VALUES (1, 710002, 10, 'SESSION', 'legacy session memory dangling', 'PENDING_CONFIRMATION', 999888);
-- V11's ADD CONSTRAINT FK step (V11:44-47) must abort on this dangling reference.
DO $$
BEGIN
    ALTER TABLE vc.memory_item
        ADD CONSTRAINT memory_item_conversation_fk
        FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE;
    RAISE EXCEPTION 'V11 ADD CONSTRAINT FK must fail on legacy memory with dangling conversation';
EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- expected: V11 aborts (fail-closed)
END $$;
ROLLBACK;  -- restores the FK constraint + removes the legacy row
