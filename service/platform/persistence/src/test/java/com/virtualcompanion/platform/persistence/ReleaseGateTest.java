package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class ReleaseGateTest {

    @Test
    void syntheticWithoutEvalDoesNotAllowLiveExpansion() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class)))
                .thenReturn(List.of(new ReleaseGate.Snapshot("SYNTHETIC", false, "synthetic-v1")));
        ReleaseGate gate = new ReleaseGate(jdbc);
        assertEquals("SYNTHETIC", gate.snapshot().stage());
        assertFalse(gate.allowsLiveExpansion());
    }

    @Test
    void canaryWithEvalAllowsLiveExpansion() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class)))
                .thenReturn(List.of(new ReleaseGate.Snapshot("CANARY", true, "canary-v1")));
        assertTrue(new ReleaseGate(jdbc).allowsLiveExpansion());
    }
}
