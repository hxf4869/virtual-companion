package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Paginated message history over the V10 {@code vc.list_messages} SECURITY
 * DEFINER function (TASK-0179).
 *
 * <p>Keyset pagination is stable by the composite key {@code (owner_user_id,
 * id)}: the caller passes the last message id seen as the {@code after} cursor
 * and the server clamps the page size to a safe band (default 50, maximum 100).
 * The composite ownership FK guarantees a message can never reference another
 * owner's conversation, so a foreign or absent conversation resolves to no rows
 * and existence is never disclosed (the HTTP layer returns an empty page).
 */
public class MessageHistoryService {

    private final JdbcTemplate jdbc;

    private final RestFieldCipher cipher;

    public MessageHistoryService(JdbcTemplate jdbc) {
        this(jdbc, null);
    }

    /** CRYPTO-REST: when a cipher is wired, stored bodies decrypt on read. */
    public MessageHistoryService(JdbcTemplate jdbc, RestFieldCipher cipher) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.cipher = cipher;
    }

    /**
     * Return one keyset page of a conversation's messages, ascending by id.
     *
     * @param afterId cursor: return only messages with id greater than this
     *        value; {@code null} starts from the beginning (the SD default 0)
     * @param limit   page size; {@code null} uses the SD default 50, out-of-band
     *        values are clamped by the SD function (1..100)
     */
    public List<MessageHistoryRecord> listMessages(
            long ownerUserId, long conversationId, Long afterId, Integer limit) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_role, out_content, out_created_at, out_no_memory "
                        + "FROM vc.list_messages(?, ?, ?, ?)",
                rowMapper(),
                ownerUserId,
                conversationId,
                afterId,
                limit);
    }

    private RowMapper<MessageHistoryRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> {
            Timestamp ts = rs.getTimestamp("out_created_at");
            Instant createdAt = ts == null ? Instant.EPOCH : ts.toInstant();
            return new MessageHistoryRecord(
                    rs.getLong("out_id"),
                    rs.getString("out_role"),
                    cipher == null ? rs.getString("out_content")
                            : cipher.decrypt(rs.getString("out_content")),
                    createdAt,
                    rs.getBoolean("out_no_memory"));
        };
    }
}
