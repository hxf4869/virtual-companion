package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

/**
 * METRICS-ALERT: the semantic facade records counters/timers with fixed tag
 * vocabularies (terminal states and catalog codes only — never user content).
 */
class VcMetricsTest {

    @Test
    void terminalCountersCarryResultTag() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        VcMetrics metrics = new VcMetrics(registry);

        metrics.generationTerminal("completed");
        metrics.generationTerminal("completed");
        metrics.generationTerminal("blocked_input");

        assertThat(registry.counter("vc_generation_total", "result", "completed").count())
                .isEqualTo(2.0);
        assertThat(registry.counter("vc_generation_total", "result", "blocked_input").count())
                .isEqualTo(1.0);
    }

    @Test
    void durationRecordsUnderTimerWithTag() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        VcMetrics metrics = new VcMetrics(registry);

        metrics.generationDuration(System.nanoTime() - 42_000_000L, "completed");

        assertThat(registry.timer("vc_generation_duration", "result", "completed").count())
                .isEqualTo(1L);
    }

    @Test
    void tokenCountersIgnoreNonPositiveAmounts() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        VcMetrics metrics = new VcMetrics(registry);

        metrics.tokens("input", 120);
        metrics.tokens("output", 0);

        assertThat(registry.counter("vc_tokens_total", "kind", "input").count()).isEqualTo(120.0);
        assertThat(registry.counter("vc_tokens_total", "kind", "output").count()).isEqualTo(0.0);
    }

    @Test
    void safetyEventsCarryStageAndRiskTags() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        VcMetrics metrics = new VcMetrics(registry);

        metrics.safetyEvent("FINAL", "R4_IMMINENT");

        assertThat(registry.counter(
                "vc_safety_event_total", "stage", "FINAL", "risk", "R4_IMMINENT").count())
                .isEqualTo(1.0);
    }
}
