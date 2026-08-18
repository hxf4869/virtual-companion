package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * GEN-VER (V53 / FR-CHAT-003): list and select generation versions for one
 * user message. Existence is never disclosed — a missing or foreign id
 * returns an empty list / false.
 */
public class GenerationVersionService {

    private final JdbcTemplate jdbc;

    public GenerationVersionService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public record GenerationVersion(
            long generationId,
            boolean selected,
            String status,
            Instant createdAt,
            Long assistantMessageId) {
    }

    public List<GenerationVersion> list(long ownerUserId, long sourceUserMessageId) {
        requirePositive(ownerUserId, "ownerUserId");
        requirePositive(sourceUserMessageId, "sourceUserMessageId");
        return jdbc.query(
                "SELECT out_generation_id, out_selected, out_status, "
                        + "out_created_at, out_assistant_message_id "
                        + "FROM vc.list_generation_versions(?, ?)",
                rowMapper(),
                ownerUserId,
                sourceUserMessageId);
    }

    public boolean select(long ownerUserId, long generationId) {
        requirePositive(ownerUserId, "ownerUserId");
        requirePositive(generationId, "generationId");
        Boolean ok = jdbc.queryForObject(
                "SELECT vc.select_generation_version(?, ?)",
                Boolean.class,
                ownerUserId,
                generationId);
        return Boolean.TRUE.equals(ok);
    }

    public Optional<GenerationVersion> find(long ownerUserId, long generationId) {
        requirePositive(ownerUserId, "ownerUserId");
        requirePositive(generationId, "generationId");
        Long source = jdbc.query(
                "SELECT source_user_message_id FROM vc.generation WHERE owner_user_id = ? AND id = ?",
                (rs, rowNum) -> (Long) rs.getObject("source_user_message_id"),
                ownerUserId,
                generationId)
                .stream()
                .findFirst()
                .orElse(null);
        if (source == null) {
            return Optional.empty();
        }
        return list(ownerUserId, source).stream()
                .filter(row -> row.generationId() == generationId)
                .findFirst();
    }

    private static void requirePositive(long value, String name) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }

    private static RowMapper<GenerationVersion> rowMapper() {
        return (rs, rowNum) -> {
            Timestamp created = rs.getTimestamp("out_created_at");
            Long assistant = (Long) rs.getObject("out_assistant_message_id");
            return new GenerationVersion(
                    rs.getLong("out_generation_id"),
                    rs.getBoolean("out_selected"),
                    rs.getString("out_status"),
                    created == null ? Instant.EPOCH : created.toInstant(),
                    assistant);
        };
    }
}
