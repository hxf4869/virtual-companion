package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * JDBC skeleton for {@code vc.conversation}.
 *
 * <p>Conversations are tenant scoped: the table is protected by FORCE ROW LEVEL
 * SECURITY, so reads and writes require the active tenant context
 * ({@code vc.owner_user_id}) to be bound by the surrounding request; the owner
 * is also passed explicitly as defense in depth. This is the persistence
 * skeleton — the schema, roles and policies live in the Flyway migrations.
 */
public class ConversationRepository {

    private final JdbcTemplate jdbc;

    public ConversationRepository(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** One {@code vc.conversation} row. {@code title} may be {@code null}. */
    public record Conversation(long ownerUserId, long id, long relationshipId, String title) {
        public Conversation {
            if (ownerUserId <= 0) {
                throw new IllegalArgumentException("ownerUserId must be positive");
            }
            if (id <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            if (relationshipId <= 0) {
                throw new IllegalArgumentException("relationshipId must be positive");
            }
        }
    }

    /** Insert one conversation row under the active tenant context. */
    public void insert(Conversation conversation) {
        Objects.requireNonNull(conversation, "conversation must not be null");
        jdbc.update(
                "INSERT INTO vc.conversation (owner_user_id, id, relationship_id, title) "
                        + "VALUES (?, ?, ?, ?)",
                conversation.ownerUserId(),
                conversation.id(),
                conversation.relationshipId(),
                conversation.title());
    }

    /** Find a conversation by composite owner + id (RLS-scoped). */
    public Optional<Conversation> find(long ownerUserId, long id) {
        return jdbc.query(
                "SELECT owner_user_id, id, relationship_id, title "
                        + "FROM vc.conversation WHERE owner_user_id = ? AND id = ?",
                (rs, rowNum) -> new Conversation(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getLong("relationship_id"),
                        rs.getString("title")),
                ownerUserId,
                id).stream().findFirst();
    }

    /**
     * INC-MODE (V38): whether the conversation owning a generation is
     * incognito (RLS-scoped join; false when the generation is unknown — the
     * caller decides whether absence should fail closed).
     */
    public boolean isIncognitoForGeneration(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        Boolean incognito = jdbc.queryForObject(
                "SELECT c.incognito "
                        + "FROM vc.conversation c "
                        + "JOIN vc.generation g "
                        + "  ON g.owner_user_id = c.owner_user_id "
                        + " AND g.conversation_id = c.id "
                        + "WHERE c.owner_user_id = ? AND g.id = ?",
                Boolean.class,
                ownerUserId,
                generationId);
        return Boolean.TRUE.equals(incognito);
    }

    /**
     * CONV-MGMT (V32): delete one conversation (in-flight work items are
     * cancelled inside the SD; dependent rows cascade). true only when an
     * owned row was deleted; a foreign or absent id returns false so
     * existence is never disclosed.
     */
    public boolean delete(long ownerUserId, long conversationId) {
        validate(ownerUserId, conversationId);
        Boolean deleted = jdbc.queryForObject(
                "SELECT vc.delete_conversation(?, ?)",
                Boolean.class,
                ownerUserId,
                conversationId);
        return Boolean.TRUE.equals(deleted);
    }

    /**
     * CONV-MGMT (V32): write the conversation title (blank clears it). true
     * only when an owned row was updated; a foreign or absent id returns false.
     */
    public boolean rename(long ownerUserId, long conversationId, String title) {
        validate(ownerUserId, conversationId);
        Boolean renamed = jdbc.queryForObject(
                "SELECT vc.rename_conversation(?, ?, ?)",
                Boolean.class,
                ownerUserId,
                conversationId,
                title);
        return Boolean.TRUE.equals(renamed);
    }

    private static void validate(long ownerUserId, long conversationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
    }
}
