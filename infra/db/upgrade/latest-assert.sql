-- latest-assert: DOGFOOD-STABILIZATION-04 audit defect A — runs AFTER
-- V112..latest applied on top of the V111-seeded legacy rows. The backfill
-- must have repaired the pre-existing blocked / output-blocked / cancelled
-- turns IN PLACE: their persisted messages (still readable — data rights)
-- are no longer model-eligible, while the clean legacy turn stays eligible.

\set ON_ERROR_STOP on

DO $$
DECLARE
    n int;
BEGIN
    -- INPUT_BLOCKED legacy turn: content persists, eligibility gone.
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    JOIN vc.generation g ON g.source_user_message_id = m.id
                    WHERE g.owner_user_id = 1
                      AND g.idempotency_key = 'legacy-blocked'
                      AND m.content LIKE '%13800138000%') THEN
        RAISE EXCEPTION 'upgrade: blocked legacy content must persist';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.message m
                JOIN vc.generation g ON g.source_user_message_id = m.id
                WHERE g.owner_user_id = 1
                  AND g.idempotency_key = 'legacy-blocked'
                  AND m.model_eligible) THEN
        RAISE EXCEPTION 'upgrade: legacy INPUT_BLOCKED message must be backfilled ineligible';
    END IF;

    -- OUTPUT_BLOCKED legacy turn.
    IF EXISTS (SELECT 1 FROM vc.message m
                JOIN vc.generation g ON g.source_user_message_id = m.id
                WHERE g.owner_user_id = 1
                  AND g.idempotency_key = 'legacy-output'
                  AND m.model_eligible) THEN
        RAISE EXCEPTION 'upgrade: legacy OUTPUT_BLOCKED message must be backfilled ineligible';
    END IF;

    -- CANCELLED legacy turn.
    IF EXISTS (SELECT 1 FROM vc.message m
                JOIN vc.generation g ON g.source_user_message_id = m.id
                WHERE g.owner_user_id = 1
                  AND g.idempotency_key = 'legacy-cancelled'
                  AND m.model_eligible) THEN
        RAISE EXCEPTION 'upgrade: legacy CANCELLED message must be backfilled ineligible';
    END IF;

    -- Clean legacy turn keeps eligibility.
    IF NOT EXISTS (SELECT 1 FROM vc.message m
                    JOIN vc.generation g ON g.source_user_message_id = m.id
                    WHERE g.owner_user_id = 1
                      AND g.idempotency_key = 'legacy-clean'
                      AND m.model_eligible) THEN
        RAISE EXCEPTION 'upgrade: clean legacy message must stay eligible';
    END IF;

    -- The model-facing history read (the assembler's query shape) excludes
    -- every backfilled row of this conversation; the data-rights read sees
    -- all of them.
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 1 AND model_eligible;
    IF n <> 1 THEN
        RAISE EXCEPTION 'upgrade: model-facing read must see only the clean legacy row, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 1;
    IF n <> 4 THEN
        RAISE EXCEPTION 'upgrade: data-rights read must keep all legacy rows, got %', n;
    END IF;
END;
$$;
