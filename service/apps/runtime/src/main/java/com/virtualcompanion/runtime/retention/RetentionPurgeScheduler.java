package com.virtualcompanion.runtime.retention;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
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
    private final boolean dryRun;
    private final String holder = UUID.randomUUID().toString();

    public RetentionPurgeScheduler(JdbcTemplate authJdbcTemplate, AlertNotifier alertNotifier) {
        this(authJdbcTemplate, alertNotifier, null);
    }

    public RetentionPurgeScheduler(
            JdbcTemplate authJdbcTemplate, AlertNotifier alertNotifier, JobLease jobLease) {
        this(authJdbcTemplate, alertNotifier, jobLease, false);
    }

    public RetentionPurgeScheduler(
            JdbcTemplate authJdbcTemplate,
            AlertNotifier alertNotifier,
            JobLease jobLease,
            boolean dryRun) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.alertNotifier = alertNotifier;
        this.jobLease = jobLease;
        this.dryRun = dryRun;
    }

    /**
     * Fire once a day in the small hours (off-peak, after the audit purge).
     * The cron is configurable so an operator can tune cadence without a code
     * change; periods come exclusively from the policy table.
     *
     * <p>DOGFOOD-STABILIZATION audit: a category with no ACTIVE policy row
     * (DRAFT) records {@code SKIP} — no alert, and the run does not become
     * FAILED merely because inactive categories exist. An ACTIVATED category
     * whose probe/policy read or purge SQL fails still fails closed: one P1
     * {@code RETENTION_PURGE_FAILED} per failing category and a FAILED run
     * overall.</p>
     */
    @Scheduled(cron = "${virtual-companion.retention.purge-cron:0 47 3 * * *}")
    public void purgeExpiredData() {
        Optional<JobLease.Run> run = jobLease == null
                ? Optional.empty()
                : jobLease.beginExclusiveRun(JobLease.RETENTION_PURGE, holder, 600);
        if (jobLease != null && run.isEmpty()) {
            return;
        }
        boolean effectiveDryRun = dryRun || run.map(JobLease.Run::dryRun).orElse(false);
        Map<String, String> counts = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : PURGE_FUNCTIONS.entrySet()) {
            String category = entry.getKey();
            try {
                // Activation probe first: DRAFT categories skip silently, a
                // failing probe (activated or not) stays fail-closed.
                Boolean activated = authJdbcTemplate.queryForObject(
                        "SELECT vc.retention_category_active(?)", Boolean.class, category);
                if (!Boolean.TRUE.equals(activated)) {
                    counts.put(category, "SKIP");
                    log.info("retention category {} has no ACTIVE policy (DRAFT); skipped",
                            category);
                    continue;
                }
                Integer days = authJdbcTemplate.queryForObject(
                        "SELECT vc.active_retention_days(?)", Integer.class, category);
                if (days == null || days <= 0) {
                    throw new IllegalStateException("policy returned no positive retain_days");
                }
                Integer removed = authJdbcTemplate.queryForObject(
                        "SELECT vc.run_retention_category(?, ?)",
                        Integer.class, category, effectiveDryRun);
                int n = removed == null ? 0 : removed;
                counts.put(category, String.valueOf(n));
                log.info("retention {} {}: {} rows older than {} days",
                        effectiveDryRun ? "dry-run" : "purge", category, n, days);
            } catch (RuntimeException e) {
                log.error("retention category {} failed", category, e);
                counts.put(category, "FAIL");
                alertNotifier.alert(AlertSeverity.P1,
                        "RETENTION_PURGE_FAILED",
                        "category=" + category);
            }
        }
        if (run.isPresent()) {
            boolean failed = counts.containsValue("FAIL");
            String status = failed ? "FAILED" : effectiveDryRun ? "DRY_RUN" : "SUCCEEDED";
            jobLease.finishRun(
                    run.get().id(),
                    status,
                    countsJson(counts),
                    failed ? "category_failed" : "");
        }
    }

    private static String countsJson(Map<String, String> counts) {
        StringBuilder json = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, String> entry : counts.entrySet()) {
            if (!first) {
                json.append(',');
            }
            first = false;
            json.append('"').append(entry.getKey()).append('"')
                    .append(':').append('"').append(entry.getValue()).append('"');
        }
        return json.append('}').toString();
    }
}
