package com.virtualcompanion.runtime.servicemode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link BetaServiceWindow} (SVC-WINDOW / §24.7): the pure
 * window policy — disabled flows everything, the pause short-circuits, the
 * time window and the DAU cap fail closed, and an already-active owner never
 * loses a slot mid-conversation.
 */
class BetaServiceWindowTest {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");

    /** 2026-08-19 is a Wednesday; times below are zone-local. */
    private static Instant at(int hour, int minute) {
        return LocalDate.of(2026, 8, 19).atTime(hour, minute, 0).atZone(ZONE).toInstant();
    }

    private final BetaServiceWindow enabled = new BetaServiceWindow(
            true, false, "20:30", 10, "Asia/Shanghai");

    @Test
    void disabledWindowNeverRejects() {
        BetaServiceWindow disabled = new BetaServiceWindow(
                false, true, "20:30", 1, "Asia/Shanghai");

        assertTrue(disabled.rejectReason(at(3, 0), 99, false).isEmpty());
        assertFalse(disabled.enabled());
    }

    @Test
    void pausedShortCircuitsEverything() {
        BetaServiceWindow paused = new BetaServiceWindow(
                true, true, "20:30", 10, "Asia/Shanghai");

        assertEquals(Optional.of("service-paused"),
                paused.rejectReason(at(21, 0), 0, true));
    }

    @Test
    void outsideTheWindowNewTurnsAreRefused() {
        assertEquals(Optional.of("outside-generation-window"),
                enabled.rejectReason(at(0, 0), 0, false));
        assertEquals(Optional.of("outside-generation-window"),
                enabled.rejectReason(at(20, 29), 0, false));
    }

    @Test
    void insideTheWindowTurnsFlow() {
        assertTrue(enabled.rejectReason(at(20, 30), 0, false).isEmpty());
        assertTrue(enabled.rejectReason(at(23, 59), 9, false).isEmpty());
        // Even at the cap, an already-active owner keeps flowing (23:59 late turn).
        assertTrue(enabled.rejectReason(at(23, 59), 10, true).isEmpty());
    }

    @Test
    void dauCapFailsClosedOnlyForNewOwners() {
        // A fresh owner is refused at capacity...
        assertEquals(Optional.of("daily-active-limit"),
                enabled.rejectReason(at(21, 0), 10, false));
        // ...an owner already active today never loses their slot.
        assertTrue(enabled.rejectReason(at(21, 0), 10, true).isEmpty());
        assertTrue(enabled.rejectReason(at(21, 0), 9, false).isEmpty());
    }

    @Test
    void dayStartIsZoneMidnight() {
        assertEquals(
                LocalDate.of(2026, 8, 19).atStartOfDay(ZONE).toInstant(),
                enabled.dayStart(at(21, 0)));
    }

    @Test
    void rejectsBadConfiguration() {
        assertThrows(Exception.class,
                () -> new BetaServiceWindow(true, false, "20:30", 0, "Asia/Shanghai"));
        assertThrows(Exception.class,
                () -> new BetaServiceWindow(true, false, "not-a-time", 10, "Asia/Shanghai"));
    }
}
