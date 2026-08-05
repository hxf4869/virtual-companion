package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Idempotent generation reception bound to the {@code vc.receive_generation}
 * SECURITY DEFINER function.
 *
 * <p>One logical request carries a per-owner {@code idempotencyKey}; a retried
 * request (same owner + key) resolves to the SAME {@code logicalGenerationId}
 * and creates no second user message. The first reception atomically creates
 * the {@code vc.generation} row and the user's {@code vc.message}. The function
 * binds {@code vc.owner_user_id} for the transaction so FORCE RLS keeps binding
 * (INV-GEN-001).
 *
 * <p>Input validation is eager and side-effect free so it is unit-testable
 * without a database; the idempotent runtime behavior is proven by the SQL test
 * suite under {@code infra/db/tests}.
 */
public class GenerationReceiveService {

    private final JdbcTemplate jdbc;

    public GenerationReceiveService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Default role written for the user message when the caller omits it. */
    public static final String DEFAULT_USER_ROLE = "user";

    /** Default (empty) content when the caller omits it. */
    public static final String DEFAULT_USER_CONTENT = "";

    /**
     * Receive a generation with the default user role and empty content.
     *
     * @param idempotencyKey per-owner dedup handle; {@code null} means no dedup
     */
    public ReceivedGeneration receive(long ownerUserId, long conversationId, String idempotencyKey) {
        return receive(ownerUserId, conversationId, idempotencyKey, DEFAULT_USER_ROLE, DEFAULT_USER_CONTENT);
    }

    /**
     * Receive a generation, creating the generation + user message on first
     * reception or resolving the existing stable logical id on a duplicate.
     */
    public ReceivedGeneration receive(
            long ownerUserId,
            long conversationId,
            String idempotencyKey,
            String userRole,
            String userContent) {
        validateReceive(ownerUserId, conversationId, userRole, userContent, idempotencyKey);
        return jdbc.queryForObject(
                "SELECT logical_generation_id, generation_id, message_id, created "
                        + "FROM vc.receive_generation(?, ?, ?, ?, ?)",
                (rs, rowNum) -> new ReceivedGeneration(
                        rs.getString("logical_generation_id"),
                        rs.getLong("generation_id"),
                        (Long) rs.getObject("message_id"),
                        rs.getBoolean("created")),
                ownerUserId,
                conversationId,
                idempotencyKey,
                userRole,
                userContent);
    }

    /**
     * Pure argument validation for reception. Exposed for unit testing; throws
     * {@link IllegalArgumentException} on any invalid combination.
     */
    static void validateReceive(
            long ownerUserId,
            long conversationId,
            String userRole,
            String userContent,
            String idempotencyKey) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        if (userRole == null || userRole.isBlank()) {
            throw new IllegalArgumentException("userRole must not be blank");
        }
        if (userContent == null) {
            throw new IllegalArgumentException("userContent must not be null");
        }
        if (idempotencyKey != null && idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey must not be blank");
        }
    }

    /**
     * Result of one reception. {@code messageId} is {@code null} and
     * {@code created} is {@code false} on a duplicate reception.
     */
    public record ReceivedGeneration(String logicalGenerationId, long generationId, Long messageId, boolean created) {
        public ReceivedGeneration {
            Objects.requireNonNull(logicalGenerationId, "logicalGenerationId must not be null");
            if (logicalGenerationId.isBlank()) {
                throw new IllegalArgumentException("logicalGenerationId must not be blank");
            }
            if (generationId <= 0) {
                throw new IllegalArgumentException("generationId must be positive");
            }
        }
    }
}
