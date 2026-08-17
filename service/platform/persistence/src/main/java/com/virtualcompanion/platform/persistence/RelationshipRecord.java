package com.virtualcompanion.platform.persistence;

import java.time.Instant;

/**
 * One Companion relationship row owned by exactly one user (TASK-0178).
 *
 * <p>Maps the {@code vc.relationship} table columns surfaced by the V9
 * {@code list_relationships} / {@code get_relationship} SECURITY DEFINER
 * functions. At most one relationship per owner is active at any time
 * ({@code activeCompanionLimit=1}, enforced by a partial unique index).
 */
public record RelationshipRecord(
        long id, String personaRef, boolean active, Instant createdAt, CompanionPrefs prefs) {

    public RelationshipRecord {
        if (personaRef == null || personaRef.isBlank()) {
            throw new IllegalArgumentException("personaRef must not be blank");
        }
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
        if (prefs == null) {
            throw new IllegalArgumentException("prefs must not be null");
        }
    }

    /** Convenience for callers that only need identity/lifecycle fields. */
    public RelationshipRecord(long id, String personaRef, boolean active, Instant createdAt) {
        this(id, personaRef, active, createdAt, CompanionPrefs.defaults());
    }
}
