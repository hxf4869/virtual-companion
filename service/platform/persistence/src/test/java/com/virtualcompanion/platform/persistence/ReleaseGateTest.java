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

    private static ReleaseGate gate(ReleaseGate.Snapshot snapshot) {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class))).thenReturn(List.of(snapshot));
        return new ReleaseGate(jdbc);
    }

    @Test
    void syntheticWithoutEvalDoesNotAllowGeneration() {
        ReleaseGate gate = gate(
                new ReleaseGate.Snapshot("SYNTHETIC", false, "synthetic-v1", null));
        assertEquals("SYNTHETIC", gate.snapshot().stage());
        assertFalse(gate.allowsGenerationFor(7L));
    }

    @Test
    void canaryWithEvalAllowsOnlyItsBoundOwner() {
        ReleaseGate gate = gate(new ReleaseGate.Snapshot("CANARY", true, "canary-v1", 7L));
        assertTrue(gate.allowsGenerationFor(7L));
        assertFalse(gate.allowsGenerationFor(8L));
    }

    @Test
    void canaryWithoutAnOwnerFailsClosed() {
        ReleaseGate gate = gate(new ReleaseGate.Snapshot("CANARY", true, "canary-v1", null));
        assertFalse(gate.allowsGenerationFor(7L));
    }

    @Test
    void betaWithEvalAllowsAnAdmittedOwner() {
        ReleaseGate gate = gate(new ReleaseGate.Snapshot("BETA", true, "beta-v1", null));
        assertTrue(gate.allowsGenerationFor(7L));
    }

    @Test
    void evalFailureBlocksEvenBeta() {
        ReleaseGate gate = gate(new ReleaseGate.Snapshot("BETA", false, "beta-v1", null));
        assertFalse(gate.allowsGenerationFor(7L));
    }
}
