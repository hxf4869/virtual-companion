package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link RelationshipService} (TASK-0178). Verifies the V9 SD
 * function calls, the row mapping, and the NOT_FOUND_OR_FORBIDDEN contract
 * (empty Optional for foreign/absent ids). The real SQL round-trip is carried
 * by DB tests 26/27/28/29.
 */
class RelationshipServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final RelationshipService service = new RelationshipService(jdbc);

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");

    @Test
    void createCallsTheV9FunctionAndReturnsId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.create_relationship(?, ?)"), eq(Long.class), eq(1L), eq("persona-a")))
                .thenReturn(55L);

        assertEquals(55L, service.create(1L, "persona-a"));
        verify(jdbc).queryForObject(
                eq("SELECT vc.create_relationship(?, ?)"), eq(Long.class), eq(1L), eq("persona-a"));
    }

    @Test
    void createRejectsBlankPersona() {
        assertThrows(IllegalArgumentException.class, () -> service.create(1L, "  "));
    }

    @Test
    void listMapsV9RowsToRecords() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong("out_id")).thenReturn(55L);
        when(rs.getString("out_persona_ref")).thenReturn("persona-a");
        when(rs.getBoolean("out_active")).thenReturn(true);
        when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L)))
                .thenReturn(List.of(new RelationshipRecord(55L, "persona-a", true, NOW)));

        List<RelationshipRecord> records = service.list(1L);

        assertEquals(1, records.size());
        assertEquals(55L, records.get(0).id());
        assertEquals("persona-a", records.get(0).personaRef());
        assertTrue(records.get(0).active());
        assertEquals(NOW, records.get(0).createdAt());
    }

    @Test
    void getReturnsEmptyForForeignOrAbsentId() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        Optional<RelationshipRecord> record = service.get(1L, 99L);

        assertTrue(record.isEmpty());
    }

    @Test
    void activateReturnsEmptyWhenRelationshipDoesNotExist() {
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        Optional<RelationshipRecord> record = service.activate(1L, 99L);

        assertTrue(record.isEmpty());
        verify(jdbc).query(anyString(), any(RowMapper.class), eq(1L), eq(99L));
    }

    @Test
    void deactivateReturnsEmptyWhenSdFunctionReportsNoRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.deactivate_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(99L)))
                .thenReturn(false);

        Optional<RelationshipRecord> record = service.deactivate(1L, 99L);

        assertTrue(record.isEmpty());
    }

    @Test
    void updatePrefsCallsTheSdFunctionAndReloads() {
        CompanionPrefs prefs = CompanionPrefs.defaults();
        when(jdbc.queryForObject(
                eq("SELECT vc.update_relationship_prefs(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(Boolean.class),
                eq(1L), eq(55L),
                eq(null), eq(null),
                eq("MEDIUM"), eq("LOW"), eq("LIGHT"), eq("ASK_FIRST"),
                eq(false), eq("RELATIONSHIP"), eq(""),
                eq("NEUTRAL"), eq("AVATAR_NEUTRAL_01")))
                .thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(new RelationshipRecord(55L, "persona-a", true, NOW, prefs)));

        Optional<RelationshipRecord> record = service.updatePrefs(1L, 55L, prefs);

        assertTrue(record.isPresent());
        assertEquals("MEDIUM", record.get().prefs().replyLength());
    }

    @Test
    void updatePrefsReturnsEmptyWhenSdFunctionReportsNoRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.update_relationship_prefs(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
                eq(Boolean.class),
                eq(1L), eq(99L),
                eq(null), eq(null),
                eq("MEDIUM"), eq("LOW"), eq("LIGHT"), eq("ASK_FIRST"),
                eq(false), eq("RELATIONSHIP"), eq(""),
                eq("NEUTRAL"), eq("AVATAR_NEUTRAL_01")))
                .thenReturn(false);

        Optional<RelationshipRecord> record = service.updatePrefs(1L, 99L, CompanionPrefs.defaults());

        assertTrue(record.isEmpty());
    }

    @Test
    void deactivateReturnsUpdatedRowWhenSdFunctionReportsSuccess() throws Exception {
        when(jdbc.queryForObject(
                eq("SELECT vc.deactivate_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong("out_id")).thenReturn(55L);
        when(rs.getString("out_persona_ref")).thenReturn("persona-a");
        when(rs.getBoolean("out_active")).thenReturn(false);
        when(rs.getTimestamp("out_created_at")).thenReturn(Timestamp.from(NOW));
        when(rs.getString("out_gender")).thenReturn("NEUTRAL");
        when(rs.getString("out_avatar_ref")).thenReturn("AVATAR_NEUTRAL_01");
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(new RelationshipRecord(55L, "persona-a", false, NOW)));

        Optional<RelationshipRecord> record = service.deactivate(1L, 55L);

        assertTrue(record.isPresent());
        assertFalse(record.get().active());
    }

    @Test
    void previewClearanceMapsSdCounts() {
        when(jdbc.query(
                eq("SELECT out_conversation_count, out_memory_count, out_reminder_count "
                        + "FROM vc.preview_relationship_clearance(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(55L)))
                .thenReturn(List.of(new RelationshipClearancePreview(55L, 2L, 3L, 1L)));

        Optional<RelationshipClearancePreview> preview = service.previewClearance(1L, 55L);

        assertTrue(preview.isPresent());
        assertEquals(55L, preview.get().relationshipId());
        assertEquals(2L, preview.get().conversationCount());
        assertEquals(3L, preview.get().memoryCount());
        assertEquals(1L, preview.get().reminderCount());
    }

    @Test
    void previewClearanceReturnsEmptyForForeignOrAbsentId() {
        when(jdbc.query(
                eq("SELECT out_conversation_count, out_memory_count, out_reminder_count "
                        + "FROM vc.preview_relationship_clearance(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(99L)))
                .thenReturn(List.of());

        assertTrue(service.previewClearance(1L, 99L).isEmpty());
    }

    @Test
    void resetCallsTheSdFunctionAndReloads() {
        when(jdbc.queryForObject(
                eq("SELECT vc.reset_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);
        when(jdbc.query(anyString(), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(new RelationshipRecord(55L, "persona-a", true, NOW)));

        Optional<RelationshipRecord> record = service.reset(1L, 55L);

        assertTrue(record.isPresent());
        assertEquals(55L, record.get().id());
        verify(jdbc).queryForObject(
                eq("SELECT vc.reset_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void resetReturnsEmptyWhenSdFunctionReportsNoRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.reset_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(99L)))
                .thenReturn(false);

        assertTrue(service.reset(1L, 99L).isEmpty());
    }

    @Test
    void deleteCallsTheSdFunction() {
        when(jdbc.queryForObject(
                eq("SELECT vc.delete_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);

        assertTrue(service.delete(1L, 55L));
        verify(jdbc).queryForObject(
                eq("SELECT vc.delete_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void deleteReturnsFalseWhenSdFunctionReportsNoRow() {
        when(jdbc.queryForObject(
                eq("SELECT vc.delete_relationship(?, ?)"), eq(Boolean.class), eq(1L), eq(99L)))
                .thenReturn(false);

        assertFalse(service.delete(1L, 99L));
    }
}
