package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Relationship lifecycle persistence over the V9 SECURITY DEFINER functions
 * (TASK-0178).
 *
 * <p>Wraps {@code vc.create_relationship}, {@code vc.list_relationships},
 * {@code vc.get_relationship}, {@code vc.activate_relationship} and
 * {@code vc.deactivate_relationship}. Every call runs in the server-trusted
 * owner context established upstream (the request filter bound
 * {@code vc.owner_user_id}); the V17 trusted-owner assertion inside each
 * function re-checks that the caller-supplied owner matches. A foreign or
 * absent relationship id resolves to {@link Optional#empty()} so the HTTP layer
 * can map it to {@code NOT_FOUND_OR_FORBIDDEN} without disclosing existence.
 */
public class RelationshipService {

    private final JdbcTemplate jdbc;

    public RelationshipService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Create a new relationship that becomes the owner's single active Companion;
     * any previously active relationship is atomically deactivated
     * (activeCompanionLimit=1, V9 advisory lock + partial unique index).
     */
    public long create(long ownerUserId, String personaRef) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (personaRef == null || personaRef.isBlank()) {
            throw new IllegalArgumentException("personaRef must not be blank");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.create_relationship(?, ?)",
                Long.class,
                ownerUserId,
                personaRef);
        if (id == null) {
            throw new IllegalStateException("create_relationship returned no id");
        }
        return id;
    }

    /** List every relationship owned by the caller (active and dormant). */
    public List<RelationshipRecord> list(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_persona_ref, out_active, out_created_at, "
                        + "out_companion_name, out_user_address_as, out_reply_length, "
                        + "out_initiative, out_humor, out_advice_pref, out_reminders_allowed, "
                        + "out_memory_share_scope, out_avoid_topics, out_gender, out_avatar_ref "
                        + "FROM vc.list_relationships(?)",
                rowMapper(),
                ownerUserId);
    }

    /** Fetch one relationship; empty for a foreign or absent id. */
    public Optional<RelationshipRecord> get(long ownerUserId, long relationshipId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_persona_ref, out_active, out_created_at, "
                        + "out_companion_name, out_user_address_as, out_reply_length, "
                        + "out_initiative, out_humor, out_advice_pref, out_reminders_allowed, "
                        + "out_memory_share_scope, out_avoid_topics, out_gender, out_avatar_ref "
                        + "FROM vc.get_relationship(?, ?)",
                rowMapper(),
                ownerUserId,
                relationshipId).stream().findFirst();
    }

    /**
     * Promote one relationship to the single active Companion. Returns the
     * updated row, or empty for a foreign/absent id (NOT_FOUND_OR_FORBIDDEN).
     * Existence is pre-checked so the {@code activate_relationship} RAISE never
     * surfaces as a generic persistence failure for the common not-owned case.
     */
    public Optional<RelationshipRecord> activate(long ownerUserId, long relationshipId) {
        if (get(ownerUserId, relationshipId).isEmpty()) {
            return Optional.empty();
        }
        jdbc.queryForObject(
                "SELECT vc.activate_relationship(?, ?)",
                Boolean.class,
                ownerUserId,
                relationshipId);
        return get(ownerUserId, relationshipId);
    }

    /**
     * Deactivate one relationship (Alpha permits zero active Companions). Returns
     * the updated row, or empty for a foreign/absent id (the SD function returns
     * {@code false} when zero rows matched).
     */
    public Optional<RelationshipRecord> deactivate(long ownerUserId, long relationshipId) {
        if (ownerUserId <= 0 || relationshipId <= 0) {
            return Optional.empty();
        }
        Boolean updated = jdbc.queryForObject(
                "SELECT vc.deactivate_relationship(?, ?)",
                Boolean.class,
                ownerUserId,
                relationshipId);
        if (!Boolean.TRUE.equals(updated)) {
            return Optional.empty();
        }
        return get(ownerUserId, relationshipId);
    }

    /**
     * COMP-CFG: replace structured preferences on one owned relationship.
     * Returns the updated row, or empty for a foreign/absent id.
     */
    public Optional<RelationshipRecord> updatePrefs(
            long ownerUserId, long relationshipId, CompanionPrefs prefs) {
        if (ownerUserId <= 0 || relationshipId <= 0) {
            return Optional.empty();
        }
        Objects.requireNonNull(prefs, "prefs must not be null");
        Boolean updated = jdbc.queryForObject(
                "SELECT vc.update_relationship_prefs(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                Boolean.class,
                ownerUserId,
                relationshipId,
                prefs.companionName(),
                prefs.userAddressAs(),
                prefs.replyLength(),
                prefs.initiative(),
                prefs.humor(),
                prefs.advicePref(),
                prefs.remindersAllowed(),
                prefs.memoryShareScope(),
                prefs.avoidTopicsCsv(),
                prefs.gender(),
                prefs.avatarRef());
        if (!Boolean.TRUE.equals(updated)) {
            return Optional.empty();
        }
        return get(ownerUserId, relationshipId);
    }

    private static RowMapper<RelationshipRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> {
            Timestamp ts = rs.getTimestamp("out_created_at");
            Instant createdAt = ts == null ? Instant.EPOCH : ts.toInstant();
            return new RelationshipRecord(
                    rs.getLong("out_id"),
                    rs.getString("out_persona_ref"),
                    rs.getBoolean("out_active"),
                    createdAt,
                    new CompanionPrefs(
                            rs.getString("out_companion_name"),
                            rs.getString("out_user_address_as"),
                            rs.getString("out_reply_length"),
                            rs.getString("out_initiative"),
                            rs.getString("out_humor"),
                            rs.getString("out_advice_pref"),
                            rs.getBoolean("out_reminders_allowed"),
                            rs.getString("out_memory_share_scope"),
                            CompanionPrefs.splitAvoidTopics(rs.getString("out_avoid_topics")),
                            rs.getString("out_gender"),
                            rs.getString("out_avatar_ref")));
        };
    }
}
