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
public record RelationshipRecord(long id, String personaRef, boolean active, Instant createdAt) {

    public RelationshipRecord {
        if (personaRef == null || personaRef.isBlank()) {
            throw new IllegalArgumentException("personaRef must not be blank");
        }
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
    }
}
