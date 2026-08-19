package com.virtualcompanion.platform.persistence;

import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * L2 conversation-summary persistence over the V63 SD functions
 * (CONV-SUMMARY / §11.18).
 *
 * <p>Every row is one append-only version-chain link: the covered message id
 * range, the summarizer model + prompt version, a confidence, a validated
 * flag, the producing service class and the previous row id. The quality
 * floor lives in the SD — a lower-class summary never overwrites a validated
 * higher-class one (returns empty). Message deletion invalidates covering
 * summaries in the same transaction (FR-CHAT-004); readers only see valid
 * rows.
 */
public class ConversationSummaryService {

    public static final String MODEL_ID = "deterministic-summarizer";
    public static final String MODEL_VERSION = "1";
    public static final String PROMPT_VERSION = "1";
    public static final String CLASS_ECONOMY = "ECONOMY";
    public static final String CLASS_PREMIUM = "PREMIUM";

    /** One summary row (read side). */
    public record SummaryRecord(
            long id, long fromMessageId, long toMessageId, String summary,
            String modelId, String modelVersion, String promptVersion,
            double confidence, boolean validated, String serviceClass,
            Long prevId, java.time.Instant createdAt) {
    }

    private final JdbcTemplate jdbc;

    public ConversationSummaryService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    static String normalizeClass(String serviceClass) {
        if (!CLASS_ECONOMY.equals(serviceClass) && !CLASS_PREMIUM.equals(serviceClass)) {
            throw new IllegalArgumentException(
                    "serviceClass must be ECONOMY or PREMIUM: " + serviceClass);
        }
        return serviceClass;
    }

    /**
     * Append one summary row. Returns empty when the SD applies the quality
     * floor (低质不覆盖高质) and skips the write; otherwise the new row id.
     */
    public Optional<Long> record(
            long ownerUserId, long conversationId, long fromMessageId, long toMessageId,
            String summary, String modelId, String modelVersion, String promptVersion,
            double confidence, boolean validated, String serviceClass) {
        if (ownerUserId <= 0 || conversationId <= 0
                || fromMessageId <= 0 || toMessageId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        if (summary == null || summary.isBlank() || summary.length() > 4000) {
            throw new IllegalArgumentException("summary must be 1..4000 characters");
        }
        normalizeClass(serviceClass);
        Long id = jdbc.queryForObject(
                "SELECT vc.record_conversation_summary(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Long.class,
                ownerUserId, conversationId, fromMessageId, toMessageId,
                summary.trim(), modelId, modelVersion, promptVersion,
                confidence, validated, serviceClass);
        if (id == null) {
            throw new IllegalStateException("record_conversation_summary returned no row");
        }
        return id > 0 ? Optional.of(id) : Optional.empty();
    }

    /**
     * CONV-SUMMARY finalize path: append this turn's deterministic summary.
     * Returns empty when the SD's quality floor skipped the write (低质不
     * 覆盖高质) or the turn has no assistant message yet.
     */
    public Optional<Long> recordTurnSummary(long ownerUserId, long generationId) {
        if (ownerUserId <= 0 || generationId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.record_turn_summary(?, ?)",
                Long.class,
                ownerUserId,
                generationId);
        if (id == null) {
            throw new IllegalStateException("record_turn_summary returned no row");
        }
        return id > 0 ? Optional.of(id) : Optional.empty();
    }

    /** The newest VALID summary of the conversation (empty when none). */
    public Optional<SummaryRecord> latest(long ownerUserId, long conversationId) {
        if (ownerUserId <= 0 || conversationId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        List<SummaryRecord> rows = jdbc.query(
                "SELECT out_id, out_from_message_id, out_to_message_id, out_summary, "
                        + "out_model_id, out_model_version, out_prompt_version, "
                        + "out_confidence, out_validated, out_service_class, "
                        + "out_prev_id, out_created_at "
                        + "FROM vc.latest_conversation_summary(?, ?)",
                (rs, rowNum) -> new SummaryRecord(
                        rs.getLong("out_id"),
                        rs.getLong("out_from_message_id"),
                        rs.getLong("out_to_message_id"),
                        rs.getString("out_summary"),
                        rs.getString("out_model_id"),
                        rs.getString("out_model_version"),
                        rs.getString("out_prompt_version"),
                        rs.getDouble("out_confidence"),
                        rs.getBoolean("out_validated"),
                        rs.getString("out_service_class"),
                        (Long) rs.getObject("out_prev_id"),
                        rs.getTimestamp("out_created_at").toInstant()),
                ownerUserId,
                conversationId);
        return rows.stream().findFirst();
    }
}
