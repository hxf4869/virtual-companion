package com.virtualcompanion.platform.persistence;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * JDBC skeleton for {@code vc.message}.
 *
 * <p>Messages are tenant scoped by FORCE ROW LEVEL SECURITY; reads and writes
 * require the active tenant context ({@code vc.owner_user_id}). The first user
 * message of a generation is normally created by
 * {@code vc.receive_generation} (see {@link GenerationReceiveService}); direct
 * inserts are provided for seeding and auxiliary messages and remain RLS-gated.
 */
public class MessageRepository {

    private final JdbcTemplate jdbc;

    public MessageRepository(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** One {@code vc.message} row. */
    public record Message(long ownerUserId, long id, long conversationId, String role, String content) {
        public Message {
            if (ownerUserId <= 0) {
                throw new IllegalArgumentException("ownerUserId must be positive");
            }
            if (id <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            if (conversationId <= 0) {
                throw new IllegalArgumentException("conversationId must be positive");
            }
            Objects.requireNonNull(role, "role must not be null");
            if (role.isBlank()) {
                throw new IllegalArgumentException("role must not be blank");
            }
            Objects.requireNonNull(content, "content must not be null");
        }
    }

    /** Insert one message row under the active tenant context. */
    public void insert(Message message) {
        Objects.requireNonNull(message, "message must not be null");
        jdbc.update(
                "INSERT INTO vc.message (owner_user_id, id, conversation_id, role, content) "
                        + "VALUES (?, ?, ?, ?, ?)",
                message.ownerUserId(),
                message.id(),
                message.conversationId(),
                message.role(),
                message.content());
    }

    /** Find a message by composite owner + id (RLS-scoped). */
    public Optional<Message> find(long ownerUserId, long id) {
        return jdbc.query(
                "SELECT owner_user_id, id, conversation_id, role, content "
                        + "FROM vc.message WHERE owner_user_id = ? AND id = ?",
                (rs, rowNum) -> new Message(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getLong("conversation_id"),
                        rs.getString("role"),
                        rs.getString("content")),
                ownerUserId,
                id).stream().findFirst();
    }

    /** Number of messages in one conversation (RLS-scoped). */
    public int countByConversation(long ownerUserId, long conversationId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM vc.message "
                        + "WHERE owner_user_id = ? AND conversation_id = ?",
                Integer.class,
                ownerUserId,
                conversationId);
        return count == null ? 0 : count;
    }

    /**
     * List the most recent messages of one conversation in chronological order
     * (RLS-scoped). Capped at {@code 64} rows (the {@code LiveInvocationRequest}
     * message bound) by selecting the newest ids first and reversing back to
     * ascending order, so the caller never assembles an oversized request and
     * never loads the full history (TASK-0176 ZERO_LLM assembler).
     */
    public List<Message> listByConversation(long ownerUserId, long conversationId) {
        List<Message> recent = jdbc.query(
                "SELECT owner_user_id, id, conversation_id, role, content "
                        + "FROM vc.message "
                        + "WHERE owner_user_id = ? AND conversation_id = ? "
                        + "ORDER BY id DESC LIMIT 64",
                (rs, rowNum) -> new Message(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getLong("conversation_id"),
                        rs.getString("role"),
                        rs.getString("content")),
                ownerUserId,
                conversationId);
        if (recent.size() <= 1) {
            return recent;
        }
        ArrayList<Message> chronological = new ArrayList<>(recent);
        Collections.reverse(chronological);
        return chronological;
    }
}
