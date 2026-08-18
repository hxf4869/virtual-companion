package com.virtualcompanion.platform.persistence;

/**
 * Factual scope of relationship-domain rows a reset or delete would clear
 * (FR-COMP-004 / V49 {@code vc.preview_relationship_clearance}).
 */
public record RelationshipClearancePreview(
        long relationshipId,
        long conversationCount,
        long memoryCount,
        long reminderCount) {
}
