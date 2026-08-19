package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Beta service-window state over the V60 SD (SVC-WINDOW, §24.7 / FR-RES-002).
 *
 * <p>Returns the daily-active-user count and whether this owner already
 * generated since the window day start (Asia/Shanghai midnight as an instant,
 * computed by the caller). The window/DAU decision itself lives in the
 * runtime pure policy class; this read is owner-bound (trusted-owner SD).
 */
public class ServiceWindowService {

    /** DAU + owner-active snapshot for one window day. */
    public record WindowState(long dailyActiveUsers, boolean ownerActiveToday) {
    }

    private final JdbcTemplate jdbc;

    public ServiceWindowService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** The window-day state for the owner (day start = zone midnight instant). */
    public WindowState state(long ownerUserId, Instant dayStart) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        Objects.requireNonNull(dayStart, "dayStart must not be null");
        return jdbc.queryForObject(
                "SELECT out_daily_active, out_owner_active "
                        + "FROM vc.beta_service_window_state(?, ?)",
                (rs, rowNum) -> new WindowState(
                        rs.getLong("out_daily_active"),
                        rs.getBoolean("out_owner_active")),
                ownerUserId,
                Timestamp.from(dayStart));
    }
}
