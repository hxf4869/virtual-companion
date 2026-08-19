package com.virtualcompanion.runtime.servicemode;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.Objects;
import java.util.Optional;

/**
 * Beta service-window policy (SVC-WINDOW, §24.7 / FR-RES-002) — a pure,
 * deterministic function over the deployment configuration. Defaults mirror
 * §24.7: generative chat open 10:00–22:00 (maxDailyActiveUsers 10,
 * Asia/Shanghai) but the whole gate stays {@code enabled=false} until the
 * Beta deployment turns it on, so local development and CI are never blocked.
 *
 * <p>Window semantics: a NEW generation turn is accepted from
 * {@code windowFrom} (inclusive) until {@code windowUntil} (exclusive). A
 * same-day window has {@code from < until} (10:00–22:00); an overnight
 * window has {@code from > until} (20:30–00:00, i.e. until-midnight). Equal
 * boundaries are rejected as degenerate. Outside the window, history, memory
 * and data rights stay available — only new generative turns are refused. An
 * owner already active today never consumes an extra DAU slot, so an
 * in-flight conversation cannot be split by the cap. {@code paused} is the
 * manual stop switch (停服机制) and short-circuits everything.
 */
public final class BetaServiceWindow {

    private final boolean enabled;
    private final boolean paused;
    private final LocalTime windowFrom;
    private final LocalTime windowUntil;
    private final int maxDailyActiveUsers;
    private final ZoneId zone;

    public BetaServiceWindow(
            boolean enabled, boolean paused, String windowFrom, String windowUntil,
            int maxDailyActiveUsers, String zone) {
        this.enabled = enabled;
        this.paused = paused;
        this.windowFrom = LocalTime.parse(Objects.requireNonNull(windowFrom, "windowFrom"));
        this.windowUntil = LocalTime.parse(Objects.requireNonNull(windowUntil, "windowUntil"));
        if (this.windowFrom.equals(this.windowUntil)) {
            throw new IllegalArgumentException(
                    "windowFrom and windowUntil must differ (an empty window is a config error)");
        }
        if (maxDailyActiveUsers < 1) {
            throw new IllegalArgumentException("maxDailyActiveUsers must be >= 1");
        }
        this.maxDailyActiveUsers = maxDailyActiveUsers;
        this.zone = ZoneId.of(Objects.requireNonNull(zone, "zone"));
    }

    /** Pre-V42 shape: a until-midnight window ({@code until = 00:00}). */
    public BetaServiceWindow(
            boolean enabled, boolean paused, String windowFrom,
            int maxDailyActiveUsers, String zone) {
        this(enabled, paused, windowFrom, "00:00", maxDailyActiveUsers, zone);
    }

    /** Whether the gate is on at all (false = everything flows, local dev). */
    public boolean enabled() {
        return enabled;
    }

    /** The window day start of {@code now} as an instant (zone midnight). */
    public Instant dayStart(Instant now) {
        return ZonedDateTime.ofInstant(now, zone).toLocalDate().atStartOfDay(zone).toInstant();
    }

    /**
     * Why a new generative turn must be refused, or empty when allowed.
     * Reasons are stable machine strings the runtime maps to one uniform
     * plain-language error; nothing here is locale or persona wording.
     */
    public Optional<String> rejectReason(Instant now, long dailyActiveUsers, boolean ownerActive) {
        if (!enabled) {
            return Optional.empty();
        }
        if (paused) {
            return Optional.of("service-paused");
        }
        LocalTime time = ZonedDateTime.ofInstant(now, zone).toLocalTime();
        if (!insideWindow(time)) {
            return Optional.of("outside-generation-window");
        }
        if (!ownerActive && dailyActiveUsers >= maxDailyActiveUsers) {
            return Optional.of("daily-active-limit");
        }
        return Optional.empty();
    }

    /** Same-day ({@code from < until}) or overnight ({@code from > until}). */
    private boolean insideWindow(LocalTime time) {
        if (windowFrom.isBefore(windowUntil)) {
            return !time.isBefore(windowFrom) && time.isBefore(windowUntil);
        }
        return !time.isBefore(windowFrom) || time.isBefore(windowUntil);
    }

    /** The window boundary shown in transparency copy (HH:mm, zone time). */
    public String windowLabel() {
        return windowFrom + "–" + windowUntil + " " + zone.getId();
    }
}
