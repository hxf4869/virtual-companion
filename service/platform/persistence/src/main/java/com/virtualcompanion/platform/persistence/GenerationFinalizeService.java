package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Drives the generation finalize / candidate / terminalize SECURITY DEFINER
 * functions (V7 {@code finalize_generation}, V15 {@code insert_generation_candidate}
 * and {@code terminalize_generation}), bound to the runtime {@code vc_api} JDBC
 * pool (TASK-0176).
 *
 * <p>Runs inside the worker's owner-bound transaction so every {@code vc.*}
 * call executes in the correct server-trusted tenant context. The ZERO_LLM
 * deterministic completion path uses {@link #insertCandidate} + {@link
 * #finalizeCompleted}; the degradation path uses {@link #terminalizeAsFailed}.
 *
 * <p>{@code finalizeCompleted} binds the final assistant content, marks the
 * candidate final and atomically writes the final message, COMPLETED terminal
 * state, zero-token usage, zero SETTLE quota, the {@code chat.completed}
 * realtime event and (optionally) the memory-extract outbox. ZERO_LLM callers
 * pass {@code outboxEligible=false} because the deterministic fallback string
 * must not produce a memory candidate (INV-MEM semantics).
 */
public class GenerationFinalizeService {

    /** The final assistant content for a ZERO_LLM completion (audit/identity only here). */
    private static final String TERMINAL_EVENT_FAILED = "chat.failed";

    private final JdbcTemplate jdbc;

    public GenerationFinalizeService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
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
        Long candidateId = jdbc.queryForObject(
                "SELECT out_candidate_id FROM vc.insert_generation_candidate(?, ?, ?, false)",
                Long.class,
                ownerUserId,
                generationId,
                content);
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
        Boolean finalized = jdbc.queryForObject(
                "SELECT out_finalized FROM vc.finalize_generation(?, ?, ?, ?, ?, 0, 0, 0, 'USD', 0, ?, NULL)",
                Boolean.class,
                ownerUserId,
                generationId,
                candidateId,
                content,
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
        Boolean finalized = jdbc.queryForObject(
                "SELECT out_finalized FROM vc.finalize_generation(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                Boolean.class,
                ownerUserId,
                generationId,
                candidateId,
                content,
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
                        + "'{\"fault\":\"' || ? || '\"}'::jsonb)",
                String.class,
                ownerUserId,
                generationId,
                TERMINAL_EVENT_FAILED,
                jsonEscape(detail));
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
