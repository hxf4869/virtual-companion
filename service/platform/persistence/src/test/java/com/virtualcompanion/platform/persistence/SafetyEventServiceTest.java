package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link SafetyEventService} (SAFETY-WIRE / V58): the SD call
 * shape and the eager rule-id validation.
 */
class SafetyEventServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final SafetyEventService service = new SafetyEventService(jdbc);

    @Test
    void recordCallsTheSdAndReturnsTheId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.record_safety_event(?, ?, ?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq(10L),
                eq("FINAL"),
                eq("R3_HIGH"),
                eq("output-ai-identity-human-claim")))
                .thenReturn(9L);

        assertEquals(9L, service.record(
                1L, 10L, SafetyEventService.STAGE_FINAL, "R3_HIGH",
                "output-ai-identity-human-claim"));
    }

    @Test
    void recordRejectsBadOwnerOrRuleId() {
        assertThrows(IllegalArgumentException.class,
                () -> service.record(0L, 10L, "FINAL", "R3_HIGH", "x"));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, 10L, "FINAL", "R3_HIGH", "  "));
        assertThrows(IllegalArgumentException.class,
                () -> service.record(1L, 10L, "FINAL", "R3_HIGH", "x".repeat(101)));
    }
}
