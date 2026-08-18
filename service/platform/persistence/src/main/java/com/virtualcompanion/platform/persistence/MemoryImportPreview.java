package com.virtualcompanion.platform.persistence;

import java.time.Instant;

/** Latest explicit archive of ACCEPTED RELATIONSHIP memories (V55 / FR-COMP-004). */
public record MemoryImportPreview(String personaRef, int acceptedCount, Instant createdAt) {}
