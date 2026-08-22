package com.virtualcompanion.runtime.retention;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.OptionalLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import com.virtualcompanion.platform.persistence.JobLease;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.UUID;

/**
 * RETENTION (§16.7 / R48): daily categorized purge driven by the versioned
 * {@code vc.data_retention_policy} table (V70). For every category the
 * scheduler reads the effective {@code retain_days} from the newest ACTIVE
 * policy row (fail-closed SD) and calls the matching age-only SECURITY
 * DEFINER purge — the runtime never hardcodes a period.
 *
 * <p>One failing category alerts P1 ({@code RETENTION_PURGE_FAILED}) and does
 * not stop the others; the run is idempotent, so the next day's pass retries
 * naturally. The bean is registered by {@code AuthDataSourceConfig} only while
 * the auth datasource is live, and only when
 * {@code virtual-companion.retention.enabled=true}: the seeded v1 periods are
 * a DRAFT pending Owner/legal review (§16.7), so no deployment purges user
 * data before the policy review lands.
 */
public class RetentionPurgeScheduler {

    private static final Logger log = LoggerFactory.getLogger(RetentionPurgeScheduler.class);

    /** Category -> V70 purge function, in policy-table order. */
    private static final Map<String, String> PURGE_FUNCTIONS = new LinkedHashMap<>();

    static {
        PURGE_FUNCTIONS.put("NORMAL_CHAT", "vc.retention_purge_normal_chat");
        PURGE_FUNCTIONS.put("DELETED_CHAT", "vc.retention_purge_deleted_chat");
        PURGE_FUNCTIONS.put("MEMORY_CANDIDATE", "vc.retention_purge_memory_candidate");
        PURGE_FUNCTIONS.put("REJECTED_CANDIDATE", "vc.retention_purge_rejected_candidate");
        PURGE_FUNCTIONS.put("MODEL_CALL_DETAIL", "vc.retention_purge_model_call_detail");
        PURGE_FUNCTIONS.put("SAFETY_LOG", "vc.retention_purge_safety_log");
        PURGE_FUNCTIONS.put("EXPORT_RESIDUE", "vc.retention_purge_export_residue");
        PURGE_FUNCTIONS.put("STREAM_FRAGMENT", "vc.retention_purge_stream_fragment");
    }

    private final JdbcTemplate authJdbcTemplate;
    private final AlertNotifier alertNotifier;
    private final JobLease jobLease;
    private final String holder = UUID.randomUUID().toString();

    public RetentionPurgeScheduler(JdbcTemplate authJdbcTemplate, AlertNotifier alertNotifier) {
        this(authJdbcTemplate, alertNotifier, null);
    }

    public RetentionPurgeScheduler(
            JdbcTemplate authJdbcTemplate, AlertNotifier alertNotifier, JobLease jobLease) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.alertNotifier = alertNotifier;
        this.jobLease = jobLease;
    }

    /**
     * Fire once a day in the small hours (off-peak, after the audit purge).
     * The cron is configurable so an operator can tune cadence without a code
     * change; periods come exclusively from the policy table.
     */
    @Scheduled(cron = "${virtual-companion.retention.purge-cron:0 47 3 * * *}")
    public void purgeExpiredData() {
        OptionalLong runId = jobLease == null
                ? OptionalLong.empty()
                : jobLease.beginExclusive(JobLease.RETENTION_PURGE, holder, 600);
        if (jobLease != null && runId.isEmpty()) {
            return;
        }
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : PURGE_FUNCTIONS.entrySet()) {
            String category = entry.getKey();
            try {
                Integer days = authJdbcTemplate.queryForObject(
                        "SELECT vc.active_retention_days(?)", Integer.class, category);
                if (days == null || days <= 0) {
                    throw new IllegalStateException("policy returned no positive retain_days");
                }
                Instant cutoff = Instant.now().minus(days, ChronoUnit.DAYS);
                Integer removed = authJdbcTemplate.queryForObject(
                        "SELECT " + entry.getValue() + "(?)",
                        Integer.class,
                        Timestamp.from(cutoff));
                int n = removed == null ? 0 : removed;
                counts.put(category, n);
                log.info("retention purge {}: removed {} rows older than {} days",
                        category, n, days);
            } catch (RuntimeException e) {
                log.error("retention purge {} failed", category, e);
                counts.put(category, -1);
                alertNotifier.alert(AlertSeverity.P1,
                        "RETENTION_PURGE_FAILED",
                        "category=" + category);
            }
        }
        if (runId.isPresent()) {
            boolean failed = counts.values().stream().anyMatch(n -> n < 0);
            jobLease.finishRun(
                    runId.getAsLong(),
                    failed ? "FAILED" : "SUCCEEDED",
                    countsJson(counts),
                    failed ? "category_failed" : "");
        }
    }

    private static String countsJson(Map<String, Integer> counts) {
        StringBuilder json = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            if (!first) {
                json.append(',');
            }
            first = false;
            json.append('"').append(entry.getKey()).append('"')
                    .append(':').append(entry.getValue());
        }
        return json.append('}').toString();
    }
}
