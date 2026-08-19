package com.virtualcompanion.platform.persistence;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

/**
 * Canonical Memory management over the V11/V12/V13 SECURITY DEFINER functions
 * (TASK-0180).
 *
 * <p>Wraps {@code vc.create_memory_candidate}, {@code vc.list_memory},
 * {@code vc.get_memory}, {@code vc.update_memory}, {@code vc.delete_memory},
 * {@code vc.confirm_memory_candidate}, {@code vc.reject_memory_candidate} and
 * {@code vc.list_memory_evidence}. Since V11 every runtime role has no direct
 * DML (including SELECT) on {@code memory_item}/{@code memory_evidence}, so all
 * access flows through these functions in the server-trusted owner context.
 *
 * <p>Failure translation (mirrors TASK-0179): a leaked {@link DataAccessException}
 * would be misclassified by the global auth advice as 401 AUTHENTICATION_REQUIRED,
 * so business RAISEs are translated. Unlike the generation-cancel card (which
 * maps a state conflict to 400), the OpenAPI memory contract maps every
 * foreign / absent / deleted / dead-end case to NOT_FOUND_OR_FORBIDDEN — so the
 * common cases are pre-checked through {@link #get} and a post-pre-check RAISE
 * (a concurrent state move) also resolves to {@link Optional#empty()} (404).
 * Schema-unavailable failures ({@link BadSqlGrammarException}, SQLSTATE
 * 42883/42P01/42703/3F000) are rethrown so the existing 503 SCHEMA_UNAVAILABLE
 * contract is preserved. Caller input validation (non-positive ids, blank
 * summary, non-Alpha scope, SESSION without a conversation) fails fast as
 * {@link IllegalArgumentException} (400 INVALID_REQUEST).
 *
 * <p>{@code vc.recall_memory} (V13) is wrapped as {@link #recall} for the
 * runtime generation-context consumer (MEM-LOOP), not exposed over HTTP.
 */
public class MemoryService {

    private static final String CREATE_SQL =
            "SELECT vc.create_memory_candidate(?, ?, ?, ?, ?, ?)";
    private static final String LIST_SQL =
            "SELECT out_id, out_scope, out_summary, out_status, out_conversation_id, "
                    + "out_deleted_at, out_created_at FROM vc.list_memory(?, ?, ?)";
    private static final String GET_SQL =
            "SELECT out_id, out_relationship_id, out_scope, out_summary, out_status, "
                    + "out_conversation_id, out_created_at FROM vc.get_memory(?, ?)";
    private static final String UPDATE_SQL = "SELECT vc.update_memory(?, ?, ?)";
    private static final String DELETE_SQL = "SELECT vc.delete_memory(?, ?)";
    private static final String CONFIRM_SQL = "SELECT vc.confirm_memory_candidate(?, ?)";
    private static final String REJECT_SQL = "SELECT vc.reject_memory_candidate(?, ?)";
    private static final String EVIDENCE_SQL =
            "SELECT out_id, out_source_ref, out_created_at FROM vc.list_memory_evidence(?, ?)";
    private static final String RECALL_SQL =
            "SELECT out_id, out_scope, out_summary, out_conversation_id, out_created_at "
                    + "FROM vc.recall_memory(?, ?, ?, ?)";

    /** PENDING_CONFIRMATION is the sole pre-canonical status; ACCEPTED is the
     *  canonical status; REJECTED/EXPIRED are dead ends (memory-candidate-statuses). */
    private static final String PENDING = "PENDING_CONFIRMATION";
    private static final Set<String> EDITABLE_STATUSES = Set.of(PENDING, "ACCEPTED");
    /** Alpha-enabled scopes (memory-scopes catalog). */
    private static final Set<String> ALPHA_SCOPES = Set.of("SESSION", "RELATIONSHIP");

    private final JdbcTemplate jdbc;
    private final RelationshipService relationshipService;

