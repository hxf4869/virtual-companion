package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Creates a conversation bound to the {@code vc.create_conversation} SECURITY
 * DEFINER function (TASK-0174 V25).
 *
 * <p>V16 revoked the runtime role's direct INSERT on {@code vc.conversation};
 * this V25 SECURITY DEFINER function is the only insertion path. A conversation
 * must reference one of the owner's relationships (FK + RLS), so the caller
 * supplies the {@code relationshipId} previously established via
 * {@code vc.create_relationship}. The function allocates the id from
 * {@code vc.conversation_id_seq} and binds {@code vc.owner_user_id}; the caller
 * must be in a server-trusted owner context (V17 trusted-owner assertion).
 */
public class ConversationCreateService {

    private final JdbcTemplate jdbc;

    public ConversationCreateService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Create a conversation under the owner's relationship.
     *
     * @return the allocated conversation id
     */
    public long create(long ownerUserId, long relationshipId) {
        validateCreate(ownerUserId, relationshipId);
        Long id = jdbc.queryForObject(
                "SELECT vc.create_conversation(?, ?)",
                Long.class,
                ownerUserId,
                relationshipId);
        if (id == null || id <= 0) {
            throw new IllegalStateException("create_conversation returned no id");
        }
        return id;
    }

    static void validateCreate(long ownerUserId, long relationshipId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
    }
}
