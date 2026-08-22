package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class OpsCaseTest {

    @Test
    void openPinsSqlAndMapsInserted() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq("REPORT"), eq(7L), eq(9L), eq("P2")))
                .thenReturn(List.of(new OpsCase.OpenResult(3L, true)));
        OpsCase cases = new OpsCase(jdbc);

        OpsCase.OpenResult result = cases.open(1L, "REPORT", 7L, 9L, "P2");
        assertEquals(3L, result.id());
        assertTrue(result.inserted());
        verify(jdbc).query(
                eq(OpsCase.OPEN_SQL),
                any(RowMapper.class),
                eq(1L), eq("REPORT"), eq(7L), eq(9L), eq("P2"));
    }

    @Test
    void snapshotOmitsInternalNoteAndNullSla() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Instant opened = Instant.parse("2026-08-23T00:00:00Z");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(3L)))
                .thenReturn(List.of(new OpsCase.Snapshot(
                        3L, "REPORT", 7L, 9L, "OPEN", "P2",
                        null, null, "", "", opened)));
        OpsCase.Snapshot snapshot = new OpsCase(jdbc).snapshot(1L, 3L);
        assertEquals("OPEN", snapshot.status());
        assertNull(snapshot.slaHours());
        assertEquals("", snapshot.publicNote());
        verify(jdbc).query(eq(OpsCase.SNAPSHOT_SQL), any(RowMapper.class), eq(1L), eq(3L));
    }

    @Test
    void transitionPinsActionSql() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(
                anyString(), any(RowMapper.class),
                eq(1L), eq(3L), eq("ACK"), eq(null), eq(null)))
                .thenReturn(List.of(new OpsCase.TransitionResult(3L, "ACKNOWLEDGED")));
        OpsCase.TransitionResult result = new OpsCase(jdbc).transition(1L, 3L, "ACK", null, null);
        assertEquals("ACKNOWLEDGED", result.status());
        verify(jdbc).query(
                eq(OpsCase.TRANSITION_SQL), any(RowMapper.class),
                eq(1L), eq(3L), eq("ACK"), eq(null), eq(null));
    }

    @Test
    void listPinsRedactedSql() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Instant opened = Instant.parse("2026-08-23T00:00:00Z");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(null), eq(50)))
                .thenReturn(List.of(new OpsCase.Snapshot(
                        3L, "REPORT", 7L, 9L, "OPEN", "P2",
                        null, null, "", "", opened)));
        assertEquals(1, new OpsCase(jdbc).list(1L, null, 50).size());
        verify(jdbc).query(eq(OpsCase.LIST_SQL), any(RowMapper.class), eq(1L), eq(null), eq(50));
    }
}
