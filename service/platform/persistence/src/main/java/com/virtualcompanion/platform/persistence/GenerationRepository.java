package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * JDBC skeleton for {@code vc.generation}.
 *
 * <p>Generations are tenant scoped by FORCE ROW LEVEL SECURITY; reads require
 * the active tenant context ({@code vc.owner_user_id}). The idempotent creation
 * path is {@code vc.receive_generation} (see {@link GenerationReceiveService});
 * this repository exposes owner-scoped lookups by primary key, stable logical
 * id and idempotency key.
 */
public class GenerationRepository {

    private final JdbcTemplate jdbc;

    public GenerationRepository(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    private static final String SELECT_SQL = """
            SELECT owner_user_id, id, conversation_id, logical_generation_id,
                   status, idempotency_key, mode
            FROM vc.generation
            """;

    public Optional<GenerationRecord> find(long ownerUserId, long id) {
        return jdbc.query(
                SELECT_SQL + "WHERE owner_user_id = ? AND id = ?",
                rowMapper(),
                ownerUserId,
                id).stream().findFirst();
    }

    public Optional<GenerationRecord> findByLogicalGenerationId(long ownerUserId, String logicalGenerationId) {
        Objects.requireNonNull(logicalGenerationId, "logicalGenerationId must not be null");
        return jdbc.query(
                SELECT_SQL + "WHERE owner_user_id = ? AND logical_generation_id = ?",
                rowMapper(),
                ownerUserId,
                logicalGenerationId).stream().findFirst();
    }

    /**
     * GEN-VER / FR-CHAT-003: true when another generation for the same source
     * user message already completed. Used to skip a second MEMORY_EXTRACT.
     */
    public boolean hasCompletedSiblingVersion(long ownerUserId, long generationId) {
        if (ownerUserId <= 0 || generationId <= 0) {
            return false;
        }
        Boolean found = jdbc.queryForObject(
                "SELECT EXISTS ("
                        + "SELECT 1 FROM vc.generation g "
                        + "JOIN vc.generation s "
                        + "  ON s.owner_user_id = g.owner_user_id "
                        + " AND s.source_user_message_id = g.source_user_message_id "
                        + " AND s.id <> g.id "
                        + " AND s.status LIKE 'COMPLETED%' "
                        + "WHERE g.owner_user_id = ? AND g.id = ? "
                        + "  AND g.source_user_message_id IS NOT NULL)",
                Boolean.class,
                ownerUserId,
                generationId);
        return Boolean.TRUE.equals(found);
    }

    public Optional<GenerationRecord> findByIdempotencyKey(long ownerUserId, String idempotencyKey) {
        Objects.requireNonNull(idempotencyKey, "idempotencyKey must not be null");
        return jdbc.query(
                SELECT_SQL + "WHERE owner_user_id = ? AND idempotency_key = ?",
                rowMapper(),
                ownerUserId,
                idempotencyKey).stream().findFirst();
    }

    private RowMapper<GenerationRecord> rowMapper() {
        return (rs, rowNum) -> new GenerationRecord(
                rs.getLong("owner_user_id"),
                rs.getLong("id"),
                rs.getLong("conversation_id"),
                rs.getString("logical_generation_id"),
                rs.getString("status"),
                rs.getString("idempotency_key"),
                rs.getString("mode"));
    }
}
