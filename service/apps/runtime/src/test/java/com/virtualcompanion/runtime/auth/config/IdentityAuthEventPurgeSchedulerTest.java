package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The purge scheduler is a plain class (no Spring context needed): the test
 * mocks the {@link JdbcTemplate} and verifies the exact purge SQL, the
 * {@code Integer} return type, and that the cutoff timestamp tracks the
 * configured retention window. The DB behaviour itself (deletes old, keeps
 * recent, vc_api cannot DELETE directly) is proven by infra/db test 62.
 */
class IdentityAuthEventPurgeSchedulerTest {

    @Test
    void purgeInvokesFunctionWithCutoffDerivedFromRetentionDays() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(
                eq(IdentityAuthEventPurgeScheduler.PURGE_SQL),
                eq(Integer.class),
                any(Timestamp.class)))
            .thenReturn(7);
        Instant before = Instant.now();

        new IdentityAuthEventPurgeScheduler(jdbc, 180).purgeExpiredAuthEvents();

        ArgumentCaptor<Timestamp> cutoff = ArgumentCaptor.forClass(Timestamp.class);
        verify(jdbc).queryForObject(
                eq(IdentityAuthEventPurgeScheduler.PURGE_SQL),
                eq(Integer.class),
                cutoff.capture());
        // The cutoff is "now - 180 days" computed inside the call, so it sits
        // between (before - 180d) and (after - 180d); checking it is within a
        // narrow window around 180 days before the call bounds the retention
        // math without depending on wall-clock exactness.
        Instant cutoffInstant = cutoff.getValue().toInstant();
        Instant expectedFloor = before.minus(180, ChronoUnit.DAYS).minus(5, ChronoUnit.SECONDS);
        Instant expectedCeiling = Instant.now().minus(180, ChronoUnit.DAYS).plus(5, ChronoUnit.SECONDS);
        assertThat(cutoffInstant).isBetween(expectedFloor, expectedCeiling);
    }

    @Test
    void purgeIsTolerantOfNullDeleteCount() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(
                eq(IdentityAuthEventPurgeScheduler.PURGE_SQL),
                eq(Integer.class),
                any(Timestamp.class)))
            .thenReturn(null);
        // A null return must not throw (defensive null-coalesce to 0).
        new IdentityAuthEventPurgeScheduler(jdbc, 180).purgeExpiredAuthEvents();
        verify(jdbc).queryForObject(
                eq(IdentityAuthEventPurgeScheduler.PURGE_SQL),
                eq(Integer.class),
                any(Timestamp.class));
    }
}
