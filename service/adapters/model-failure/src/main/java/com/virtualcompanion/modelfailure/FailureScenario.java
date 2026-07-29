package com.virtualcompanion.modelfailure;

/**
 * Deterministic failures supported by the local failure adapter.
 *
 * <p>These scenarios are normalized test inputs. They are not provider error
 * codes and do not define retry or persistence policy.</p>
 */
public enum FailureScenario {
    HTTP_429,
    HTTP_5XX,
    CONNECT_TIMEOUT,
    FIRST_TOKEN_TIMEOUT,
    TOTAL_TIMEOUT,
    MALFORMED_EVENT,
    DISCONNECT,
    CANCELLATION_FAILED,
    LATE_DELTA
}
