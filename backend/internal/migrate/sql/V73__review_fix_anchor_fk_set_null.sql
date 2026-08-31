-- REVIEW-FIX: V56/V72 composite FKs used ON DELETE SET NULL without a
-- column list, so deleting the anchored message/conversation nulled the
-- NOT NULL tenant column too and failed with 23502 — a reported message
-- made message deletion deterministic-fail, and one survey answer broke
-- conversation wipe/reset. Re-create both anchors with the PG15+ column
-- list form (V7 precedent): only the nullable anchor column is cleared,
-- the intake record survives as the original comment intended.

SET search_path TO vc, pg_catalog;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'report_request_owner_user_id_message_id_fkey'
           AND conrelid = 'vc.report_request'::regclass
    ) THEN
        ALTER TABLE vc.report_request
            DROP CONSTRAINT report_request_owner_user_id_message_id_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'report_request_message_anchor_fk'
           AND conrelid = 'vc.report_request'::regclass
    ) THEN
        ALTER TABLE vc.report_request
            ADD CONSTRAINT report_request_message_anchor_fk
            FOREIGN KEY (owner_user_id, message_id)
            REFERENCES vc.message(owner_user_id, id)
            ON DELETE SET NULL (message_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'survey_response_owner_user_id_conversation_id_fkey'
           AND conrelid = 'vc.survey_response'::regclass
    ) THEN
        ALTER TABLE vc.survey_response
            DROP CONSTRAINT survey_response_owner_user_id_conversation_id_fkey;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'survey_response_conversation_anchor_fk'
           AND conrelid = 'vc.survey_response'::regclass
    ) THEN
        ALTER TABLE vc.survey_response
            ADD CONSTRAINT survey_response_conversation_anchor_fk
            FOREIGN KEY (owner_user_id, conversation_id)
            REFERENCES vc.conversation(owner_user_id, id)
            ON DELETE SET NULL (conversation_id);
    END IF;
END $$;
