package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Simulated entitlement persistence over the V40 SD functions (ENT-SNAP /
 * A3-001 / FR-ENT-004).
 *
 * <p>{@link #assign} and {@link #listAssignments} are ADMIN-only (re-verified
 * in SQL, V31 pattern). {@link #mint} is trusted-owner and idempotent per
 * generation: retries of the same logical generation resolve the same
 * immutable snapshot, and a later reassignment never rewrites history. An
 * unassigned account mints {@code ECONOMY} (the Alpha default).
 */
public class EntitlementSnapshotService {

    public static final String CLASS_ECONOMY = "ECONOMY";
    public static final String CLASS_PREMIUM = "PREMIUM";

    private static final Set<String> APPROVED_CLASSES = Set.of(CLASS_ECONOMY, CLASS_PREMIUM);

    private final JdbcTemplate jdbc;

    public EntitlementSnapshotService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** ENT-SNAP: narrow an admin-supplied class code (fail closed). */
    public static String normalizeServiceClass(String serviceClass) {
        if (serviceClass == null || serviceClass.isBlank()) {
            throw new IllegalArgumentException("serviceClass must not be blank");
        }
        if (!APPROVED_CLASSES.contains(serviceClass)) {
            throw new IllegalArgumentException(
                    "serviceClass must be ECONOMY or PREMIUM: " + serviceClass);
        }
        return serviceClass;
    }

    /**
     * ENT-SNAP: mint (or resolve) the generation's immutable entitlement
     * snapshot. Runs inside the worker's guarded prepare segment.
     */
    public MintedEntitlementSnapshot mint(long ownerUserId, long generationId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        List<MintedEntitlementSnapshot> rows = jdbc.query(
                "SELECT out_id, out_service_class FROM vc.mint_entitlement_snapshot(?, ?)",
                (rs, rowNum) -> new MintedEntitlementSnapshot(
                        rs.getLong("out_id"),
                        rs.getString("out_service_class")),
                ownerUserId,
                generationId);
        return rows.stream().findFirst().orElseThrow(
                () -> new IllegalStateException("mint_entitlement_snapshot returned no row"));
    }

    /** ENT-SNAP: ADMIN-only tier assignment (upsert). */
    public boolean assign(long actingAccountId, long targetAccountId, String serviceClass) {
        if (actingAccountId <= 0 || targetAccountId <= 0) {
            throw new IllegalArgumentException("account ids must be positive");
        }
        String normalized = normalizeServiceClass(serviceClass);
        Boolean assigned = jdbc.queryForObject(
                "SELECT vc.assign_service_class(?, ?, ?)",
                Boolean.class,
                actingAccountId,
                targetAccountId,
                normalized);
        return Boolean.TRUE.equals(assigned);
    }

    /** ENT-SNAP: ADMIN-only assignment registry read. */
    public List<ServiceClassAssignment> listAssignments(long actingAccountId) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_account_id, out_username, out_service_class, "
                        + "out_assigned_at, out_updated_at "
                        + "FROM vc.list_service_class_assignments(?)",
                (rs, rowNum) -> new ServiceClassAssignment(
                        rs.getLong("out_account_id"),
                        rs.getString("out_username"),
                        rs.getString("out_service_class"),
                        rs.getTimestamp("out_assigned_at") == null
                                ? null : rs.getTimestamp("out_assigned_at").toInstant(),
                        rs.getTimestamp("out_updated_at") == null
                                ? null : rs.getTimestamp("out_updated_at").toInstant()),
                actingAccountId);
    }

    /** One minted (or resolved) immutable snapshot. */
    public record MintedEntitlementSnapshot(long id, String serviceClass) {
        public MintedEntitlementSnapshot {
            if (id <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            Objects.requireNonNull(serviceClass, "serviceClass must not be null");
        }
    }

    /** One ADMIN assignment registry row. */
    public record ServiceClassAssignment(
            long accountId,
            String username,
            String serviceClass,
            Instant assignedAt,
            Instant updatedAt) {
        public ServiceClassAssignment {
            if (accountId <= 0) {
                throw new IllegalArgumentException("accountId must be positive");
            }
            Objects.requireNonNull(username, "username must not be null");
            Objects.requireNonNull(serviceClass, "serviceClass must not be null");
        }
    }
}
