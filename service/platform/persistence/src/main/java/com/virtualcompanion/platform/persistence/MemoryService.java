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
            "SELECT vc.create_memory_candidate(?, ?, ?, ?, ?, ?, ?, ?, ?)";
    private static final String CREATE_AUTO_SAVED_SQL =
            "SELECT vc.create_auto_saved_memory(?, ?, ?, ?, ?, ?)";
    private static final String AUTO_SAVE_PREF_GET_SQL =
            "SELECT vc.get_memory_auto_save_pref(?)";
    private static final String AUTO_SAVE_PREF_SET_SQL =
            "SELECT vc.set_memory_auto_save_pref(?, ?)";
    private static final String LIST_SQL =
            "SELECT out_id, out_scope, out_summary, out_status, out_conversation_id, "
                    + "out_deleted_at, out_created_at, out_auto_saved, "
                    + "out_superseded_at, out_superseded_by_memory_id, "
                    + "out_event_at, out_event_status, out_event_expires_at "
                    + "FROM vc.list_memory(?, ?, ?)";
    private static final String GET_SQL =
            "SELECT out_id, out_relationship_id, out_scope, out_summary, out_status, "
                    + "out_conversation_id, out_created_at, out_auto_saved, "
                    + "out_superseded_at, out_superseded_by_memory_id, "
                    + "out_event_at, out_event_status, out_event_expires_at "
                    + "FROM vc.get_memory(?, ?)";
    private static final String UPDATE_SQL =
            "SELECT vc.update_memory(?, ?, ?, ?, ?, ?)";
    private static final String DELETE_SQL = "SELECT vc.delete_memory(?, ?)";
    private static final String CONFIRM_SQL = "SELECT vc.confirm_memory_candidate(?, ?, ?)";
    private static final String REJECT_SQL = "SELECT vc.reject_memory_candidate(?, ?)";
    private static final String EVIDENCE_SQL =
            "SELECT out_id, out_source_ref, out_created_at FROM vc.list_memory_evidence(?, ?)";
    private static final String RECALL_SQL =
            "SELECT out_id, out_scope, out_summary, out_conversation_id, out_created_at, "
                    + "out_event_at, out_event_status "
                    + "FROM vc.recall_memory(?, ?, ?, ?)";

    /** PENDING_CONFIRMATION is the sole pre-canonical status; ACCEPTED is the
     *  canonical status; REJECTED/EXPIRED are dead ends (memory-candidate-statuses). */
    private static final String PENDING = "PENDING_CONFIRMATION";
    private static final Set<String> EDITABLE_STATUSES = Set.of(PENDING, "ACCEPTED");
    /** Alpha-enabled scopes (memory-scopes catalog). */
    private static final Set<String> ALPHA_SCOPES = Set.of("SESSION", "RELATIONSHIP");
    /** memory-event-statuses catalog codes (§11.12). */
    private static final Set<String> EVENT_STATUSES =
            Set.of("PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "UNKNOWN");

    private final JdbcTemplate jdbc;
    private final RelationshipService relationshipService;

    private final RestFieldCipher cipher;

    public MemoryService(JdbcTemplate jdbc, RelationshipService relationshipService) {
        this(jdbc, relationshipService, null);
    }

    /** CRYPTO-REST: when a cipher is wired, memory summaries encrypt at rest. */
    public MemoryService(JdbcTemplate jdbc, RelationshipService relationshipService,
                         RestFieldCipher cipher) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.relationshipService = Objects.requireNonNull(
                relationshipService, "relationshipService must not be null");
        this.cipher = cipher;
    }

    /**
     * Create a memory candidate from model extraction. The candidate is always
     * created in PENDING_CONFIRMATION (INV-MEM-002); canonical memory is reached
     * only through {@link #confirm}.
     *
     * @return the created candidate, or empty for a foreign/absent relationship
     *         (NOT_FOUND_OR_FORBIDDEN)
     * @throws IllegalArgumentException on a non-positive id, blank summary,
     *         non-Alpha scope, SESSION scope without a conversation binding, or
     *         an invalid §11.12 event triple (R44)
     */
    public Optional<MemoryRecord> create(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence) {
        return create(ownerUserId, relationshipId, scope, summary,
                conversationId, evidence, null, null, null);
    }

    /**
     * R44 (V68 / §11.12): create with the optional event triple. Any event
     * field requires {@code eventAt}; the status must be a
     * memory-event-statuses code; the expiry must be strictly after the start.
     */
    public Optional<MemoryRecord> create(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence,
            Instant eventAt,
            String eventStatus,
            Instant eventExpiresAt) {
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
        validateEvent(eventAt, eventStatus, eventExpiresAt);
        // Existence is pre-checked (mirroring the SD RAISE) so the common
        // foreign/absent relationship maps to 404 without relying on the RAISE.
        if (relationshipService.get(ownerUserId, relationshipId).isEmpty()) {
            return Optional.empty();
        }
        Long id;
        try {
            id = queryId(CREATE_SQL,
                    createSetter(ownerUserId, relationshipId, scope, summary,
                            conversationId, evidence, eventAt, eventStatus, eventExpiresAt));
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

    /**
     * MEM-AUTO-SAVE (V66 / §7.4): create the memory directly in ACCEPTED with
     * {@code auto_saved=true} — the deterministic low-sensitivity path
     * (§11.10 PROPOSED→ACCEPTED 低敏自动规则). The caller must be the
     * deterministic extraction rule (never the model); every created row is
     * individually deletable/editable (可随时撤销).
     *
     * @return the created canonical memory, or empty for a foreign/absent
     *         relationship (NOT_FOUND_OR_FORBIDDEN)
     */
    public Optional<MemoryRecord> createAutoSaved(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence) {
        if (ownerUserId <= 0 || relationshipId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        if (scope == null || scope.isBlank() || !ALPHA_SCOPES.contains(scope)) {
            throw new IllegalArgumentException("scope is not enabled in Alpha: " + scope);
        }
        if (summary == null || summary.isBlank()) {
            throw new IllegalArgumentException("summary must not be blank");
        }
        if (isSessionMissingConversation(scope, conversationId)) {
            throw new IllegalArgumentException("SESSION scope requires a conversationId");
        }
        if (relationshipService.get(ownerUserId, relationshipId).isEmpty()) {
            return Optional.empty();
        }
        Long id;
        try {
            id = queryId(CREATE_AUTO_SAVED_SQL,
                    createSetter(ownerUserId, relationshipId, scope, summary,
                            conversationId, evidence, null, null, null));
        } catch (BadSqlGrammarException e) {
            throw e;
        } catch (DataAccessException e) {
            return Optional.empty();
        }
        if (id == null) {
            throw new IllegalStateException("create_auto_saved_memory returned no id");
        }
        MemoryRecord record = get(ownerUserId, id).orElseThrow(
                () -> new IllegalStateException("memory " + id + " not found after create"));
        return Optional.of(record);
    }

    /** MEM-AUTO-SAVE: the per-owner kill switch (default true — §7.4 baseline). */
    public boolean autoSaveEnabled(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        Boolean enabled = jdbc.queryForObject(
                AUTO_SAVE_PREF_GET_SQL, Boolean.class, ownerUserId);
        return !Boolean.FALSE.equals(enabled);
    }

    /** MEM-AUTO-SAVE: flip the kill switch; returns the stored value. */
    public boolean setAutoSaveEnabled(long ownerUserId, boolean enabled) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        Boolean stored = jdbc.queryForObject(
                AUTO_SAVE_PREF_SET_SQL, Boolean.class, ownerUserId, enabled);
        return Boolean.TRUE.equals(stored);
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
     * dead-end (REJECTED/EXPIRED) id resolves to empty (NOT_FOUND_ORFORBIDDEN,
     * the OpenAPI contract for this endpoint). R44: optional §11.12 event
     * edits — a {@code null} event parameter leaves the stored value unchanged.
     */
    public Optional<MemoryRecord> update(
            long ownerUserId, long memoryId, String summary,
            Instant eventAt, String eventStatus, Instant eventExpiresAt) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (memoryId <= 0) {
            throw new IllegalArgumentException("memoryId must be positive");
        }
        if (summary == null || summary.isBlank()) {
            throw new IllegalArgumentException("summary must not be blank");
        }
        if (eventStatus != null && !EVENT_STATUSES.contains(eventStatus)) {
            throw new IllegalArgumentException(
                    "eventStatus is not a memory-event-statuses code: " + eventStatus);
        }
        MemoryRecord existing = get(ownerUserId, memoryId).orElse(null);
        if (existing == null || !EDITABLE_STATUSES.contains(existing.status())) {
            return Optional.empty();
        }
        validateEvent(
                eventAt == null ? existing.eventAt() : eventAt,
                eventStatus == null ? existing.eventStatus() : eventStatus,
                eventExpiresAt == null ? existing.eventExpiresAt() : eventExpiresAt);
        try {
            Boolean updated = jdbc.queryForObject(
                    UPDATE_SQL, Boolean.class,
                    ownerUserId, memoryId, summary,
                    toTimestamp(eventAt), eventStatus, toTimestamp(eventExpiresAt));
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

    /** Pre-R44 shape: summary-only edit (event columns untouched). */
    public Optional<MemoryRecord> update(long ownerUserId, long memoryId, String summary) {
        return update(ownerUserId, memoryId, summary, null, null, null);
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
        return transition(ownerUserId, memoryId, null, CONFIRM_SQL, "confirm_memory_candidate");
    }

    /**
     * R44 (V68 / §11.11): confirm with an explicit supersede. The target must
     * be an active canonical memory of the SAME relationship; anything else is
     * a client error (400 INVALID_REQUEST), never a silent 404 — the user
     * picked the id from their own list, so a mismatch is stale UI state, not a
     * hidden resource. The SD re-validates everything (defense in depth).
     */
    public Optional<MemoryRecord> confirm(long ownerUserId, long memoryId, Long supersedeMemoryId) {
        return transition(ownerUserId, memoryId, supersedeMemoryId,
                CONFIRM_SQL, "confirm_memory_candidate");
    }

    /**
     * Reject a pending candidate (status REJECTED). Only a PENDING_CONFIRMATION
     * candidate can be rejected; a foreign, absent, soft-deleted or otherwise
     * transitioned memory resolves to empty (NOT_FOUND_OR_FORBIDDEN).
     */
    public Optional<MemoryRecord> reject(long ownerUserId, long memoryId) {
        return transition(ownerUserId, memoryId, null, REJECT_SQL, "reject_memory_candidate");
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
                        cipher == null ? rs.getString("out_summary")
                        : cipher.decrypt(rs.getString("out_summary")),
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
            long ownerUserId, long memoryId, Long supersedeMemoryId,
            String sql, String functionName) {
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
        if (supersedeMemoryId != null) {
            // Stale-UI guard: the user picked this id from their own canonical
            // list; a mismatch is a 400, not an existence-hidden 404.
            if (supersedeMemoryId <= 0) {
                throw new IllegalArgumentException("supersedeMemoryId must be positive");
            }
            if (supersedeMemoryId == memoryId) {
                throw new IllegalArgumentException("a memory cannot supersede itself");
            }
            MemoryRecord target = get(ownerUserId, supersedeMemoryId)
                    .orElseThrow(() -> new IllegalArgumentException(
                            "supersede target is not an active canonical memory"));
            if (!"ACCEPTED".equals(target.status())
                    || target.supersededAt() != null
                    || target.deletedAt() != null
                    || target.relationshipId() == null
                    || !target.relationshipId().equals(existing.relationshipId())) {
                throw new IllegalArgumentException(
                        "supersede target is not an active canonical memory of this relationship");
            }
        }
        try {
            Boolean updated;
            if (sql == CONFIRM_SQL) {
                updated = jdbc.queryForObject(
                        sql, Boolean.class, ownerUserId, memoryId, supersedeMemoryId);
            } else {
                updated = jdbc.queryForObject(sql, Boolean.class, ownerUserId, memoryId);
            }
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

    /**
     * Run one id-returning SD call through a {@link PreparedStatementSetter}
     * (the varargs {@code queryForObject(sql, type, setter...)} overload would
     * pass the setter itself as a bind argument — found by the B0-05
     * supplier-failure drill, 2026-08-19).
     */
    private Long queryId(String sql, PreparedStatementSetter setter) {
        List<Long> ids = jdbc.query(sql, setter, (rs, rowNum) -> rs.getLong(1));
        return ids.isEmpty() ? null : ids.get(0);
    }

    private PreparedStatementSetter createSetter(
            long ownerUserId,
            long relationshipId,
            String scope,
            String summary,
            Long conversationId,
            List<String> evidence,
            Instant eventAt,
            String eventStatus,
            Instant eventExpiresAt) {
        String storedSummary = cipher == null ? summary : cipher.encrypt(summary);
        String[] evidenceArray = evidence == null ? null : evidence.toArray(String[]::new);
        return (PreparedStatement ps) -> {
            ps.setLong(1, ownerUserId);
            ps.setLong(2, relationshipId);
            ps.setString(3, scope);
            ps.setString(4, storedSummary);
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
            setNullableTimestamp(ps, 7, eventAt);
            ps.setString(8, eventStatus);
            setNullableTimestamp(ps, 9, eventExpiresAt);
        };
    }

    private static void setNullableTimestamp(PreparedStatement ps, int index, Instant value)
            throws SQLException {
        if (value == null) {
            ps.setNull(index, Types.TIMESTAMP_WITH_TIMEZONE);
        } else {
            ps.setTimestamp(index, Timestamp.from(value));
        }
    }

    private static Timestamp toTimestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }

    /**
     * §11.12 event-triple shape: any event field requires the anchor
     * {@code eventAt}; the status is a memory-event-statuses code; the expiry
     * is strictly after the start. Applied to creates and to the EFFECTIVE
     * values on update (null param = keep stored).
     */
    private static void validateEvent(Instant eventAt, String eventStatus, Instant eventExpiresAt) {
        if ((eventStatus != null || eventExpiresAt != null) && eventAt == null) {
            throw new IllegalArgumentException(
                    "eventStatus/eventExpiresAt require eventAt");
        }
        if (eventStatus != null && !EVENT_STATUSES.contains(eventStatus)) {
            throw new IllegalArgumentException(
                    "eventStatus is not a memory-event-statuses code: " + eventStatus);
        }
        if (eventAt != null && eventExpiresAt != null && !eventExpiresAt.isAfter(eventAt)) {
            throw new IllegalArgumentException("eventExpiresAt must be after eventAt");
        }
    }

    /** {@code get_memory} output columns (carries relationship_id, no deleted_at). */
    private RowMapper<MemoryRecord> getRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                rs.getLong("out_relationship_id"),
                rs.getString("out_scope"),
                cipher == null ? rs.getString("out_summary")
                        : cipher.decrypt(rs.getString("out_summary")),
                rs.getString("out_status"),
                nullableLong(rs, "out_conversation_id"),
                null,
                toInstant(rs, "out_created_at"),
                rs.getBoolean("out_auto_saved"),
                nullableInstant(rs, "out_superseded_at"),
                nullableLong(rs, "out_superseded_by_memory_id"),
                nullableInstant(rs, "out_event_at"),
                rs.getString("out_event_status"),
                nullableInstant(rs, "out_event_expires_at"));
    }

    /** {@code list_memory} output columns (carries deleted_at, no relationship_id). */
    private RowMapper<MemoryRecord> listRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                null,
                rs.getString("out_scope"),
                cipher == null ? rs.getString("out_summary")
                        : cipher.decrypt(rs.getString("out_summary")),
                rs.getString("out_status"),
                nullableLong(rs, "out_conversation_id"),
                toInstant(rs, "out_deleted_at"),
                toInstant(rs, "out_created_at"),
                rs.getBoolean("out_auto_saved"),
                nullableInstant(rs, "out_superseded_at"),
                nullableLong(rs, "out_superseded_by_memory_id"),
                nullableInstant(rs, "out_event_at"),
                rs.getString("out_event_status"),
                nullableInstant(rs, "out_event_expires_at"));
    }

    private static RowMapper<MemoryEvidenceRecord> evidenceRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryEvidenceRecord(
                rs.getLong("out_id"),
                rs.getString("out_source_ref"),
                toInstant(rs, "out_created_at"));
    }

    /**
     * {@code recall_memory} output columns: ACCEPTED, non-superseded rows only,
     * so the status is fixed and there is no deleted_at (the tombstone already
     * excluded soft-deleted rows). R44: the §11.12 event pair rides along so
     * the assembler can demand follow-up questions for due events.
     */
    private RowMapper<MemoryRecord> recallRowMapper() {
        return (ResultSet rs, int rowNum) -> new MemoryRecord(
                rs.getLong("out_id"),
                null,
                rs.getString("out_scope"),
                cipher == null ? rs.getString("out_summary")
                        : cipher.decrypt(rs.getString("out_summary")),
                "ACCEPTED",
                nullableLong(rs, "out_conversation_id"),
                null,
                toInstant(rs, "out_created_at"),
                false,
                null,
                null,
                nullableInstant(rs, "out_event_at"),
                rs.getString("out_event_status"),
                null);
    }

    private static Long nullableLong(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : value;
    }

    private static Instant toInstant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? Instant.EPOCH : ts.toInstant();
    }

    /** Like {@link #toInstant} but keeps SQL NULL as {@code null} (tombstone /
     * event columns are genuinely absent, not epoch). */
    private static Instant nullableInstant(ResultSet rs, String column) throws SQLException {
        Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }

    private static boolean isSessionMissingConversation(String scope, Long conversationId) {
        return "SESSION".equals(scope) && conversationId == null;
    }
}
