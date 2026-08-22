-- 136_alert_webhook_outbox: S0-31-A V85 — enqueue is durable and deduped;
-- claim uses SKIP LOCKED; complete delivers / retries / dead-letters;
-- runtime roles have no table DML; no owner context required.

\set ON_ERROR_STOP on

TRUNCATE vc.alert_webhook_outbox;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
    v_inserted boolean;
    v_again bigint;
    v_again_inserted boolean;
    v_claim_id bigint;
    v_code text;
    v_done boolean;
    v_n integer;
BEGIN
    SELECT out_id, out_inserted INTO v_id, v_inserted
      FROM vc.enqueue_alert_webhook('P2', 'DAU_CAP_REACHED', 'daily cap', 60);
    IF v_id IS NULL OR v_id <= 0 OR v_inserted IS NOT TRUE THEN
        RAISE EXCEPTION 'first enqueue must insert, got % %', v_id, v_inserted;
    END IF;

    SELECT out_id, out_inserted INTO v_again, v_again_inserted
      FROM vc.enqueue_alert_webhook('P2', 'DAU_CAP_REACHED', 'daily cap again', 60);
    IF v_again IS DISTINCT FROM v_id OR v_again_inserted IS NOT FALSE THEN
        RAISE EXCEPTION 'same-window enqueue must dedup, got % %', v_again, v_again_inserted;
    END IF;

    SELECT out_id, out_code INTO v_claim_id, v_code
      FROM vc.claim_alert_webhook(8);
    IF v_claim_id IS DISTINCT FROM v_id OR v_code IS DISTINCT FROM 'DAU_CAP_REACHED' THEN
        RAISE EXCEPTION 'claim must return the pending row';
    END IF;

    v_done := vc.complete_alert_webhook(v_claim_id, 'DELIVERED', NULL, 5, 5);
    IF v_done IS NOT TRUE THEN
        RAISE EXCEPTION 'delivered complete must return true';
    END IF;

    SELECT out_id, out_inserted INTO v_id, v_inserted
      FROM vc.enqueue_alert_webhook('P1', 'BUDGET_HALT_REACHED', 'budget halt', 60);
    IF v_inserted IS NOT TRUE THEN
        RAISE EXCEPTION 'distinct code must insert';
    END IF;
    SELECT out_id INTO v_claim_id FROM vc.claim_alert_webhook(8);
    v_done := vc.complete_alert_webhook(v_claim_id, 'RETRY', 'retryable', 1, 5);
    IF v_done IS NOT TRUE THEN
        RAISE EXCEPTION 'retry at max attempts must still complete';
    END IF;

    SELECT count(*) INTO v_n FROM vc.alert_webhook_outbox WHERE status = 'DEAD';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'retry at max attempts must dead-letter, dead=%', v_n;
    END IF;

    BEGIN
        INSERT INTO vc.alert_webhook_outbox(
            severity, code, message, window_start, status)
        VALUES ('P0', 'X', 'x', now(), 'PENDING');
        RAISE EXCEPTION 'direct INSERT on alert_webhook_outbox must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;
