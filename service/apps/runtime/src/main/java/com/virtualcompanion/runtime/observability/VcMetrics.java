package com.virtualcompanion.runtime.observability;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * METRICS-ALERT (§22.10 / §26.6): semantic facade over Micrometer so the
 * generation pipeline stays one call away from an instrument. Tag values are
 * terminal-state enums and catalog codes only — never free text from user
 * content (聊天原文不进指标，§22.11).
 */
public class VcMetrics {

    private final MeterRegistry registry;
    private final AtomicLong dau = new AtomicLong();
    /** DOGFOOD-05 (ADR-0006 §3.4): first accepted provider output latency. */
    private final Timer firstTokenTimer;

    public VcMetrics(MeterRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
        // §26.6 DAU gauge: the registry holds only a weak reference, so the
        // field above keeps the AtomicLong reachable for the whole app life.
        registry.gauge("vc_beta_dau", this.dau);
        // DOGFOOD-05: the Owner canary bar reads the P95 of this histogram
        // (≤60s); registered eagerly so the meter exists before the first
        // real provider turn.
        this.firstTokenTimer = Timer.builder("vc_generation_first_token")
                .description("Latency from outbound start to the first accepted provider output")
                .publishPercentileHistogram()
                .publishPercentiles(0.95)
                .register(registry);
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

    /**
     * DOGFOOD-05 (ADR-0006 §3.4): first-token latency of one real provider
     * attempt (outbound start → first accepted OutputDelta). Recorded at most
     * once per work item; never fired for ZERO_LLM or degrade paths.
     */
    public void firstToken(long latencyNanos) {
        if (latencyNanos >= 0) {
            firstTokenTimer.record(latencyNanos, TimeUnit.NANOSECONDS);
        }
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

    /** Current daily-active-user count, refreshed by the metrics scheduler. */
    public void dau(long value) {
        dau.set(value);
    }

    /** One alert-webhook outbox/delivery terminal (enqueued/duplicate/delivered/retried/dead/refused). */
    public void alertWebhook(String result) {
        registry.counter("vc_alert_webhook_delivery_total", "result", result).increment();
    }
}
