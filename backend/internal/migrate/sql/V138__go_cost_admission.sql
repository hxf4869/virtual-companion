-- F04: reuse the existing versioned price/reservation ledger for both Go
-- outbound paths. Each call holds its configured monetary ceiling, not a
-- bytes/4 estimate. Amounts on the Go/config boundary are integer micro-USD;
-- model_unit_price and the existing monthly ledger retain USD numeric units.
SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_hold_model_cost(
    p_owner bigint, p_job bigint, p_attempt text,
    p_provider text, p_model text, p_input_tokens bigint, p_output_tokens bigint,
    p_ceiling bigint, p_monthly_limit bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog AS $$
DECLARE
    v_price vc.model_unit_price%ROWTYPE;
    v_month date := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_hold numeric(18,6);
    v_spend numeric;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_ceiling IS NULL OR p_ceiling <= 0 OR p_monthly_limit IS NULL OR p_monthly_limit <= 0 THEN
        RAISE EXCEPTION 'model cost limits are not configured';
    END IF;
    SELECT * INTO v_price FROM vc.model_unit_price
     WHERE provider_id = p_provider AND model_id = p_model
       AND active AND effective_from <= clock_timestamp()
     ORDER BY price_version DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'model cost unit price is unknown';
    END IF;
    v_hold := p_ceiling::numeric / 1000000;
    -- The frozen token budgets must at least fit the configured monetary cap.
    -- We still reserve the whole ceiling because input token counts are estimates.
    IF (p_input_tokens * v_price.input_usd_per_1k
        + p_output_tokens * v_price.output_usd_per_1k) / 1000 > v_hold THEN
        RAISE EXCEPTION 'model cost reservation ceiling is too small';
    END IF;
    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;
    SELECT reserved_usd + settled_usd INTO v_spend FROM vc.month_cost_budget
     WHERE month_start = v_month FOR UPDATE;
    IF v_spend + v_hold > p_monthly_limit::numeric / 1000000 THEN
        RAISE EXCEPTION 'monthly cost hard cap exceeded';
    END IF;
    UPDATE vc.month_cost_budget SET reserved_usd = reserved_usd + v_hold
     WHERE month_start = v_month;
    INSERT INTO vc.model_cost_reservation(
        owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
        price_version, month_start, estimated_input_tokens, estimated_output_tokens,
        input_usd_per_1k, output_usd_per_1k, reserved_usd)
    VALUES (p_owner, p_job, p_attempt, p_provider, p_model,
        v_price.price_version, v_month, p_input_tokens, p_output_tokens,
        v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold);
END;
$$;

-- The reservation is the cost truth, including its frozen price and month.
-- Terminal attempt/job transitions close it in the same transaction, including
-- recovery and cancellation. Thus a crash cannot leave a permanently held cap.
CREATE FUNCTION vc.go_settle_held_model_cost(
    p_attempt text, p_disposition text, p_input bigint, p_output bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
BEGIN
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_attempt FOR UPDATE;
    IF NOT FOUND THEN
        -- Older, already-running attempts predate priced admission. New Go
        -- preparations always insert the hold before returning to model I/O.
        RETURN NULL;
    END IF;
    IF v_row.status <> 'HELD' THEN
        RETURN round(coalesce(v_row.actual_usd, 0) * 1000000)::bigint;
    END IF;
    IF p_disposition = 'NOT_SENT' THEN
        PERFORM vc.release_model_cost(p_attempt);
        RETURN 0;
    END IF;
    IF p_disposition = 'USAGE_REPORTED' AND p_input IS NOT NULL AND p_output IS NOT NULL THEN
        SELECT out_actual_usd INTO v_actual
          FROM vc.settle_model_cost(p_attempt, p_input, p_output);
    ELSE
        v_actual := v_row.reserved_usd;
        UPDATE vc.month_cost_budget
           SET reserved_usd = reserved_usd - v_row.reserved_usd,
               settled_usd = settled_usd + v_actual
         WHERE month_start = v_row.month_start;
        UPDATE vc.model_cost_reservation
           SET status = 'SETTLED', actual_usd = v_actual, settled_at = clock_timestamp()
         WHERE id = v_row.id;
    END IF;
    RETURN round(v_actual * 1000000)::bigint;
END;
$$;

CREATE FUNCTION vc.go_settle_attempt_cost_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog AS $$
DECLARE v_actual bigint;
BEGIN
    IF OLD.status = 'CREATED' AND NEW.status <> 'CREATED' THEN
        IF TG_TABLE_NAME = 'attempt_intent' THEN
            v_actual := vc.go_settle_held_model_cost(NEW.provider_attempt_id,
                NEW.billing_disposition, NEW.input_tokens, NEW.output_tokens);
            IF v_actual IS NOT NULL THEN NEW.actual_cost := v_actual; END IF;
        ELSE
            PERFORM vc.go_settle_held_model_cost('memory-extract:' || NEW.id::text,
                NEW.billing_disposition, NEW.input_tokens, NEW.output_tokens);
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER go_generation_cost_outcome BEFORE UPDATE OF status ON vc.attempt_intent
FOR EACH ROW EXECUTE FUNCTION vc.go_settle_attempt_cost_trigger();
CREATE TRIGGER go_extract_cost_outcome BEFORE UPDATE OF status ON vc.memory_extract_attempt
FOR EACH ROW EXECUTE FUNCTION vc.go_settle_attempt_cost_trigger();

CREATE FUNCTION vc.go_close_job_cost_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog AS $$
DECLARE v_attempt text;
BEGIN
    IF NEW.status IN ('DONE', 'FAILED', 'CANCELLED', 'DEAD_LETTERED') AND OLD.status IS DISTINCT FROM NEW.status THEN
        FOR v_attempt IN SELECT provider_attempt_id FROM vc.model_cost_reservation
         WHERE owner_user_id = NEW.owner_user_id AND work_item_id = NEW.id AND status = 'HELD'
           AND (EXISTS (SELECT 1 FROM vc.attempt_intent a
                         WHERE a.provider_attempt_id = model_cost_reservation.provider_attempt_id
                           AND a.attempt_no IS NOT NULL)
                OR EXISTS (SELECT 1 FROM vc.memory_extract_attempt a
                            WHERE 'memory-extract:' || a.id::text = model_cost_reservation.provider_attempt_id))
        LOOP
            PERFORM vc.go_settle_held_model_cost(v_attempt, 'UNKNOWN', NULL, NULL);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER go_job_cost_terminal AFTER UPDATE OF status ON vc.work_item
FOR EACH ROW EXECUTE FUNCTION vc.go_close_job_cost_trigger();

CREATE OR REPLACE FUNCTION vc.scrub_model_cost_on_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog AS $$
DECLARE v_attempt text;
BEGIN
    FOR v_attempt IN SELECT provider_attempt_id FROM vc.model_cost_reservation
      WHERE owner_user_id = NEW.account_id AND status = 'HELD'
    LOOP
        IF EXISTS (SELECT 1 FROM vc.attempt_intent a
                    WHERE a.provider_attempt_id = v_attempt AND a.attempt_no IS NOT NULL)
           OR EXISTS (SELECT 1 FROM vc.memory_extract_attempt a
                       WHERE 'memory-extract:' || a.id::text = v_attempt) THEN
            PERFORM vc.go_settle_held_model_cost(v_attempt, 'UNKNOWN', NULL, NULL);
        ELSE
            -- Preserve V105's existing disposition for legacy reservations;
            -- only Go's proven attempt intents may represent an unknown send.
            PERFORM vc.release_model_cost(v_attempt);
        END IF;
    END LOOP;
    UPDATE vc.model_cost_reservation SET owner_user_id = NULL
     WHERE owner_user_id = NEW.account_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_hold_model_cost(bigint,bigint,text,text,text,bigint,bigint,bigint,bigint),
    vc.go_settle_held_model_cost(text,text,bigint,bigint),
    vc.go_settle_attempt_cost_trigger(), vc.go_close_job_cost_trigger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_hold_model_cost(bigint,bigint,text,text,text,bigint,bigint,bigint,bigint)
    TO vc_api, vc_worker;
