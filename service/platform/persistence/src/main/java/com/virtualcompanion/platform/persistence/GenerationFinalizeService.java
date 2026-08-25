package com.virtualcompanion.platform.persistence;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.RouteDecision;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Types;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Drives the generation finalize / candidate / terminalize / attempt-intent
 * SECURITY DEFINER functions (V7 {@code finalize_generation}, V15
 * {@code insert_generation_candidate} and {@code terminalize_generation}, V20
 * {@code record_provider_attempt}, V28 intent/guard/per-item family, V29
 * {@code requeue_retryable_failure}), bound to
 * the runtime {@code vc_api} JDBC pool (TASK-0176, TASK-0194).
 *
 * <p>TASK-0194 segmented flow: the worker runs each segment in its own
 * owner-bound short transaction — {@code createAttemptIntent} persists the
 * {@code CREATED} attempt intent BEFORE any outbound (intent failure forbids
 * the outbound), {@code recordAttemptOutcome} updates the same row after the
 * external phase, and the guarded finalize transaction calls
 * {@link #assertActiveClaim} (explicit work_item_id + claim_token +
 * claim_fence, never a GUC) as its first statement, then candidate + promote +
 * finalize + per-item work-item terminalize atomically.</p>
 *
 * <p>The raw claim token/fence are never persisted: only SHA-256 hashes reach
 * the database intent row.</p>
 */
public class GenerationFinalizeService {

    /** The final assistant content for a ZERO_LLM completion (audit/identity only here). */
    private static final String TERMINAL_EVENT_FAILED = "chat.failed";

    /** {@code vc.requeue_retryable_failure} branch: the item returns to PENDING with backoff. */
    public static final String RETRY_SCHEDULED = "RETRY_SCHEDULED";

    /** {@code vc.requeue_retryable_failure} branch: the attempt budget is exhausted. */
    public static final String DEAD_LETTERED = "DEAD_LETTERED";

    private final JdbcTemplate jdbc;

    private final RestFieldCipher cipher;

    public GenerationFinalizeService(JdbcTemplate jdbc) {
        this(jdbc, null);
    }

