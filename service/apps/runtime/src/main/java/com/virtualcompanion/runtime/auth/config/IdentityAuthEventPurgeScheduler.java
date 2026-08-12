package com.virtualcompanion.runtime.auth.config;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * Daily retention purge for the append-only {@code identity_auth_event} audit
 * trail (V14). The audit table accumulates LOGIN_SUCCESS / LOGIN_FAILURE /
 * LOGOUT / ACCOUNT_CREATE rows indefinitely and never stores a password, raw
 * token or token hash. {@code vc_api} has no table-level DELETE on it, so the
 * V22 {@code vc.identity_auth_event_purge(timestamptz)} SECURITY DEFINER
 * function is the only deletion path: this scheduler calls it once a day with a
 * cutoff of {@code now() - retentionDays} (default 180, per the Owner-authorized
 * P2-03 retention policy) and logs how many stale events were removed.
 *
 * <p>The bean is registered by {@link AuthDataSourceConfig} only while the auth
 * datasource is enabled, and {@link EnableScheduling} on the same conditional
 * configuration activates Spring's scheduler solely in that state -- there is
 * no purge activity without a live database. The purge is idempotent, so a
 * repeat run with an unchanged cutoff removes zero additional rows.
 */
public class IdentityAuthEventPurgeScheduler {

    private static final Logger log = LoggerFactory.getLogger(IdentityAuthEventPurgeScheduler.class);

    /** The schema-qualified purge call; mirrors the IdentityAccountRepository SELECT-fn convention. */
    static final String PURGE_SQL = "SELECT vc.identity_auth_event_purge(?)";

    private final JdbcTemplate authJdbcTemplate;
    private final int retentionDays;

    public IdentityAuthEventPurgeScheduler(JdbcTemplate authJdbcTemplate, int retentionDays) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.retentionDays = retentionDays;
    }

    /**
     * Fire once a day in the small hours. The cron and retention window are
     * configurable so an operator can tune cadence and policy without a code
     * change; the defaults realize the Owner-decided 180-day retention with an
     * off-peak daily run.
     */
    @Scheduled(cron = "${virtual-companion.auth.audit-purge-cron:0 17 3 * * *}")
    public void purgeExpiredAuthEvents() {
        Instant cutoff = Instant.now().minus(retentionDays, ChronoUnit.DAYS);
        Integer deleted = authJdbcTemplate.queryForObject(
                PURGE_SQL, Integer.class, Timestamp.from(cutoff));
        int removed = deleted == null ? 0 : deleted;
        log.info("identity_auth_event retention purge: removed {} audit events older than {} days",
                removed, retentionDays);
    }
}