    public MemoryService(JdbcTemplate jdbc, RelationshipService relationshipService) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.relationshipService = Objects.requireNonNull(
                relationshipService, "relationshipService must not be null");
    }

    /**
     * Create a memory candidate from model extraction. The candidate is always
     * created in PENDING_CONFIRMATION (INV-MEM-002); canonical memory is reached
     * only through {@link #confirm}.
     *
     * @return the created candidate, or empty for a foreign/absent relationship
     *         (NOT_FOUND_OR_FORBIDDEN)
     * @throws IllegalArgumentException on a non-positive id, blank summary,
     *         non-Alpha scope, or SESSION scope without a conversation binding
     */
    public Optional<MemoryRecord> create(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        if (scope == null || scope.isBlank()) {
            throw new IllegalArgumentException("scope must not be blank");
        }
        if (!ALPHA_SCOPES.contains(scope)) {
            throw new IllegalArgumentException("scope is not enabled in Alpha: " + scope);
        }
        if (summary == null || summary.isBlank()) {
            throw new IllegalArgumentException("summary must not be blank");
        }
        if (isSessionMissingConversation(scope, conversationId)) {
            throw new IllegalArgumentException("SESSION scope requires a conversationId");
        }
        if (conversationId != null && conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        // Existence is pre-checked (mirroring the SD RAISE) so the common
        // foreign/absent relationship maps to 404 without relying on the RAISE.
        if (relationshipService.get(ownerUserId, relationshipId).isEmpty()) {
            return Optional.empty();
        }
        Long id;
        try {
            id = jdbc.queryForObject(
                    CREATE_SQL,
                    Long.class,
                    createSetter(ownerUserId, relationshipId, scope, summary, conversationId, evidence));
        } catch (BadSqlGrammarException e) {
            // Schema unavailable: keep the existing 503 SCHEMA_UNAVAILABLE
            // classification instead of folding it into a not-found 404.
            throw e;
        } catch (DataAccessException e) {
            // The relationship pre-check passed, so a RAISE here means the
            // SD guard rejected the create (e.g. the relationship vanished);
            // surface it as not-found without disclosing existence.
            return Optional.empty();
        }
        if (id == null) {
            throw new IllegalStateException("create_memory_candidate returned no id");
        }
        MemoryRecord record = get(ownerUserId, id).orElseThrow(
                () -> new IllegalStateException("memory " + id + " not found after create"));
        return Optional.of(record);
    }

    /** List the memory candidates and canonical records scoped to a
     *  relationship. A foreign/absent relationship yields no rows and never
     *  discloses existence (the OpenAPI contract has no 404 for this endpoint). */
    public List<MemoryRecord> list(long ownerUserId, long relationshipId, Boolean includeDeleted) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        // includeDeleted null lets the SD apply its default (false).
        return jdbc.query(
                LIST_SQL,
                listRowMapper(),
                ownerUserId,
                relationshipId,
                includeDeleted);
    }

    /** Fetch one non-deleted memory; empty for a foreign, absent or soft-deleted id. */
    public Optional<MemoryRecord> get(long ownerUserId, long memoryId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        return jdbc.query(
                GET_SQL,
                getRowMapper(),
                ownerUserId,
                memoryId).stream().findFirst();
    }

    /**
     * Edit a memory's summary (status-preserving and idempotent: applying the
     * same summary twice succeeds both times). Only PENDING_CONFIRMATION and
     * ACCEPTED memories are editable; a foreign, absent, soft-deleted or
     * dead-end (REJECTED/EXPIRED) id resolves to empty (NOT_FOUND_OR_FORBIDDEN,
     * the OpenAPI contract for this endpoint).
     */
    public Optional<MemoryRecord> update(long ownerUserId, long memoryId, String summary) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        if (summary == null || summary.isBlank()) {
            throw new IllegalArgumentException("summary must not be blank");
        }
        MemoryRecord existing = get(ownerUserId, memoryId).orElse(null);
        if (existing == null || !EDITABLE_STATUSES.contains(existing.status())) {
            return Optional.empty();
        }
        try {
            Boolean updated = jdbc.queryForObject(
                    UPDATE_SQL, Boolean.class, ownerUserId, memoryId, summary);
            if (!Boolean.TRUE.equals(updated)) {
                throw new IllegalStateException(
                        "update_memory returned false for owned memory " + memoryId);
            }
        } catch (BadSqlGrammarException e) {
            throw e;
        } catch (DataAccessException e) {
            // The pre-check passed, so a RAISE here means the state moved
            // concurrently into a non-editable status; the OpenAPI contract
            // maps that dead-end to NOT_FOUND_OR_FORBIDDEN.
            return Optional.empty();
        }
        return get(ownerUserId, memoryId);
    }

    /**
     * Soft-delete a memory. Returns the memory as it was before the soft-delete
     * (the response snapshot); a foreign or absent id resolves to empty. A
     * soft-deleted memory is indistinguishable from absent on every SD read
     * path (the tombstone excludes it), so a duplicate delete of an
     * already-deleted memory also resolves to empty (Owner 2026-08-12
     * decision); the SD-level idempotency (delete_memory returns TRUE for an
     * owned already-deleted row) remains covered by DB test 36.
     */
    public Optional<MemoryRecord> delete(long ownerUserId, long memoryId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        MemoryRecord pre = get(ownerUserId, memoryId).orElse(null);
        if (pre == null) {
            return Optional.empty();
        }
        try {
            Boolean deleted = jdbc.queryForObject(
                    DELETE_SQL, Boolean.class, ownerUserId, memoryId);
            if (!Boolean.TRUE.equals(deleted)) {
                throw new IllegalStateException(
                        "delete_memory returned false for owned memory " + memoryId);
            }
        } catch (BadSqlGrammarException e) {
            throw e;
        } catch (DataAccessException e) {
            return Optional.empty();
        }
        return Optional.of(pre);
    }

    /**
     * Confirm a pending candidate into canonical (ACCEPTED) memory — the sole
     * path to canonical (INV-MEM-002). Only a PENDING_CONFIRMATION candidate
     * can be confirmed; a foreign, absent, soft-deleted or otherwise
     * transitioned memory resolves to empty (NOT_FOUND_OR_FORBIDDEN).
     */
    public Optional<MemoryRecord> confirm(long ownerUserId, long memoryId) {
        return transition(ownerUserId, memoryId, CONFIRM_SQL, "confirm_memory_candidate");
    }

    /**
     * Reject a pending candidate (status REJECTED). Only a PENDING_CONFIRMATION
     * candidate can be rejected; a foreign, absent, soft-deleted or otherwise
     * transitioned memory resolves to empty (NOT_FOUND_OR_FORBIDDEN).
     */
    public Optional<MemoryRecord> reject(long ownerUserId, long memoryId) {
        return transition(ownerUserId, memoryId, REJECT_SQL, "reject_memory_candidate");
    }

    /**
     * List the source Evidence chain of a memory. A foreign, absent or
     * soft-deleted id yields no rows, indistinguishable from a memory that
     * carries no evidence (the OpenAPI contract has no 404 for this endpoint).
     */
    public List<MemoryEvidenceRecord> listEvidence(long ownerUserId, long memoryId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        return jdbc.query(
                EVIDENCE_SQL,
                evidenceRowMapper(),
                ownerUserId,
                memoryId);
    }

    /**
     * EMBED-RECALL (V62): upsert one memory's embedding (idempotent per
     * memory; the vector travels as the pgvector text literal).
     */
    public boolean upsertEmbedding(
            long ownerUserId, long memoryItemId, String modelId, String modelVersion,
            int dimension, String spaceId, String vectorLiteral) {
        if (ownerUserId <= 0 || memoryItemId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        if (modelId == null || modelId.isBlank() || modelVersion == null
                || modelVersion.isBlank() || spaceId == null || spaceId.isBlank()
                || vectorLiteral == null || vectorLiteral.isBlank()) {
            throw new IllegalArgumentException(
                    "model/version/space/vector must not be blank");
        }
        Boolean ok = jdbc.queryForObject(
                "SELECT vc.upsert_memory_embedding(?, ?, ?, ?, ?, ?, ?)",
                Boolean.class,
                ownerUserId, memoryItemId, modelId, modelVersion,
                dimension, spaceId, vectorLiteral);
        return Boolean.TRUE.equals(ok);
    }

    /**
     * EMBED-RECALL (V62): cosine-nearest confirmed memories of the owner in
     * the SAME embedding space (§11.13 语义向量召回 — the merge/dedupe with
     * the structured recall happens in the runtime caller).
     */
    public List<SemanticMemoryRecord> semanticRecall(
            long ownerUserId, long relationshipId, String spaceId,
            String queryLiteral, int limit) {
        if (ownerUserId <= 0 || relationshipId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        if (spaceId == null || spaceId.isBlank()
                || queryLiteral == null || queryLiteral.isBlank()) {
            throw new IllegalArgumentException("space/query must not be blank");
        }
        return jdbc.query(
                "SELECT out_memory_id, out_summary, out_distance "
                        + "FROM vc.semantic_recall(?, ?, ?, ?, ?)",
                (rs, rowNum) -> new SemanticMemoryRecord(
                        rs.getLong("out_memory_id"),
                        rs.getString("out_summary"),
                        rs.getDouble("out_distance")),
                ownerUserId, relationshipId, spaceId, queryLiteral, limit);
    }

    /** EMBED-RECALL: one semantic recall hit (id, summary, cosine distance). */
    public record SemanticMemoryRecord(long memoryId, String summary, double distance) {
    }

    /**
     * Recall confirmed memory for generation-context injection (V13
     * {@code vc.recall_memory}, MEM-LOOP). Returns only ACCEPTED, non-deleted
     * rows: RELATIONSHIP-scoped memory across conversations, SESSION-scoped
     * memory only when {@code conversationId} binds the generating
     * conversation. A foreign or absent relationship resolves to no rows,
     * indistinguishable from an empty relationship, so existence is never
     * disclosed. The entries cap is clamped by the SD to {@code [1, 100]}.
     */
    public List<MemoryRecord> recall(
            long ownerUserId, long relationshipId, Long conversationId, int maxEntries) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        if (conversationId != null && conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        if (maxEntries <= 0) {
            throw new IllegalArgumentException("maxEntries must be positive");
        }
        return jdbc.query(
                RECALL_SQL, recallRowMapper(), ownerUserId, relationshipId, conversationId, maxEntries);
    }

    /** Shared confirm/reject flow: pre-check pending, call the SD, re-read. */
    private Optional<MemoryRecord> transition(
            long ownerUserId, long memoryId, String sql, String functionName) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        MemoryRecord existing = get(ownerUserId, memoryId).orElse(null);
        if (existing == null || !PENDING.equals(existing.status())) {
            return Optional.empty();
        }
        try {
            Boolean updated = jdbc.queryForObject(
                    sql, Boolean.class, ownerUserId, memoryId);
            if (!Boolean.TRUE.equals(updated)) {
                throw new IllegalStateException(
                        functionName + " returned false for owned memory " + memoryId);
            }
        } catch (BadSqlGrammarException e) {
            throw e;
        } catch (DataAccessException e) {
            // The pre-check passed, so a RAISE here means the state moved
            // concurrently; the OpenAPI contract maps that to NOT_FOUND_OR_FORBIDDEN.
            return Optional.empty();
        }
        return get(ownerUserId, memoryId);
    }

    private static PreparedStatementSetter createSetter(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence) {
        String[] evidenceArray = evidence == null ? null : evidence.toArray(String[]::new);
        return (PreparedStatement ps) -> {
            ps.setLong(1, ownerUserId);
            ps.setLong(2, relationshipId);
            ps.setString(3, scope);
            ps.setString(4, summary);
            if (conversationId == null) {
                ps.setNull(5, Types.BIGINT);
            } else {
                ps.setLong(5, conversationId);
            }
            if (evidenceArray == null) {
                ps.setNull(6, Types.ARRAY);
            } else {
                ps.setArray(6, ps.getConnection().createArrayOf("text", evidenceArray));
            }
        };
    }

    /** {@code get_memory} output columns (carries relationship_id, no deleted_at). */
    private static RowMapper<MemoryRecord> getRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                rs.getLong("out_relationship_id"),
                rs.getString("out_scope"),
                rs.getString("out_summary"),
                rs.getString("out_status"),
                nullableLong(rs, "out_conversation_id"),
                null,
                toInstant(rs, "out_created_at"));
    }

    /** {@code list_memory} output columns (carries deleted_at, no relationship_id). */
    private static RowMapper<MemoryRecord> listRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                null,
                rs.getString("out_scope"),
                rs.getString("out_summary"),
                rs.getString("out_status"),
                nullableLong(rs, "out_conversation_id"),
                toInstant(rs, "out_deleted_at"),
                toInstant(rs, "out_created_at"));
    }

    private static RowMapper<MemoryEvidenceRecord> evidenceRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryEvidenceRecord(
                rs.getLong("out_id"),
                rs.getString("out_source_ref"),
                toInstant(rs, "out_created_at"));
    }

    /**
     * {@code recall_memory} output columns: ACCEPTED rows only, so the status
     * is fixed and there is no deleted_at (the tombstone already excluded
     * soft-deleted rows).
     */
    private static RowMapper<MemoryRecord> recallRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                null,
                rs.getString("out_scope"),
                rs.getString("out_summary"),
                "ACCEPTED",
                nullableLong(rs, "out_conversation_id"),
                null,
                toInstant(rs, "out_created_at"));
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static Instant toInstant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? Instant.EPOCH : ts.toInstant();
    }

    private static boolean isSessionMissingConversation(String scope, Long conversationId) {
        return "SESSION".equals(scope) && conversationId == null;
    }
}
