package com.virtualcompanion.runtime.observability;

/**
 * METRICS-ALERT alert sink. Implementations must never throw into the
 * business path: an alerting failure is logged, never propagated.
 */
public interface AlertNotifier {

    void alert(AlertSeverity severity, String code, String message);
}
