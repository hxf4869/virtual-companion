package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * FR-COMP-004 explicit memory archive / import over V55 SECURITY DEFINER
 * functions. Create and reset never inherit unless the caller POSTs import.
 */
public class MemoryImportService {

    private final JdbcTemplate jdbc;

    public MemoryImportService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public MemoryImportPreview preview(long ownerUserId, String personaRef) {
        if (ownerUserId <= 0 || personaRef == null || personaRef.isBlank()) {
            return new MemoryImportPreview(personaRef == null ? "" : personaRef, 0, null);
        }
        return jdbc.query(
                        "SELECT out_persona_ref, out_item_count, out_created_at "
                                + "FROM vc.preview_importable_memories(?, ?)",
                        (rs, rowNum) -> {
                            Timestamp ts = rs.getTimestamp("out_created_at");
                            Instant created = ts == null ? null : ts.toInstant();
                            return new MemoryImportPreview(
                                    rs.getString("out_persona_ref"),
                                    rs.getInt("out_item_count"),
                                    created);
                        },
                        ownerUserId,
                        personaRef)
                .stream()
                .findFirst()
                .orElseGet(() -> new MemoryImportPreview(personaRef, 0, null));
    }

    /** {@code empty} when the target relationship is absent or foreign. */
    public Optional<Integer> importTo(long ownerUserId, long relationshipId) {
        if (ownerUserId <= 0 || relationshipId <= 0) {
            return Optional.empty();
        }
        Integer imported = jdbc.queryForObject(
                "SELECT vc.import_memories_to_relationship(?, ?)",
                Integer.class,
                ownerUserId,
                relationshipId);
        if (imported != null && imported < 0) {
            return Optional.empty();
        }
        return Optional.of(imported == null ? 0 : imported);
    }

    public boolean discard(long ownerUserId, String personaRef) {
        if (ownerUserId <= 0 || personaRef == null || personaRef.isBlank()) {
            return false;
        }
        Boolean ok = jdbc.queryForObject(
                "SELECT vc.discard_importable_memories(?, ?)",
                Boolean.class,
                ownerUserId,
                personaRef);
        return Boolean.TRUE.equals(ok);
    }
}
