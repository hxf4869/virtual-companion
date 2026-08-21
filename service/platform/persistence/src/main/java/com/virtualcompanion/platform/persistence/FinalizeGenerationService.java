package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Atomic generation finalization bound to the {@code vc.finalize_generation}
 * SECURITY DEFINER transaction.
 *
 * <p>One {@code FINAL_REVIEW} generation is taken to {@code COMPLETED} together
 * with its final assistant message, provider usage/cost, a SETTLE quota ledger
 * entry, a PENDING {@code chat.completed} realtime event and an eligible
 * outbox event. Either every finalize artifact commits or none of them does
 * (INV-TX-001); a generation not in {@code FINAL_REVIEW} is rejected, so a
 * provider EOS can never imply {@code chat.completed} (INV-GEN-003). The
 * {@code pFault} argument is a fault-injection hook for the atomicity test and
 * is never set by production callers.
 *
 * <p>Argument validation is eager and side-effect free so it is unit-testable
 * without a database; the atomic runtime behavior is proven by the SQL test
 * suite under {@code infra/db/tests}.
 */
public class FinalizeGenerationService {

    private final JdbcTemplate jdbc;

    public FinalizeGenerationService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public FinalizeResult finalize(
            long ownerUserId,
            long generationId,
            long finalCandidateId,
            String assistantContent) {
        return finalize(ownerUserId, generationId, finalCandidateId, assistantContent,
                "", 0L, 0L, 0.0, "USD", 0, true, null);
    }

    public FinalizeResult finalize(
            long ownerUserId,
            long generationId,
            long finalCandidateId,
            String assistantContent,
            String providerRef,
            long inputTokens,
            long outputTokens,
            double actualCost,
            String currency,
            int quotaAmount,
            boolean outboxEligible,
            String fault) {
        validateFinalize(ownerUserId, generationId, finalCandidateId, assistantContent, providerRef, currency);
        return jdbc.queryForObject(
                // p_actual_cost is `numeric`; a Java double binds as float8 and
                // PG's function resolution refuses the implicit candidate, so
                // cast explicitly to numeric.
                "SELECT out_generation_id, out_assistant_message_id, out_finalized "
                        + "FROM vc.finalize_generation(?, ?, ?, ?, ?, ?, ?, ?::numeric, ?, ?, ?, ?)",
                (rs, rowNum) -> new FinalizeResult(
                        rs.getLong("out_generation_id"),
                        rs.getLong("out_assistant_message_id"),
                        rs.getBoolean("out_finalized")),
                ownerUserId,
                generationId,
                finalCandidateId,
                assistantContent,
                providerRef,
                inputTokens,
                outputTokens,
                actualCost,
                currency,
                quotaAmount,
                outboxEligible,
                fault);
    }

    /**
     * Pure argument validation for finalization. Exposed for unit testing; throws
     * {@link IllegalArgumentException} on any invalid combination.
     */
    static void validateFinalize(
            long ownerUserId,
            long generationId,
            long finalCandidateId,
            String assistantContent,
            String providerRef,
            String currency) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        if (finalCandidateId <= 0) {
            throw new IllegalArgumentException("finalCandidateId must be positive");
        }
        if (assistantContent == null) {
            throw new IllegalArgumentException("assistantContent must not be null");
        }
        if (providerRef == null) {
            throw new IllegalArgumentException("providerRef must not be null");
        }
        if (currency == null) {
            throw new IllegalArgumentException("currency must not be null");
        }
        if (currency.isBlank()) {
            throw new IllegalArgumentException("currency must not be blank");
        }
    }

    /** Result of one finalization. {@code finalized} is true when the transaction committed. */
    public record FinalizeResult(long generationId, long assistantMessageId, boolean finalized) {
        public FinalizeResult {
            if (generationId <= 0) {
                throw new IllegalArgumentException("generationId must be positive");
            }
            if (assistantMessageId <= 0) {
                throw new IllegalArgumentException("assistantMessageId must be positive");
            }
        }
    }
}
