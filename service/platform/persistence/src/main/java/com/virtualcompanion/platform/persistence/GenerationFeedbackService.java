package com.virtualcompanion.platform.persistence;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Generation feedback over the V35 {@code vc.record_generation_feedback}
 * SECURITY DEFINER function (FEEDBACK / FR-CHAT-003).
 *
 * <p>The SD function records one owner-scoped row per (generation, kind); a
 * repeated submission of the same kind is an idempotent no-op and returns the
 * existing row (the first note wins). A foreign or absent generation returns
 * zero rows so existence is never disclosed — the HTTP layer renders 404
 * NOT_FOUND_OR_FORBIDDEN. Unapproved kinds are rejected eagerly by
 * {@link #normalizeKind} (a 400 INVALID_REQUEST), mirroring the CHAT-MODE
 * normalization contract; the SD function additionally RAISEs on unapproved
 * kinds as defense in depth for direct callers.
 *
 * <p>{@link BadSqlGrammarException} (missing function/table) is rethrown so the
 * existing 503 SCHEMA_UNAVAILABLE classification is preserved; any other SD
 * RAISE after eager validation is translated to {@link IllegalArgumentException}
 * because the global auth advice would otherwise mislabel a leaked
 * {@link DataAccessException} as 401 AUTHENTICATION_REQUIRED.
 */
public class GenerationFeedbackService {

    /** FEEDBACK: approved kinds mirroring the message-feedback-kinds catalog. */
    private static final Set<String> APPROVED_KINDS = Set.of(
            "TOO_MECHANICAL", "FORGOT_CONTEXT", "CROSSED_BOUNDARY",
            "FACTUAL_ERROR", "UNSAFE");

    /** FEEDBACK: note length cap mirroring the V35 CHECK constraint. */
    public static final int MAX_NOTE_LENGTH = 500;

    private final JdbcTemplate jdbc;

    public GenerationFeedbackService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * FEEDBACK: narrow a caller-supplied kind to an approved catalog code.
     * {@code null}/blank or any unapproved value throws (fail closed).
     */
    public static String normalizeKind(String kind) {
        if (kind == null || kind.isBlank()) {
            throw new IllegalArgumentException("kind must not be blank");
        }
        if (!APPROVED_KINDS.contains(kind)) {
            throw new IllegalArgumentException(
                    "kind must be one of the message-feedback-kinds catalog codes: " + kind);
        }
        return kind;
    }

    /**
     * Record feedback for a generation.
     *
     * @return the recorded (or already present) feedback row, or empty for a
     *         foreign or absent generation (NOT_FOUND_OR_FORBIDDEN)
     * @throws IllegalArgumentException on an unapproved kind, an over-long
     *         note, or a non-positive id
     */
    public Optional<GenerationFeedbackRecord> record(
            long ownerUserId, long generationId, String kind, String note) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        String normalized = normalizeKind(kind);
        if (note != null && note.length() > MAX_NOTE_LENGTH) {
            throw new IllegalArgumentException(
                    "note must not exceed " + MAX_NOTE_LENGTH + " characters");
        }
        List<GenerationFeedbackRecord> rows;
        try {
            rows = jdbc.query(
                    "SELECT o_generation_id, o_kind, o_note, o_created_at "
                            + "FROM vc.record_generation_feedback(?, ?, ?, ?)",
                    (rs, rowNum) -> new GenerationFeedbackRecord(
                            rs.getLong("o_generation_id"),
                            rs.getString("o_kind"),
                            rs.getString("o_note"),
                            rs.getTimestamp("o_created_at").toInstant()),
                    ownerUserId,
                    generationId,
                    normalized,
                    note);
        } catch (BadSqlGrammarException e) {
            // Schema unavailable: keep the existing 503 SCHEMA_UNAVAILABLE
            // classification instead of folding it into an invalid request.
            throw e;
        } catch (DataAccessException e) {
            // Eager validation passed, so a RAISE here is an unexpected guard
            // trip (defense in depth); surface it as an invalid request.
            throw new IllegalArgumentException(
                    "record_generation_feedback rejected the request", e);
        }
        return rows.stream().findFirst();
    }
}
