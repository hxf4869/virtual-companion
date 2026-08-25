package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/**
 * DOGFOOD-05 (ADR-0006 §3.3): plan state derivation (VALID / UNKNOWN /
 * DISABLED), malformed-private-config tolerance, verbatim cap carry-through
 * (never zero) and the once-per-day P2 alert on UNKNOWN.
 */
class ProviderPlanMonitorTest {

    private static final ZoneId ZONE = ZoneOffset.UTC;
    private static final Instant NOON =
            LocalDate.of(2026, 8, 24).atTime(12, 0).toInstant(ZoneOffset.UTC);

    /** Minimal mutable clock so one monitor instance can cross day borders. */
    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void advanceDays(long days) {
            now = now.plusSeconds(days * 86_400);
        }

        @Override
        public ZoneId getZone() {
            return ZONE;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private final AlertNotifier alerts = mock(AlertNotifier.class);

    private static ProviderPlanProperties props(
            boolean enabled, String from, String until, String tokenCap, String requestCap) {
        return new ProviderPlanProperties(
                enabled, "private-plan", from, until, tokenCap, requestCap);
    }

    @Test
    void disabledPlanReportsDisabledWithoutAlerting() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(false, "2026-08-01", "2026-08-31", "5", "6"),
                Clock.fixed(NOON, ZONE), alerts);

        ProviderPlanStatus status = monitor.evaluateAndAlert();

        assertThat(status.state()).isEqualTo(ProviderPlanStatus.State.DISABLED);
        assertThat(status.reason()).isEqualTo(ProviderPlanStatus.Reason.PLAN_DISABLED);
        // Plan facts stay carried verbatim; the DISABLED state is distinct
        // from UNKNOWN and must not alert.
        assertThat(status.tokenCap()).isEqualTo(5L);
        assertThat(status.requestCap()).isEqualTo(6L);
        verify(alerts, never()).alert(any(), any(), any());
        verify(alerts, never()).alert(any(), any(), any(), anyLong());
    }

    @Test
    void todayInsideWindowIsValidAndCarriesCapsVerbatim() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026-08-24", "2026-08-24", null, null),
                Clock.fixed(NOON, ZONE), alerts);

        ProviderPlanStatus status = monitor.evaluateAndAlert();

        assertThat(status.state()).isEqualTo(ProviderPlanStatus.State.VALID);
        assertThat(status.reason()).isEqualTo(ProviderPlanStatus.Reason.OK);
        assertThat(status.validFrom()).isEqualTo(LocalDate.of(2026, 8, 24));
        assertThat(status.validUntil()).isEqualTo(LocalDate.of(2026, 8, 24));
        // Unstated caps stay null — never read as zero.
        assertThat(status.tokenCap()).isNull();
        assertThat(status.requestCap()).isNull();
        verify(alerts, never()).alert(any(), any(), any());
        verify(alerts, never()).alert(any(), any(), any(), anyLong());
    }

    @Test
    void missingWindowIsUnknownAndAlertsOncePerDay() {
        MutableClock clock = new MutableClock(NOON);
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, null, null, null, null), clock, alerts);

        ProviderPlanStatus first = monitor.evaluateAndAlert();
        ProviderPlanStatus second = monitor.evaluateAndAlert();

        assertThat(first.state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        assertThat(first.reason()).isEqualTo(ProviderPlanStatus.Reason.WINDOW_MISSING);
        assertThat(second.state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        // The day-sized dedup window rides on the durable outbox so a
        // same-day restart does not repeat the alert either.
        verify(alerts, times(1)).alert(
                eq(AlertSeverity.P2),
                eq(ProviderPlanMonitor.ALERT_CODE_UNKNOWN),
                eq(ProviderPlanMonitor.ALERT_MESSAGE_UNKNOWN),
                eq(java.time.Duration.ofDays(1).toMillis()));

        // Crossing to the next day raises exactly one more alert.
        clock.advanceDays(1);
        monitor.evaluateAndAlert();
        monitor.evaluateAndAlert();
        verify(alerts, times(2)).alert(any(), any(), any(), anyLong());
    }

    @Test
    void malformedPrivateDatesAreUnknownInvalidNotACrash() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026/08/01", "2026-08-31", null, null),
                Clock.fixed(NOON, ZONE), alerts);

        ProviderPlanStatus status = monitor.evaluateAndAlert();

        assertThat(status.state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        assertThat(status.reason()).isEqualTo(ProviderPlanStatus.Reason.WINDOW_INVALID);
        assertThat(status.validFrom()).isNull();
        verify(alerts, times(1)).alert(any(), any(), any(), anyLong());
    }

    @Test
    void invertedWindowIsUnknownAsInvalid() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026-09-01", "2026-08-01", null, null),
                Clock.fixed(NOON, ZONE), alerts);

        assertThat(monitor.status().state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        assertThat(monitor.status().reason()).isEqualTo(ProviderPlanStatus.Reason.WINDOW_INVALID);
    }

    @Test
    void expiredWindowIsUnknown() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026-08-01", "2026-08-23", "100", "10"),
                Clock.fixed(NOON, ZONE), alerts);

        ProviderPlanStatus expired = monitor.evaluateAndAlert();

        assertThat(expired.state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        assertThat(expired.reason()).isEqualTo(ProviderPlanStatus.Reason.EXPIRED);
        verify(alerts, times(1)).alert(any(), any(), any(), anyLong());
    }

    @Test
    void windowNotYetStartedIsUnknown() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026-08-25", "2026-08-31", null, null),
                Clock.fixed(NOON, ZONE), alerts);

        assertThat(monitor.status().state()).isEqualTo(ProviderPlanStatus.State.UNKNOWN);
        assertThat(monitor.status().reason()).isEqualTo(ProviderPlanStatus.Reason.NOT_YET_VALID);
    }

    @Test
    void malformedCapsAreUnstatedNeverZeroAndDoNotAffectValidity() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, "2026-08-24", "2026-08-24", "not-a-number", "-3"),
                Clock.fixed(NOON, ZONE), alerts);

        ProviderPlanStatus status = monitor.status();

        assertThat(status.state()).isEqualTo(ProviderPlanStatus.State.VALID);
        assertThat(status.tokenCap()).isNull();
        assertThat(status.requestCap()).isNull();
    }

    @Test
    void startupEvaluationAlertsOnceForUnknownPlan() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, null, null, null, null), Clock.fixed(NOON, ZONE), alerts);

        monitor.afterPropertiesSet();

        verify(alerts, times(1)).alert(
                eq(AlertSeverity.P2),
                eq(ProviderPlanMonitor.ALERT_CODE_UNKNOWN),
                eq(ProviderPlanMonitor.ALERT_MESSAGE_UNKNOWN),
                anyLong());
    }

    @Test
    void alertMessageCarriesNoPlanNameCapOrDates() {
        ProviderPlanMonitor monitor = new ProviderPlanMonitor(
                props(true, null, null, "123456", "789"), Clock.fixed(NOON, ZONE), alerts);

        monitor.evaluateAndAlert();

        assertThat(ProviderPlanMonitor.ALERT_MESSAGE_UNKNOWN)
                .doesNotContain("private-plan")
                .doesNotContain("123456")
                .doesNotContain("789");
    }
}
