package com.virtualcompanion.runtime.observability;

import java.time.LocalDate;
import java.util.Objects;

/**
 * DOGFOOD-05 (ADR-0006 §3.3): the derived provider-plan state plus the
 * operator-supplied plan facts, carried verbatim (never fabricated).
 *
 * <p>{@code State.UNKNOWN} means the plan is enabled but its configuration is
 * missing, invalid or outside its validity window. Consumers must not treat a
 * null cap as zero and must not display a cost or remaining allowance under
 * UNKNOWN.</p>
 *
 * @param state      VALID | UNKNOWN | DISABLED
 * @param reason     fixed machine reason for the state (never free text)
 * @param planName   operator-supplied plan label (nullable)
 * @param validFrom  configured window start (nullable)
 * @param validUntil configured window end (nullable)
 * @param tokenCap   configured token cap (nullable — absent means "not
 *                   stated", never zero)
 * @param requestCap configured request cap (nullable — same rule)
 */
public record ProviderPlanStatus(
        State state,
        Reason reason,
        String planName,
        LocalDate validFrom,
        LocalDate validUntil,
        Long tokenCap,
        Long requestCap) {

    public enum State { VALID, UNKNOWN, DISABLED }

    public enum Reason {
        OK,
        PLAN_DISABLED,
        WINDOW_MISSING,
        WINDOW_INVALID,
        NOT_YET_VALID,
        EXPIRED
    }

    public ProviderPlanStatus {
        Objects.requireNonNull(state, "state must not be null");
        Objects.requireNonNull(reason, "reason must not be null");
    }
}
