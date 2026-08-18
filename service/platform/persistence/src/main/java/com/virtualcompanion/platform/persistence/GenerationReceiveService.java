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

    /** CHAT-MODE: approved turn-level interaction modes (V34). */
    public static final String MODE_AUTO = "AUTO";
    public static final String MODE_LISTEN = "LISTEN";
    public static final String MODE_DISCUSS = "DISCUSS";
    public static final String MODE_CASUAL = "CASUAL";

    /**
     * Receive a generation with the default user role, empty content and the
     * default interaction mode ({@code AUTO}).
     *
     * @param idempotencyKey per-owner dedup handle; {@code null} means no dedup
     */
    public ReceivedGeneration receive(long ownerUserId, long conversationId, String idempotencyKey) {
        return receive(
                ownerUserId,
                conversationId,
                idempotencyKey,
                DEFAULT_USER_ROLE,
                DEFAULT_USER_CONTENT,
                GenerationRecord.DEFAULT_MODE);
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
        return receive(
                ownerUserId,
                conversationId,
                idempotencyKey,
                userRole,
                userContent,
                GenerationRecord.DEFAULT_MODE);
    }

    /**
     * Receive a generation with a turn-level interaction mode (CHAT-MODE).
     *
     * <p>The mode is frozen on the first reception; a duplicate reception with
     * the same idempotency key resolves to the existing row and never rewrites
     * it. Invalid modes are rejected eagerly (fail closed); {@code null} or
     * blank falls back to {@code AUTO}.
     */
    public ReceivedGeneration receive(
            long ownerUserId,
            long conversationId,
            String idempotencyKey,
            String userRole,
            String userContent,
            String mode) {
        String normalizedMode = normalizeMode(mode);
        validateReceive(ownerUserId, conversationId, userRole, userContent, idempotencyKey, normalizedMode);
        return jdbc.queryForObject(
                "SELECT logical_generation_id, generation_id, message_id, created "
                        + "FROM vc.receive_generation(?, ?, ?, ?, ?, ?)",
                (rs, rowNum) -> new ReceivedGeneration(
                        rs.getString("logical_generation_id"),
                        rs.getLong("generation_id"),
                        (Long) rs.getObject("message_id"),
                        rs.getBoolean("created")),
                ownerUserId,
                conversationId,
                idempotencyKey,
                userRole,
                userContent,
                normalizedMode);
    }

    /**
     * CHAT-MODE: normalize a caller-supplied mode. {@code null}/blank becomes
     * {@code AUTO}; any value outside the approved set throws (the API layer
     * must reject unapproved modes, unlike the SD function's silent AUTO
     * fallback for direct callers).
     */
    public static String normalizeMode(String mode) {
        if (mode == null || mode.isBlank()) {
            return MODE_AUTO;
        }
        if (MODE_AUTO.equals(mode) || MODE_LISTEN.equals(mode)
                || MODE_DISCUSS.equals(mode) || MODE_CASUAL.equals(mode)) {
            return mode;
        }
        throw new IllegalArgumentException(
                "mode must be one of AUTO, LISTEN, DISCUSS, CASUAL: " + mode);
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
        validateReceive(
                ownerUserId, conversationId, userRole, userContent, idempotencyKey, MODE_AUTO);
    }

    /**
     * CHAT-MODE: pure argument validation including the normalized mode.
     */
    static void validateReceive(
            long ownerUserId,
            long conversationId,
            String userRole,
            String userContent,
            String idempotencyKey,
            String mode) {
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
        if (mode == null || mode.isBlank()) {
            throw new IllegalArgumentException("mode must not be blank");
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
