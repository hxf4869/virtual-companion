package com.virtualcompanion.runtime.observability;

import java.time.Duration;

/**
 * Shared fixtures for tests that construct controllers/services manually:
 * inert alert properties (blank URL = disabled channel) and a no-op sink.
 */
public final class TestAlerts {

    public static AlertProperties props() {
        return new AlertProperties("", Duration.ofSeconds(2), 60_000L, 24L, 1L, "", "", 5, 5);
    }

    public static AlertNotifier noop() {
        return (severity, code, message) -> { };
    }

    /** In-memory metrics instance for manual construction sites. */
    public static VcMetrics metrics() {
        return new VcMetrics(new io.micrometer.core.instrument.simple.SimpleMeterRegistry());
    }

    private TestAlerts() {
    }
}
