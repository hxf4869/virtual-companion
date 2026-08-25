package com.virtualcompanion.runtime.observability;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicLong;

/**
 * DOGFOOD-05 (ADR-0006 §3.4): rolling canary health window over the most
 * recent {@value #WINDOW_SIZE} real provider attempts.
 *
 * <p>Exposes {@code vc_canary_rolling_success_20} (0..1 success ratio, NaN
 * before the first sample), {@code vc_canary_rolling_successes_20} and
 * {@code vc_canary_rolling_total_20} so the Owner can compare against the
 * "at least 19 of the last 20" dogfood bar directly. Only real external
 * provider attempts enter the window; ZERO_LLM and degrade paths never
 * record. The window is process-local: a restart clears it, which is
 * acceptable for the single-instance Owner-only dogfood.</p>
 */
public final class RollingOutcomeWindow {

    /** ADR-0006 §3.4: the canary bar reviews the last 20 attempts. */
    public static final int WINDOW_SIZE = 20;

    private final boolean[] samples = new boolean[WINDOW_SIZE];
    private int filled = 0;
    private int nextIndex = 0;
    private long successes = 0;

    // Gauge value holders: the registry keeps only weak references, so the
    // fields above keep these reachable for the whole app life.
    private final AtomicLong ratioMilli = new AtomicLong(-1);
    private final AtomicLong successesGauge = new AtomicLong();
    private final AtomicLong totalGauge = new AtomicLong();

    public RollingOutcomeWindow(MeterRegistry registry) {
        Objects.requireNonNull(registry, "registry must not be null");
        registry.gauge("vc_canary_rolling_success_20", this.ratioMilli,
                holder -> holder.get() < 0 ? Double.NaN : holder.get() / 1000.0);
        registry.gauge("vc_canary_rolling_successes_20", this.successesGauge,
                AtomicLong::get);
        registry.gauge("vc_canary_rolling_total_20", this.totalGauge,
                AtomicLong::get);
    }

    /** Records one real provider attempt outcome into the window. */
    public synchronized void record(boolean success) {
        if (filled == WINDOW_SIZE) {
            // The slot being overwritten holds the oldest sample.
            if (samples[nextIndex]) {
                successes--;
            }
        } else {
            filled++;
        }
        samples[nextIndex] = success;
        if (success) {
            successes++;
        }
        nextIndex = (nextIndex + 1) % WINDOW_SIZE;
        totalGauge.set(filled);
        successesGauge.set(successes);
        ratioMilli.set(filled == 0 ? -1 : Math.round(successes * 1000.0 / filled));
    }

    /** Current success ratio (0..1); NaN before the first sample. */
    public synchronized double successRate() {
        return filled == 0 ? Double.NaN : (double) successes / filled;
    }

    /** Samples currently inside the window (0..WINDOW_SIZE). */
    public synchronized int total() {
        return filled;
    }
}
