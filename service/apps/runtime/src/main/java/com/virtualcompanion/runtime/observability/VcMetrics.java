package com.virtualcompanion.runtime.observability;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

/**
 * METRICS-ALERT (§22.10 / §26.6): semantic facade over Micrometer so the
 * generation pipeline stays one call away from an instrument. Tag values are
 * terminal-state enums and catalog codes only — never free text from user
 * content (聊天原文不进指标，§22.11).
 */
public class VcMetrics {

    private final MeterRegistry registry;

    public VcMetrics(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
    }

    /** One generation turn reached a terminal outcome. */
    public void generationTerminal(String result) {
        registry.counter("vc_generation_total", "result", result).increment();
    }

    /** Wall-clock time of one handled generation work item. */
    public void generationDuration(long startNanos, String result) {
        registry.timer("vc_generation_duration", "result", result)
                .record(System.nanoTime() - startNanos, TimeUnit.NANOSECONDS);
    }

    /** Settled token usage from a finalize (kind: input | output). */
    public void tokens(String kind, long amount) {
        if (amount > 0) {
            registry.counter("vc_tokens_total", "kind", kind).increment(amount);
        }
    }

    /** One provider attempt reached a terminal ({@code LiveAttemptTerminal} name). */
    public void providerAttempt(String result) {
        registry.counter("vc_provider_attempt_total", "result", result).increment();
    }

    /** One deterministic safety event (stage + risk-levels catalog code). */
    public void safetyEvent(String stage, String riskLevel) {
        registry.counter("vc_safety_event_total", "stage", stage, "risk", riskLevel)
                .increment();
    }
}
