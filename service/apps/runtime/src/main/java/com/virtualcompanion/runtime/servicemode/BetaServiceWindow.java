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
 * the betaGate declarations in product-scope (generationWindowFrom 20:30,
 * newGenerationCutoff 00:00, maxDailyActiveUsers 10, Asia/Shanghai) but the
 * whole gate stays {@code enabled=false} until the Beta deployment turns it
 * on, so local development and CI are never blocked.
 *
 * <p>Window semantics: a NEW generation turn is accepted from
 * {@code windowFrom} (inclusive) until midnight ({@code newGenerationCutoff}
 * = 00:00, exclusive next day). Outside the window, history, memory and data
 * rights stay available — only new generative turns are refused. An owner
 * already active today never consumes an extra DAU slot, so an in-flight
 * conversation cannot be split by the cap. {@code paused} is the manual
 * stop switch (停服机制) and short-circuits everything.
 */
public final class BetaServiceWindow {

    private final boolean enabled;
    private final boolean paused;
    private final LocalTime windowFrom;
    private final int maxDailyActiveUsers;
    private final ZoneId zone;

    public BetaServiceWindow(
            boolean enabled, boolean paused, String windowFrom,
            int maxDailyActiveUsers, String zone) {
        this.enabled = enabled;
        this.paused = paused;
        this.windowFrom = LocalTime.parse(Objects.requireNonNull(windowFrom, "windowFrom"));
        if (maxDailyActiveUsers < 1) {
            throw new IllegalArgumentException("maxDailyActiveUsers must be >= 1");
        }
        this.maxDailyActiveUsers = maxDailyActiveUsers;
        this.zone = ZoneId.of(Objects.requireNonNull(zone, "zone"));
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
        if (time.isBefore(windowFrom)) {
            return Optional.of("outside-generation-window");
        }
        if (!ownerActive && dailyActiveUsers >= maxDailyActiveUsers) {
            return Optional.of("daily-active-limit");
        }
        return Optional.empty();
    }

    /** The window boundary shown in transparency copy (HH:mm, zone time). */
    public String windowLabel() {
        return windowFrom + "–00:00 " + zone.getId();
    }
}
