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
    private final RestFieldCipher cipher;

    public MessageRepository(JdbcTemplate jdbc) {
        this(jdbc, null);
    }

    /**
     * CRYPTO-REST (§17.4): when a cipher is wired, stored message bodies
     * decrypt on the model-facing read path ({@link #listByConversation}) —
     * the assembler must never forward encrypted {@code enc1:…} blobs to a
     * live provider. The null cipher keeps legacy call sites (and unit tests)
     * on the raw passthrough.
     */
    public MessageRepository(JdbcTemplate jdbc, RestFieldCipher cipher) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.cipher = cipher;
    }

    /**
     * One {@code vc.message} row. {@code noMemory} is the MEM-NEG (V44)
     * negative-memory marker: memory extraction skips messages flagged true.
     * The legacy 5-arg constructor keeps pre-V44 call sites compiling; the
     * marker defaults to false.
     */
    public record Message(
            long ownerUserId,
            long id,
            long conversationId,
            String role,
            String content,
            boolean noMemory) {

        public Message(long ownerUserId, long id, long conversationId, String role, String content) {
            this(ownerUserId, id, conversationId, role, content, false);
        }

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
                "SELECT owner_user_id, id, conversation_id, role, content, no_memory "
                        + "FROM vc.message WHERE owner_user_id = ? AND id = ?",
                (rs, rowNum) -> new Message(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getLong("conversation_id"),
                        rs.getString("role"),
                        rs.getString("content"),
                        rs.getBoolean("no_memory")),
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
                "SELECT owner_user_id, id, conversation_id, role, content, no_memory "
                        + "FROM vc.message "
                        + "WHERE owner_user_id = ? AND conversation_id = ? "
                        + "ORDER BY id DESC LIMIT 64",
                (rs, rowNum) -> new Message(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getLong("conversation_id"),
                        rs.getString("role"),
                        decrypt(rs.getString("content")),
                        rs.getBoolean("no_memory")),
                ownerUserId,
                conversationId);
        if (recent.size() <= 1) {
            return recent;
        }
        ArrayList<Message> chronological = new ArrayList<>(recent);
        Collections.reverse(chronological);
        return chronological;
    }

    /** CRYPTO-REST: legacy plaintext passes through; the null cipher is raw. */
    private String decrypt(String stored) {
        return cipher == null ? stored : cipher.decrypt(stored);
    }

    /**
     * MSG-DELETE (V37): delete one message of the caller's conversation (the
     * SD also removes the message's memory_evidence rows in the same
     * transaction). true only when an owned row was deleted; a foreign or
     * absent id returns false so existence is never disclosed.
     */
    public boolean deleteMessage(long ownerUserId, long conversationId, long messageId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        if (messageId <= 0) {
            throw new IllegalArgumentException("messageId must be positive");
        }
        Boolean deleted = jdbc.queryForObject(
                "SELECT vc.delete_message(?, ?, ?)",
                Boolean.class,
                ownerUserId,
                conversationId,
                messageId);
        return Boolean.TRUE.equals(deleted);
    }

    /**
     * MEM-NEG (V44): flip the negative-memory marker of one owned message
     * (vc.set_message_no_memory). true only when an owned row changed; a
     * foreign or absent id returns false so existence is never disclosed.
     */
    public boolean setNoMemory(
            long ownerUserId, long conversationId, long messageId, boolean noMemory) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        if (messageId <= 0) {
            throw new IllegalArgumentException("messageId must be positive");
        }
        Boolean changed = jdbc.queryForObject(
                "SELECT vc.set_message_no_memory(?, ?, ?, ?)",
                Boolean.class,
                ownerUserId,
                conversationId,
                messageId,
                noMemory);
        return Boolean.TRUE.equals(changed);
    }
}
