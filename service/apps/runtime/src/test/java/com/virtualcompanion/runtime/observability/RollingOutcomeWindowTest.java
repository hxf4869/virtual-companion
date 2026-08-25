package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-05 (ADR-0006 §3.4): rolling last-20 canary window semantics —
 * NaN before the first sample, oldest-sample eviction at 21+, the 19/20
 * threshold boundary and the gauge projections.
 */
class RollingOutcomeWindowTest {

    @Test
    void emptyWindowReportsNaNRatioAndNoSamples() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RollingOutcomeWindow window = new RollingOutcomeWindow(registry);

        assertThat(window.successRate()).isNaN();
        assertThat(window.total()).isZero();
        assertThat(registry.get("vc_canary_rolling_success_20").gauge().value()).isNaN();
        assertThat(registry.get("vc_canary_rolling_total_20").gauge().value()).isZero();
    }

    @Test
    void nineteenOfTwentySuccessesSitsExactlyAtTheDogfoodBar() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RollingOutcomeWindow window = new RollingOutcomeWindow(registry);

        for (int i = 0; i < 20; i++) {
            // One failure among the first 20 attempts.
            window.record(i != 7);
        }

        assertThat(window.total()).isEqualTo(20);
        assertThat(window.successRate()).isEqualTo(19.0 / 20.0);
        assertThat(registry.get("vc_canary_rolling_successes_20").gauge().value())
                .isEqualTo(19.0);
        assertThat(registry.get("vc_canary_rolling_success_20").gauge().value())
                .isEqualTo(0.95);
    }

    @Test
    void twentyOneSamplesEvictTheOldestOne() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RollingOutcomeWindow window = new RollingOutcomeWindow(registry);

        // Sample #0 is a failure; the next 20 attempts all succeed.
        window.record(false);
        for (int i = 0; i < 20; i++) {
            window.record(true);
        }

        // The failure has been evicted: the window now holds 20 successes.
        assertThat(window.total()).isEqualTo(20);
        assertThat(window.successRate()).isEqualTo(1.0);
        assertThat(registry.get("vc_canary_rolling_successes_20").gauge().value())
                .isEqualTo(20.0);
    }

    @Test
    void evictingASuccessLowersTheRatioAgain() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RollingOutcomeWindow window = new RollingOutcomeWindow(registry);

        // 20 successes, then two failures evict the two oldest successes.
        for (int i = 0; i < 20; i++) {
            window.record(true);
        }
        window.record(false);
        window.record(false);

        assertThat(window.total()).isEqualTo(20);
        assertThat(window.successRate()).isEqualTo(18.0 / 20.0);
    }

    @Test
    void fewerThanTwentySamplesExposeThePartialRatio() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RollingOutcomeWindow window = new RollingOutcomeWindow(registry);

        window.record(true);
        window.record(true);
        window.record(false);

        assertThat(window.total()).isEqualTo(3);
        assertThat(window.successRate()).isEqualTo(2.0 / 3.0);
        assertThat(registry.get("vc_canary_rolling_total_20").gauge().value())
                .isEqualTo(3.0);
    }
}
