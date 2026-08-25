package com.virtualcompanion.runtime.observability;

import java.time.Clock;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.InitializingBean;

/**
 * DOGFOOD-05 (ADR-0006 §3.3): derives the provider-plan status from the
 * private configuration and alerts once per day while it stays UNKNOWN.
 *
 * <p>UNKNOWN (enabled plan whose window is missing, invalid or expired) keeps
 * the single Owner canary running — this monitor never gates an outbound —
 * but it must alert. Deduplication is one P2 {@code PROVIDER_PLAN_UNKNOWN}
 * alert per calendar day (evaluated at startup and on every status read), so
 * per-request traffic can never flood the channel; the alert message is a
 * fixed string without plan names, cap numbers or any private configuration
 * value. Consumers display UNKNOWN without any zero cost or fabricated
 * remaining allowance; an unstated cap is never coerced to zero.</p>
 */
public final class ProviderPlanMonitor implements InitializingBean {

    static final String ALERT_CODE_UNKNOWN = "PROVIDER_PLAN_UNKNOWN";
    static final String ALERT_MESSAGE_UNKNOWN =
            "provider plan enabled but its applicability window is missing, invalid or expired; "
                    + "owner canary continues; no quota or remaining allowance is displayed";

    private static final Logger log = LoggerFactory.getLogger(ProviderPlanMonitor.class);

    private final ProviderPlanProperties properties;
    private final Clock clock;
    private final AlertNotifier alertNotifier;
    /** Epoch day of the last UNKNOWN alert; MIN_VALUE means "not yet alerted". */
    private final AtomicLong lastUnknownAlertEpochDay = new AtomicLong(Long.MIN_VALUE);

    public ProviderPlanMonitor(
            ProviderPlanProperties properties,
            Clock clock,
            AlertNotifier alertNotifier) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.alertNotifier = Objects.requireNonNull(alertNotifier, "alertNotifier must not be null");
    }

    /** Startup evaluation so a persistently UNKNOWN plan alerts from day one. */
    @Override
    public void afterPropertiesSet() {
        ProviderPlanStatus status = evaluateAndAlert();
        log.info("provider plan status at startup: {} ({})", status.state(), status.reason());
    }

    /** Pure state derivation; no alerting side effect. */
    public ProviderPlanStatus status() {
        if (!properties.enabled()) {
            return build(ProviderPlanStatus.State.DISABLED, ProviderPlanStatus.Reason.PLAN_DISABLED);
        }
        if (properties.validFrom() == null || properties.validUntil() == null) {
            return build(ProviderPlanStatus.State.UNKNOWN, ProviderPlanStatus.Reason.WINDOW_MISSING);
        }
        LocalDate from = parseDate(properties.validFrom());
        LocalDate until = parseDate(properties.validUntil());
        if (from == null || until == null) {
            // A malformed private date is an invalid window, not a crash.
            return build(ProviderPlanStatus.State.UNKNOWN, ProviderPlanStatus.Reason.WINDOW_INVALID);
        }
        if (from.isAfter(until)) {
            return build(ProviderPlanStatus.State.UNKNOWN, ProviderPlanStatus.Reason.WINDOW_INVALID);
        }
        LocalDate today = LocalDate.now(clock);
        if (today.isBefore(from)) {
            return build(ProviderPlanStatus.State.UNKNOWN, ProviderPlanStatus.Reason.NOT_YET_VALID);
        }
        if (today.isAfter(until)) {
            return build(ProviderPlanStatus.State.UNKNOWN, ProviderPlanStatus.Reason.EXPIRED);
        }
        return build(ProviderPlanStatus.State.VALID, ProviderPlanStatus.Reason.OK);
    }

    /**
     * Derives the status and raises at most one P2 alert per calendar day
     * while the status is UNKNOWN. Safe to call per request.
     *
     * <p>Two dedup layers, no second state store: the in-process epoch-day
     * CAS below (also covers no-database contexts), plus the durable
     * outbox's day-sized per-code window via
     * {@link AlertNotifier#alert(AlertSeverity, String, String, long)} — so
     * a same-day process restart does not repeat the alert either.</p>
     */
    public ProviderPlanStatus evaluateAndAlert() {
        ProviderPlanStatus status = status();
        if (status.state() != ProviderPlanStatus.State.UNKNOWN) {
            return status;
        }
        long today = LocalDate.now(clock).toEpochDay();
        for (;;) {
            long last = lastUnknownAlertEpochDay.get();
            if (last == today) {
                return status;
            }
            if (lastUnknownAlertEpochDay.compareAndSet(last, today)) {
                alertNotifier.alert(
                        AlertSeverity.P2,
                        ALERT_CODE_UNKNOWN,
                        ALERT_MESSAGE_UNKNOWN,
                        java.time.Duration.ofDays(1).toMillis());
                return status;
            }
        }
    }

    private ProviderPlanStatus build(ProviderPlanStatus.State state, ProviderPlanStatus.Reason reason) {
        return new ProviderPlanStatus(
                state,
                reason,
                properties.planName(),
                parseDate(properties.validFrom()),
                parseDate(properties.validUntil()),
                parseCap(properties.tokenCap()),
                parseCap(properties.requestCap()));
    }

    private static LocalDate parseDate(String value) {
        if (value == null) {
            return null;
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException invalid) {
            return null;
        }
    }

    /**
     * A malformed or unstated cap is "not stated" (null) — never zero. The
     * plan window, not the cap, decides VALID vs UNKNOWN.
     */
    private static Long parseCap(String value) {
        if (value == null) {
            return null;
        }
        try {
            long parsed = Long.parseLong(value);
            return parsed > 0 ? parsed : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }
}
