-- 133_product_quota_book: S0-11-C V82 — shared non-monetary reserve/settle/release.
-- Covers: first reserve auto-provisions ceiling; second unit fails closed
-- without overselling; release restores remaining and is idempotent; settle
-- keeps remaining consumed so a later release cannot refund; owner mismatch
-- fail-closed; remaining survives as a table row (restart-equivalent).

\set ON_ERROR_STOP on

TRUNCATE vc.product_quota_reservation, vc.product_quota_account,
         vc.generation_candidate, vc.generation, vc.message, vc.conversation,
         vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_res text;
    v_remain bigint;
    v_second text;
    v_ok boolean;
BEGIN
    v_rel := vc.create_relationship(1, 'persona-alpha');
    v_conv := vc.create_conversation(1, v_rel);
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-133', 'user', 'hello');

    SELECT out_reservation_id, out_remaining INTO v_res, v_remain
      FROM vc.reserve_product_quota(1, v_gen, 1, 1);
    IF v_res IS NULL OR v_remain IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'first reserve of the only unit must leave remaining=0, got % / %',
            v_res, v_remain;
    END IF;

    SELECT out_reservation_id INTO v_second
      FROM vc.reserve_product_quota(1, v_gen, 1, 1);
    IF v_second IS NOT NULL THEN
        RAISE EXCEPTION 'second reserve must fail closed when remaining is 0';
    END IF;
    IF vc.product_quota_remaining(1) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'oversell: remaining changed after a failed reserve';
    END IF;

    v_remain := vc.release_product_quota(1, v_res);
    IF v_remain IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'release must restore the unit, remaining=%', v_remain;
    END IF;
    v_remain := vc.release_product_quota(1, v_res);
    IF v_remain IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'release must be idempotent, remaining=%', v_remain;
    END IF;

    SELECT out_reservation_id, out_remaining INTO v_res, v_remain
      FROM vc.reserve_product_quota(1, v_gen, 1, 1);
    IF v_remain IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 're-reserve after release must consume the restored unit';
    END IF;
    v_ok := vc.settle_product_quota(1, v_res);
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'settle must succeed for a reserved row';
    END IF;
    v_remain := vc.release_product_quota(1, v_res);
    IF v_remain IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'release after settle must not refund, remaining=%', v_remain;
    END IF;

    BEGIN
        PERFORM vc.reserve_product_quota(2, v_gen, 1, 1);
        RAISE EXCEPTION 'owner mismatch must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN
                RAISE;
            END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_remain bigint;
    v_status text;
BEGIN
    SELECT remaining INTO v_remain FROM vc.product_quota_account WHERE owner_user_id = 1;
    IF v_remain IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'durable remaining must stay 0 after settle, got %', v_remain;
    END IF;
    SELECT status INTO v_status FROM vc.product_quota_reservation
     WHERE owner_user_id = 1 AND status = 'SETTLED';
    IF v_status IS DISTINCT FROM 'SETTLED' THEN
        RAISE EXCEPTION 'a SETTLED reservation must exist after consume, got %', v_status;
    END IF;
END $$;
