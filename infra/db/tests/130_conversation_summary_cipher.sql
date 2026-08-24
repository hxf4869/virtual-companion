-- 130_conversation_summary_cipher: S0-32 V79 — summary stored-text reader
-- and stale-cipher scan/replace. Covers: plaintext summaries are scanned;
-- current enc2 is skipped; replace is idempotent; vc_worker has no EXECUTE;
-- restored legacy invalid rows do not block effective-summary readiness.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.message, vc.conversation, vc.relationship,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);

INSERT INTO vc.conversation_summary(
    owner_user_id, id, conversation_id, from_message_id, to_message_id,
    summary, model_id, model_version, prompt_version, confidence,
    validated, service_class, valid)
VALUES
    (1, 1, 1, 10, 11, 'plain summary', 'm', '1', '1', 0.9, true, 'ECONOMY', true),
    (1, 2, 1, 10, 12, 'enc2:default:1:current', 'm', '1', '1', 0.9, true, 'ECONOMY', true),
    (1, 3, 1, 10, 11, 'enc1:legacy', 'm', '1', '1', 0.9, true, 'ECONOMY', false);

DO $$
DECLARE
    v_n  int;
    v_ok boolean;
BEGIN
    SELECT count(*) INTO v_n
      FROM vc.backfill_stale_cipher_summary_batch(0, 50, 'enc2:default:1:');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'stale summary batch should return plaintext and enc1, got %', v_n;
    END IF;

    IF vc.conversation_summary_cipher_ready('enc2:default:1:') THEN
        RAISE EXCEPTION 'plaintext effective summary must fail startup readiness';
    END IF;

    v_ok := vc.backfill_replace_summary_cipher(
        1, 1, 'enc2:default:1:rewritten', 'enc2:default:1:');
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'plaintext summary replace should succeed';
    END IF;

    v_ok := vc.backfill_replace_summary_cipher(
        1, 1, 'enc2:default:1:again', 'enc2:default:1:');
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'already-current summary must not be replaced';
    END IF;

    IF NOT vc.conversation_summary_cipher_ready('enc2:default:1:') THEN
        RAISE EXCEPTION 'current effective summaries must pass startup readiness';
    END IF;

    -- A directly restored legacy invalid row is ignored by effective-row readiness;
    -- backfill can still re-encrypt it if an isolated recovery imports one.
    SELECT count(*) INTO v_n
      FROM vc.conversation_summary WHERE id = 3 AND valid = false;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'invalidated summary row must remain';
    END IF;

    IF has_function_privilege(
            'vc_worker',
            'vc.backfill_stale_cipher_summary_batch(bigint,integer,text)',
            'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute summary cipher batch';
    END IF;
END $$;
