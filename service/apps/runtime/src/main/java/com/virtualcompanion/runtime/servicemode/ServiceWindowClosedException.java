package com.virtualcompanion.runtime.servicemode;

/**
 * SVC-WINDOW (§24.7 / FR-RES-002): a new generative turn was refused by the
 * Beta service window (paused, outside the generation window, or the daily
 * active cap). Maps to 403 {@code BETA_OPERATIONS_NOT_READY} — history,
 * memory and data rights remain available; only new generative turns stop.
 */
public class ServiceWindowClosedException extends RuntimeException {

    /** Stable machine reason (service-paused / outside-generation-window / daily-active-limit). */
    private final String reason;

    public ServiceWindowClosedException(String reason) {
        super("new generative turns are closed: " + reason);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