    /** CRYPTO-REST: when a cipher is wired, assistant bodies are encrypted at rest. */
    public GenerationFinalizeService(JdbcTemplate jdbc, RestFieldCipher cipher) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.cipher = cipher;
    }

    /**
     * Insert one generation candidate and return its id. The generation must be
     * non-terminal (V15 takes the generation row lock and rejects terminal
     * states). {@code is_final} stays false; {@code finalizeCompleted} flips it
     * atomically under its own lock.
     */
    public long insertCandidate(long ownerUserId, long generationId, String content) {
        validateIds(ownerUserId, generationId);
        if (content == null || content.isBlank()) {
            throw new IllegalArgumentException("content must not be blank");
        }
        String storedContent = cipher == null ? content : cipher.encrypt(content);
        Long candidateId = jdbc.queryForObject(
                "SELECT out_candidate_id FROM vc.insert_generation_candidate(?, ?, ?, false)",
                Long.class,
                ownerUserId,
                generationId,
                storedContent);
        if (candidateId == null) {
            throw new IllegalStateException("insert_generation_candidate returned no id");
        }
        return candidateId;
    }

    /**
     * Atomically finalize a FINAL_REVIEW generation to COMPLETED with the given
     * assistant content. Zero tokens and a zero SETTLE quota are settled because
     * ZERO_LLM produces no provider usage; {@code providerRef} is the
     * {@code generation_usage.provider_ref} text (empty for ZERO_LLM).
     */
    public void finalizeCompleted(
            long ownerUserId,
            long generationId,
            long candidateId,
            String content,
            String providerRef,
            boolean outboxEligible) {
        validateIds(ownerUserId, generationId);
        if (candidateId <= 0) {
            throw new IllegalArgumentException("candidateId must be positive");
        }
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        String ref = providerRef == null ? "" : providerRef;
        String storedContent = cipher == null ? content : cipher.encrypt(content);
        Boolean finalized = jdbc.queryForObject(
                "SELECT out_finalized FROM vc.finalize_generation(?, ?, ?, ?, ?, 0, 0, 0, 'USD', 0, ?, NULL)",
                Boolean.class,
                ownerUserId,
                generationId,
                candidateId,
                storedContent,
                ref,
                outboxEligible);
        if (!Boolean.TRUE.equals(finalized)) {
            throw new IllegalStateException(
                    "finalize_generation did not finalize generation " + generationId);
        }
    }

    /**
     * Record one real outbound provider attempt bound to its dual authorization
     * snapshots (V20 {@code record_provider_attempt}, INV-AUTH-001). The
     * generation must exist for the owner (existence is hidden otherwise); both
     * snapshot ids must already reference {@code authorization_snapshot} rows
     * for this owner (the composite FK enforces it). Returns the new
     * {@code provider_attempt.id}. Used by the external-provider success and
     * degraded-outcome paths (TASK-0177).
     */
    public long recordProviderAttempt(
            long ownerUserId,
            long generationId,
            String providerId,
            String supplierName,
            String status,
            String requestedSnapshotId,
            String executionSnapshotId) {
        validateIds(ownerUserId, generationId);
        requireNonBlank(providerId, "providerId");
        requireNonBlank(supplierName, "supplierName");
        requireNonBlank(status, "status");
        requireNonBlank(requestedSnapshotId, "requestedSnapshotId");
        requireNonBlank(executionSnapshotId, "executionSnapshotId");
        Long id = jdbc.queryForObject(
                "SELECT out_id FROM vc.record_provider_attempt(?, ?, ?, ?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                generationId,
                providerId,
                supplierName,
                status,
                requestedSnapshotId,
                executionSnapshotId);
        if (id == null) {
            throw new IllegalStateException("record_provider_attempt returned no id");
        }
        return id;
    }

    /**
     * Atomically finalize a FINAL_REVIEW generation to COMPLETED with the real
     * provider usage and cost reported by the external adapter session (V7
     * {@code finalize_generation}). {@code providerRef} is the
     * {@code generation_usage.provider_ref} (the provider attempt id for a real
     * external attempt); {@code quotaAmount} is the SETTLE quota units.
     * {@code outboxEligible=false} suppresses the {@code memory.extract}
     * outbox row (the memory Java domain is not yet wired; avoid a dangling
     * PENDING outbox). (TASK-0177)
     */
    public void finalizeCompletedWithUsage(
            long ownerUserId,
            long generationId,
            long candidateId,
            String content,
            String providerRef,
            long inputTokens,
            long outputTokens,
            double actualCost,
            String currency,
            int quotaAmount,
            boolean outboxEligible) {
        validateIds(ownerUserId, generationId);
        if (candidateId <= 0) {
            throw new IllegalArgumentException("candidateId must be positive");
        }
        if (content == null) {
            throw new IllegalArgumentException("content must not be null");
        }
        String ref = providerRef == null ? "" : providerRef;
        String cur = (currency == null || currency.isBlank()) ? "USD" : currency;
        String storedContent = cipher == null ? content : cipher.encrypt(content);
        Boolean finalized = jdbc.queryForObject(
                // p_actual_cost is `numeric`; a Java double binds as float8 and
                // PG's function resolution refuses the implicit candidate, so
                // cast explicitly to numeric.
                "SELECT out_finalized FROM vc.finalize_generation(?, ?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, NULL)",
                Boolean.class,
                ownerUserId,
                generationId,
                candidateId,
                storedContent,
                ref,
                inputTokens,
                outputTokens,
                actualCost,
                cur,
                quotaAmount,
                outboxEligible);
        if (!Boolean.TRUE.equals(finalized)) {
            throw new IllegalStateException(
                    "finalize_generation did not finalize generation " + generationId);
        }
    }

    /**
     * Best-effort terminalization to FAILED_FINAL with a {@code chat.failed}
     * event carrying the fault string (V15). Used by the degradation and
     * exception paths so no generation is left stuck.
     */
    public void terminalizeAsFailed(long ownerUserId, long generationId, String fault) {
        validateIds(ownerUserId, generationId);
        String detail = fault == null ? "" : fault;
        jdbc.queryForObject(
                "SELECT vc.terminalize_generation(?, ?, 'FAILED_FINAL', ?, "
                        + "('{\"fault\":\"' || ? || '\"}')::jsonb)",
                String.class,
                ownerUserId,
                generationId,
                TERMINAL_EVENT_FAILED,
                jsonEscape(detail));
    }

    /**
     * SAFETY-WIRE (V58): terminalize an input-blocked generation
     * (INPUT_REVIEW → INPUT_BLOCKED) with a durable {@code chat.blocked}
     * event carrying the deterministic rule id. The caller's message stays
     * persisted; only the generation is refused.
     */
    public void terminalizeAsInputBlocked(long ownerUserId, long generationId, String ruleId) {
        validateIds(ownerUserId, generationId);
        jdbc.queryForObject(
                "SELECT vc.terminalize_generation(?, ?, 'INPUT_BLOCKED', 'chat.blocked', "
                        + "('{\"rule\":\"' || ? || '\"}')::jsonb)",
                String.class,
                ownerUserId,
                generationId,
                jsonEscape(ruleId == null ? "" : ruleId));
    }

    /**
     * SAFETY-WIRE (V58): terminalize an output-blocked generation
     * (FINAL_REVIEW → OUTPUT_BLOCKED) with a durable {@code chat.blocked}
     * event carrying the deterministic rule id. No assistant message or
     * candidate is written on this path.
     */
    public void terminalizeAsBlocked(long ownerUserId, long generationId, String ruleId) {
        validateIds(ownerUserId, generationId);
        jdbc.queryForObject(
                "SELECT vc.terminalize_generation(?, ?, 'OUTPUT_BLOCKED', 'chat.blocked', "
                        + "('{\"rule\":\"' || ? || '\"}')::jsonb)",
                String.class,
                ownerUserId,
                generationId,
                jsonEscape(ruleId == null ? "" : ruleId));
    }

    /**
     * DOGFOOD-STABILIZATION-04 (audit defect C): mark SPECIFIC persisted
     * messages model-ineligible (V112 {@code vc.mark_messages_model_ineligible})
     * — the generation egress gate's rejection path. Call it in the SAME
     * owner transaction as the turn's terminalization: the offending rows
     * (which may belong to older turns) lose model-egress eligibility
     * atomically with the terminal state, and a later flip of the provider
     * terms flag can never re-release them.
     *
     * @return rows flipped to model_eligible=false
     */
    public int markMessagesModelIneligible(long ownerUserId, java.util.List<Long> messageIds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (messageIds == null || messageIds.isEmpty()) {
            return 0;
        }
        Long[] ids = messageIds.toArray(new Long[0]);
        Integer rows = jdbc.queryForObject(
                "SELECT vc.mark_messages_model_ineligible(?, ?)",
                Integer.class,
                ownerUserId,
                new org.springframework.jdbc.core.support.AbstractSqlTypeValue() {
                    @Override
                    protected Object createTypeValue(
                            java.sql.Connection con, int sqlType, String typeName)
                            throws java.sql.SQLException {
                        return con.createArrayOf("bigint", ids);
                    }
                });
        return rows == null ? 0 : rows;
    }

    /**
     * TASK-0194: persist the {@code CREATED} attempt intent BEFORE any outbound
     * (V28 {@code vc.create_attempt_intent}). The intent binds owner, work
     * item, generation, SHA-256 hashes of the claim token/fence, the unique
     * {@code providerAttemptId}, the dual authorization snapshots and the
     * provider/deployment identity. Only the hashes are stored — the raw claim
     * token/fence never leave the worker. A failure here aborts the prepare
     * transaction and forbids the outbound (adapter zero calls).
     *
     * @return the persisted {@code providerAttemptId}
     */
    public String createAttemptIntent(
            long ownerUserId,
            long workItemId,
            long generationId,
            String claimToken,
            String claimFence,
            String providerAttemptId,
            String providerId,
            String supplierName,
            String requestedSnapshotId,
            String executionSnapshotId,
            String modelId,
            String modelRevision,
            String promptBundleVersion,
            String personaBundleVersion,
            String configVersion) {
        validateIds(ownerUserId, generationId);
        if (workItemId <= 0) {
            throw new IllegalArgumentException("workItemId must be positive");
        }
        requireNonBlank(claimToken, "claimToken");
        requireNonBlank(claimFence, "claimFence");
        requireNonBlank(providerAttemptId, "providerAttemptId");
        requireNonBlank(providerId, "providerId");
        requireNonBlank(supplierName, "supplierName");
        requireNonBlank(requestedSnapshotId, "requestedSnapshotId");
        requireNonBlank(executionSnapshotId, "executionSnapshotId");
        requireNonBlank(modelId, "modelId");
        requireNonBlank(modelRevision, "modelRevision");
        requireNonBlank(promptBundleVersion, "promptBundleVersion");
        requireNonBlank(personaBundleVersion, "personaBundleVersion");
        requireNonBlank(configVersion, "configVersion");
        String attemptId = jdbc.queryForObject(
                "SELECT out_provider_attempt_id FROM vc.create_attempt_intent(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                String.class,
                ownerUserId,
                workItemId,
                generationId,
                sha256Hex(claimToken),
                sha256Hex(claimFence),
                providerAttemptId,
                providerId,
                supplierName,
                requestedSnapshotId,
                executionSnapshotId,
                modelId,
                modelRevision,
                promptBundleVersion,
                personaBundleVersion,
                configVersion);
        if (attemptId == null || attemptId.isBlank()) {
            throw new IllegalStateException("create_attempt_intent returned no provider_attempt_id");
        }
        return attemptId;
    }

    /**
     * TASK-0194: update the SAME intent row's outcome after the external phase
     * (V28 {@code vc.record_attempt_outcome}, {@code CREATED} → terminal only,
     * never a second row). Returns rows updated; 0 means the intent was already
     * terminal (idempotent fail-closed).
     */
    public int recordAttemptOutcome(long ownerUserId, String providerAttemptId, String status) {
        requireNonBlank(providerAttemptId, "providerAttemptId");
        requireNonBlank(status, "status");
        Integer rows = jdbc.queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?)",
                Integer.class,
                ownerUserId,
                providerAttemptId,
                status);
        return rows == null ? 0 : rows;
    }

    /**
     * S0-24-B2: atomically close an attempt intent with its monotonic
     * first-output latency and normalized failure category. A {@code null}
     * latency means that no fenced output delta reached the in-memory sink;
     * failure details are deliberately restricted to the fixed category and
     * never include exception messages or provider response bodies.
     */
    public int recordAttemptOutcome(
            long ownerUserId,
            String providerAttemptId,
            String status,
            Long firstOutputLatencyMs,
            String failureCode) {
        requireNonBlank(providerAttemptId, "providerAttemptId");
        requireNonBlank(status, "status");
        if (firstOutputLatencyMs != null && firstOutputLatencyMs < 0) {
            throw new IllegalArgumentException("firstOutputLatencyMs must be non-negative");
        }
        if (failureCode != null) {
            requireNonBlank(failureCode, "failureCode");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.record_attempt_outcome(?, ?, ?, ?, ?)",
                Integer.class,
                ownerUserId,
                providerAttemptId,
                status,
                firstOutputLatencyMs,
                failureCode);
        return rows == null ? 0 : rows;
    }

    /**
     * TASK-0194: close a still-{@code CREATED} intent as {@code ABANDONED_LATE}
     * (V28 {@code vc.abandon_late_attempt}). Audit closure only — never creates
     * an attempt and never writes business results.
     */
    public int abandonLateAttempt(long ownerUserId, String providerAttemptId) {
        requireNonBlank(providerAttemptId, "providerAttemptId");
        Integer rows = jdbc.queryForObject(
                "SELECT vc.abandon_late_attempt(?, ?)",
                Integer.class,
                ownerUserId,
                providerAttemptId);
        return rows == null ? 0 : rows;
    }

    /**
     * TASK-0194: explicit per-work-item claim guard (V28
     * {@code vc.assert_active_claim}). Validates the work item is still
     * {@code CLAIMED}, the presented token/fence match exactly and the
     * wall-clock lease has not expired; any failure RAISEs, so the caller's
     * guarded transaction aborts with zero business writes. This must be the
     * first statement of every guarded finalize/fail transaction; a
     * transaction-local GUC is never accepted as the active-claim
     * authorization.
     */
    public void assertActiveClaim(long ownerUserId, long workItemId, String claimToken, String claimFence) {
        requireNonBlank(claimToken, "claimToken");
        requireNonBlank(claimFence, "claimFence");
        jdbc.queryForObject(
                "SELECT vc.assert_active_claim(?, ?, ?, ?)",
                Object.class,
                ownerUserId,
                workItemId,
                claimToken,
                claimFence);
    }

    /**
     * TASK-0194: per-item work-item completion inside the guarded finalize
     * transaction (V28 {@code vc.complete_work_item(bigint, text, text)}).
     * Returns rows terminalized (1 on success, 0 when the claim is no longer
     * live).
     */
    public int completeWorkItem(long workItemId, String claimToken, String claimFence) {
        return terminalizePerItem("SELECT vc.complete_work_item(?, ?, ?)",
                workItemId, claimToken, claimFence);
    }

    /**
     * TASK-0194: per-item work-item failure inside the guarded fail transaction
     * (V28 {@code vc.fail_work_item(bigint, text, text)}). Returns rows
     * terminalized (1 on success, 0 when the claim is no longer live).
     */
    public int failWorkItem(long workItemId, String claimToken, String claimFence) {
        return terminalizePerItem("SELECT vc.fail_work_item(?, ?, ?)",
                workItemId, claimToken, claimFence);
    }

    /**
     * V29 RETRY-A: guarded requeue-or-dead-letter of a retryable provider
     * failure (V29 {@code vc.requeue_retryable_failure}). The work item must
     * still hold a live claim matching the presented token/fence (same guard
     * family as {@link #assertActiveClaim}); any mismatch RAISEs so the
     * caller's guarded transaction aborts with zero writes. Returns
     * {@link #RETRY_SCHEDULED} (item back to PENDING with deterministic
     * backoff) or {@link #DEAD_LETTERED} (attempt budget exhausted).
     *
     * @param maxAttempts total provider attempts allowed for the item
     *     (initial + retries); must be positive
     */
    public String requeueRetryableFailure(
            long ownerUserId, long workItemId, String claimToken, String claimFence, int maxAttempts) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (workItemId <= 0) {
            throw new IllegalArgumentException("workItemId must be positive");
        }
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be positive");
        }
        requireNonBlank(claimToken, "claimToken");
        requireNonBlank(claimFence, "claimFence");
        String branch = jdbc.queryForObject(
                "SELECT vc.requeue_retryable_failure(?, ?, ?, ?, ?)",
                String.class,
                ownerUserId,
                workItemId,
                claimToken,
                claimFence,
                maxAttempts);
        if (branch == null || branch.isBlank()) {
            throw new IllegalStateException("requeue_retryable_failure returned no branch");
        }
        return branch;
    }

    /**
     * GEN-RECONC: close every still-{@code CREATED} attempt intent of a
     * re-processed work item as {@code ABANDONED_LATE} (V33
     * {@code vc.close_stale_attempt_intents}). Called by the worker's prepare
     * segment BEFORE the new intent is created, so a retried or crash-recovered
     * run leaves no permanently-open intent behind. Audit closure only — the
     * abandoned intent writes no business results and creates no attempt.
     *
     * @return number of intents closed
     */
    public int closeStaleAttemptIntents(long ownerUserId, long workItemId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (workItemId <= 0) {
            throw new IllegalArgumentException("workItemId must be positive");
        }
        Integer closed = jdbc.queryForObject(
                "SELECT vc.close_stale_attempt_intents(?, ?)",
                Integer.class,
                ownerUserId,
                workItemId);
        return closed == null ? 0 : closed;
    }

    /**
     * GEN-RECONC: enumerate generations stuck {@code IN_PROGRESS} whose work
     * item is already terminal (V33 {@code vc.list_stale_in_progress_generations}).
     * Coordinator-side probe with no owner context — only id pairs are returned,
     * never business content. The reconciliation scheduler terminalizes each row
     * via {@link #terminalizeAsFailed}.
     */
    public List<StaleGenerationRow> listStaleInProgressGenerations() {
        return jdbc.query(
                "SELECT out_owner_user_id, out_generation_id "
                        + "FROM vc.list_stale_in_progress_generations()",
                (rs, rowNum) -> new StaleGenerationRow(
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_generation_id")));
    }

    /** GEN-RECONC: one stale generation pair for the reconciliation scheduler. */
    public record StaleGenerationRow(long ownerUserId, long generationId) {}

    /**
     * S0-11-B: persist an immutable route decision (V81
     * {@code vc.record_route_decision}). Same {@code decision_ref} is
     * idempotent when the payload matches and fail-closed when it differs.
     * Direct table DML stays revoked.
     */
    public long recordRouteDecision(
            long ownerUserId, long generationId, RouteDecision decision) {
        validateIds(ownerUserId, generationId);
        Objects.requireNonNull(decision, "decision must not be null");
        String selected = decision.selectedProviderId() == null
                ? null
                : decision.selectedProviderId().value();
        String[] candidates = decision.consideredCandidates().stream()
                .map(ProviderId::value)
                .toArray(String[]::new);
        List<Long> rows = jdbc.query(
                RECORD_ROUTE_DECISION_SQL,
                ps -> {
                    int i = 1;
                    ps.setLong(i++, ownerUserId);
                    ps.setLong(i++, generationId);
                    ps.setString(i++, decision.decisionNo());
                    ps.setString(i++, decision.status().code());
                    ps.setString(i++, decision.audit().policyVersion());
                    ps.setString(i++, decision.audit().entitledServiceClass());
                    ps.setString(i++, decision.audit().actualServiceClass());
                    ps.setString(i++, decision.audit().outcomeReason());
                    if (selected == null) {
                        ps.setNull(i++, Types.VARCHAR);
                    } else {
                        ps.setString(i++, selected);
                    }
                    ps.setArray(i, ps.getConnection().createArrayOf("text", candidates));
                },
                (rs, rowNum) -> rs.getLong("out_id"));
        if (rows.size() != 1) {
            throw new IllegalStateException(
                    "record_route_decision returned " + rows.size() + " rows");
        }
        return rows.getFirst();
    }

    static final String RECORD_ROUTE_DECISION_SQL = """
            SELECT out_id FROM vc.record_route_decision(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    private int terminalizePerItem(String sql, long workItemId, String claimToken, String claimFence) {
        requireNonBlank(claimToken, "claimToken");
        requireNonBlank(claimFence, "claimFence");
        if (workItemId <= 0) {
            throw new IllegalArgumentException("workItemId must be positive");
        }
        Integer rows = jdbc.queryForObject(
                sql, Integer.class, workItemId, claimToken, claimFence);
        return rows == null ? 0 : rows;
    }

    private static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 unavailable", impossible);
        }
    }

    private static String jsonEscape(String value) {
        // Minimal JSON-string escaping for the fault field; the value is a
        // short internal diagnostic, never user content.
        StringBuilder sb = new StringBuilder(value.length() + 8);
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    private static void validateIds(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
    }

    private static void requireNonBlank(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }
}
