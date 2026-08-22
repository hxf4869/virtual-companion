-- 129_crypto_key_checkpoint: S0-17-B V78 — stale-cipher scan/replace for
-- generic key id/version. Covers: plaintext and enc1 rows are returned;
-- current enc2 prefix is skipped; replace is idempotent and refuses a
-- cipher that is not the current write prefix; conversation_summary is
-- not scanned; vc_worker has no EXECUTE.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.memory_embedding, vc.memory_evidence,
         vc.memory_item, vc.generation_candidate, vc.generation_attempt,
         vc.generation_route, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.authorization_snapshot, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
VALUES (1, 10, 1, 'user', 'plain body'),
       (1, 11, 1, 'user', 'enc1:legacy-blob'),
       (1, 12, 1, 'user', 'enc2:default:1:current-blob');

DO $$
DECLARE
    v_n  int;
    v_ok boolean;
BEGIN
    SELECT count(*) INTO v_n
      FROM vc.backfill_stale_cipher_message_batch(0, 50, 'enc2:default:1:');
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'stale batch should return plaintext and enc1 only, got %', v_n;
    END IF;

    SELECT count(*) INTO v_n
      FROM vc.backfill_stale_cipher_message_batch(0, 50, 'enc2:default:1:')
     WHERE out_id = 12;
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'current enc2 row must not be scanned';
    END IF;

    BEGIN
        PERFORM vc.backfill_stale_cipher_message_batch(0, 50, 'enc1:');
        RAISE EXCEPTION 'non-enc2 prefix must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%current prefix must be enc2%' THEN
                RAISE;
            END IF;
    END;

    v_ok := vc.backfill_replace_message_cipher(
        1, 10, 'enc2:default:1:rewritten', 'enc2:default:1:');
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'plaintext replace should succeed';
    END IF;

    v_ok := vc.backfill_replace_message_cipher(
        1, 10, 'enc2:default:1:again', 'enc2:default:1:');
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'already-current row must not be replaced';
    END IF;

    BEGIN
        PERFORM vc.backfill_replace_message_cipher(
            1, 11, 'enc1:nope', 'enc2:default:1:');
        RAISE EXCEPTION 'legacy cipher argument must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%current write prefix%' THEN
                RAISE;
            END IF;
    END;

    IF to_regprocedure('vc.backfill_stale_cipher_summary_batch(bigint,int,text)') IS NOT NULL THEN
        RAISE EXCEPTION 'S0-17-B must not add summary backfill helpers';
    END IF;

    IF has_function_privilege(
            'vc_worker',
            'vc.backfill_stale_cipher_message_batch(bigint,integer,text)',
            'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute stale cipher batch';
    END IF;
    IF has_function_privilege(
            'vc_worker',
            'vc.backfill_replace_message_cipher(bigint,bigint,text,text)',
            'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute cipher replace';
    END IF;
END $$;
