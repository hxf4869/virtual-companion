package com.virtualcompanion.runtime.observability;

/**
 * METRICS-ALERT alert sink. Implementations must never throw into the
 * business path: an alerting failure is logged, never propagated.
 */
public interface AlertNotifier {

    void alert(AlertSeverity severity, String code, String message);

    /**
     * Alert with an explicit per-code dedup window (DOGFOOD-STABILIZATION
     * audit). Callers whose duplicate suppression must survive a same-day
     * process restart (e.g. the daily PROVIDER_PLAN_UNKNOWN P2) pass a
     * day-sized window; the durable outbox implementation deduplicates in
     * the database per code, so no second state store is introduced. The
     * default delegates to the plain method (standard global throttle).
     */
    default void alert(
            AlertSeverity severity, String code, String message, long dedupWindowMillis) {
        alert(severity, code, message);
    }
}
