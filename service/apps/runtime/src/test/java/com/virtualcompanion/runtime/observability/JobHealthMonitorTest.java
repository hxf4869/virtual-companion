package com.virtualcompanion.runtime.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.JobLease;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class JobHealthMonitorTest {

    @Test
    void alertsOnlyEnabledUnpausedStaleJobsWithFixedMetadata() {
        JobLease lease = mock(JobLease.class);
        Instant now = Instant.parse("2026-08-24T00:10:00Z");
        when(lease.readHealth()).thenReturn(List.of(
                health(JobLease.DAU_METRICS, false, now.minusSeconds(301), "SUCCEEDED", now),
                health(JobLease.EXPORT_EXPIRY, false, now.minusSeconds(10), "SUCCEEDED", now),
                health(JobLease.AUTH_EVENT_PURGE, true, now.minusSeconds(100_000), "SUCCEEDED", now),
                health(JobLease.RETENTION_PURGE, false, now.minusSeconds(100_000), "FAILED", now)));
        List<String> alerts = new ArrayList<>();
        MutableClock clock = new MutableClock(now);
        JobHealthMonitor monitor = new JobHealthMonitor(
                lease, (severity, code, message) -> alerts.add(severity + ":" + code + ":" + message),
                false, 300, 300, 90_000, 90_000, clock);

        monitor.checkFreshness();

        assertThat(alerts).containsExactly(
                "P1:DAU_METRICS_STALE:scheduled job has no recent successful completion");
    }

    @Test
    void expiredInFlightRunAlertsEvenAfterARecentSuccess() {
        JobLease lease = mock(JobLease.class);
        Instant now = Instant.parse("2026-08-24T00:10:00Z");
        when(lease.readHealth()).thenReturn(List.of(new JobLease.Health(
                JobLease.EXPORT_EXPIRY, false, false, now.minusSeconds(10),
                "STARTED", now.minusSeconds(181), null)));
        List<String> alerts = new ArrayList<>();
        JobHealthMonitor monitor = new JobHealthMonitor(
                lease, (severity, code, message) -> alerts.add(code),
                false, 300, 300, 90_000, 90_000, new MutableClock(now));

        monitor.checkFreshness();

        assertThat(alerts).containsExactly("EXPORT_EXPIRY_STALE");
    }

    @Test
    void neverRunJobGetsStartupGraceThenAlerts() {
        JobLease lease = mock(JobLease.class);
        Instant start = Instant.parse("2026-08-24T00:00:00Z");
        when(lease.readHealth()).thenReturn(List.of());
        List<String> alerts = new ArrayList<>();
        MutableClock clock = new MutableClock(start);
        JobHealthMonitor monitor = new JobHealthMonitor(
                lease, (severity, code, message) -> alerts.add(code),
                false, 300, 300, 90_000, 90_000, clock);

        monitor.checkFreshness();
        assertThat(alerts).isEmpty();
        clock.now = start.plusSeconds(301);
        monitor.checkFreshness();

        assertThat(alerts).containsExactly("DAU_METRICS_STALE", "EXPORT_EXPIRY_STALE");
    }

    @Test
    void persistedFailedRunAlertsOncePerRun() {
        JobLease lease = mock(JobLease.class);
        Instant now = Instant.parse("2026-08-24T00:10:00Z");
        when(lease.readHealth()).thenReturn(List.of(new JobLease.Health(
                JobLease.DAU_METRICS, false, false, now.minusSeconds(10),
                "FAILED", now.minusSeconds(1), now.minusSeconds(1))));
        List<String> alerts = new ArrayList<>();
        JobHealthMonitor monitor = new JobHealthMonitor(
                lease, (severity, code, message) -> alerts.add(code + ":" + message),
                false, 300, 300, 90_000, 90_000, new MutableClock(now));

        monitor.checkFreshness();
        monitor.checkFreshness();

        assertThat(alerts).containsExactly(
                "DAU_METRICS_FAILED:scheduled job reported a failed run");
    }

    @Test
    void unavailableHealthReadDoesNotThrowOrCreateUserPayload() {
        JobLease lease = mock(JobLease.class);
        when(lease.readHealth()).thenThrow(new IllegalStateException("db unavailable"));
        List<String> alerts = new ArrayList<>();
        JobHealthMonitor monitor = new JobHealthMonitor(
                lease, (severity, code, message) -> alerts.add(message),
                false, 300, 300, 90_000, 90_000,
                new MutableClock(Instant.parse("2026-08-24T00:00:00Z")));

        monitor.checkFreshness();

        assertThat(alerts).isEmpty();
    }

    private static JobLease.Health health(
            String job, boolean paused, Instant success, String status, Instant latest) {
        return new JobLease.Health(job, paused, false, success, status, latest, latest);
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        private MutableClock(Instant now) {
            this.now = now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
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
}
