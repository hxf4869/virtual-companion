package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Shared (DB-backed) admission for high-cost owner routes (S0-30).
 * Login/refresh stay on the process-local abuse guard; emergency-contact is
 * never a limited route.
 */
public final class SensitiveRouteAdmission {

    public static final String GENERATION = "GENERATION";
    public static final String SSE = "SSE";
    public static final String EXPORT = "EXPORT";
    public static final String REPORT = "REPORT";

    static final String ADMIT_SQL =
            "SELECT out_admitted, out_retry_after FROM vc.admit_sensitive_route(?, ?, ?, ?)";

    public record Decision(boolean admitted, int retryAfterSeconds) {
        public Decision {
            if (retryAfterSeconds < 1) {
                throw new IllegalArgumentException("retryAfterSeconds must be positive");
            }
        }
    }

    private final JdbcTemplate jdbc;

    public SensitiveRouteAdmission(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public Decision admit(long ownerUserId, String route, int limit, int windowSeconds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        Objects.requireNonNull(route, "route must not be null");
        return jdbc.query(
                ADMIT_SQL,
                (rs, rowNum) -> new Decision(
                        rs.getBoolean("out_admitted"),
                        rs.getInt("out_retry_after")),
                ownerUserId,
                route,
                limit,
                windowSeconds).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("admit_sensitive_route returned no row"));
    }
}
