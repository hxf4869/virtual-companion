package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Paginated conversation list over the V30 {@code vc.list_conversations}
 * SECURITY DEFINER function (CONV-HIST).
 *
 * <p>Keyset pagination is stable by the composite key {@code (owner_user_id,
 * id)}: the caller passes the last conversation id seen as the {@code after}
 * cursor and the server clamps the page size to a safe band (default 50,
 * maximum 100). The optional relationship filter never discloses a foreign
 * relationship's existence — it resolves to no rows, indistinguishable from an
 * empty list.
 */
public class ConversationListService {

    private static final String LIST_SQL =
            "SELECT out_id, out_relationship_id, out_created_at, "
                    + "out_last_message_role, out_last_message_preview, out_title "
                    + "FROM vc.list_conversations(?, ?, ?, ?)";

    private final JdbcTemplate jdbc;

    public ConversationListService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Return one keyset page of the caller's conversations, ascending by id.
     *
     * @param relationshipId restrict to one relationship; {@code null} lists
     *        every conversation owned by the caller
     * @param afterId cursor: return only conversations with id greater than
     *        this value; {@code null} starts from the beginning (SD default 0)
     * @param limit page size; {@code null} uses the SD default 50, out-of-band
     *        values are clamped by the SD function (1..100)
     */
    public List<ConversationListRecord> listConversations(
            long ownerUserId, Long relationshipId, Long afterId, Integer limit) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId != null && relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        return jdbc.query(
                LIST_SQL,
                rowMapper(),
                ownerUserId,
                relationshipId,
                afterId,
                limit);
    }

    private static RowMapper<ConversationListRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> {
            Timestamp ts = rs.getTimestamp("out_created_at");
            Instant createdAt = ts == null ? Instant.EPOCH : ts.toInstant();
            return new ConversationListRecord(
                    rs.getLong("out_id"),
                    rs.getLong("out_relationship_id"),
                    createdAt,
                    rs.getString("out_last_message_role"),
                    rs.getString("out_last_message_preview"),
                    rs.getString("out_title"));
        };
    }
}
