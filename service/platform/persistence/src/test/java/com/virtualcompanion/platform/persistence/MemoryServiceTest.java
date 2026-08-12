package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link MemoryService} (TASK-0180). Verifies the V11/V12/V13
 * SD calls, the pre-checks (relationship existence for create; non-deleted
 * existence and editable/pending status for update/delete/confirm/reject), and
 * the DataAccessException translation — a leaked SD RAISE would otherwise be
 * misclassified by the global auth advice as 401 AUTHENTICATION_REQUIRED, and
 * the OpenAPI memory contract maps every foreign/absent/deleted/dead-end case
 * to NOT_FOUND_OR_FORBIDDEN (unlike the generation-cancel card's 400). The
 * real SQL round-trip is carried by DB tests 32/33/34/35/36.
 */
class MemoryServiceTest {

    private static final Instant NOW = Instant.parse("2026-08-12T12:00:00Z");
    private static final String GET_SQL =
            "SELECT out_id, out_relationship_id, out_scope, out_summary, out_status, "
                    + "out_conversation_id, out_created_at FROM vc.get_memory(?, ?)";
    private static final String LIST_SQL =
            "SELECT out_id, out_scope, out_summary, out_status, out_conversation_id, "
                    + "out_deleted_at, out_created_at FROM vc.list_memory(?, ?, ?)";
    private static final String CREATE_SQL =
            "SELECT vc.create_memory_candidate(?, ?, ?, ?, ?, ?)";
    private static final String UPDATE_SQL = "SELECT vc.update_memory(?, ?, ?)";
    private static final String DELETE_SQL = "SELECT vc.delete_memory(?, ?)";
    private static final String CONFIRM_SQL = "SELECT vc.confirm_memory_candidate(?, ?)";
    private static final String REJECT_SQL = "SELECT vc.reject_memory_candidate(?, ?)";
    private static final String EVIDENCE_SQL =
            "SELECT out_id, out_source_ref, out_created_at FROM vc.list_memory_evidence(?, ?)";

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final RelationshipService relationshipService = mock(RelationshipService.class);
    private final MemoryService service = new MemoryService(jdbc, relationshipService);

    private static MemoryRecord record(long id, String status) {
        return new MemoryRecord(id, 7L, "SESSION", "summary-" + id, status, 100L, null, NOW);
    }

    private static RelationshipRecord relationship() {
        return new RelationshipRecord(7L, "gentle-listener", true, NOW);
    }

    // ------------------------------------------------------------------
    // create
    // ------------------------------------------------------------------

    @Test
    void createCallsTheSdAndReturnsThePendingCandidate() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));
        when(jdbc.queryForObject(
                eq(CREATE_SQL), eq(Long.class), any(PreparedStatementSetter.class)))
                .thenReturn(42L);
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(42L)))
                .thenReturn(List.of(record(42L, "PENDING_CONFIRMATION")));

        Optional<MemoryRecord> result = service.create(1L, 7L, "SESSION", "likes hiking",
                100L, List.of("ref-1"));

        assertTrue(result.isPresent());
        assertEquals("PENDING_CONFIRMATION", result.get().status());
        verify(jdbc).queryForObject(
                eq(CREATE_SQL), eq(Long.class), any(PreparedStatementSetter.class));
    }

    @Test
    void createReturnsEmptyForForeignRelationshipWithoutCallingTheSd() {
        when(relationshipService.get(1L, 99L)).thenReturn(Optional.empty());

        Optional<MemoryRecord> result = service.create(1L, 99L, "SESSION", "s", 100L, null);

        assertTrue(result.isEmpty());
        verifyNoInteractions(jdbc);
    }

    @Test
    void createRejectsNonAlphaScope() {
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, 7L, "ACCOUNT_PRIVATE", "s", null, null));
    }

    @Test
    void createRejectsBlankSummary() {
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, 7L, "SESSION", "  ", 100L, null));
    }

    @Test
    void createRejectsSessionScopeWithoutConversation() {
        assertThrows(IllegalArgumentException.class,
                () -> service.create(1L, 7L, "SESSION", "s", null, null));
    }

    @Test
    void createTranslatesSdRaiseToEmpty() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));
        when(jdbc.queryForObject(
                eq(CREATE_SQL), eq(Long.class), any(PreparedStatementSetter.class)))
                .thenThrow(new DataAccessException("create_memory_candidate: relationship not found") {});

        assertTrue(service.create(1L, 7L, "SESSION", "s", 100L, null).isEmpty());
    }

    @Test
    void createRethrowsBadSqlGrammarForSchemaUnavailable() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));
        when(jdbc.queryForObject(
                eq(CREATE_SQL), eq(Long.class), any(PreparedStatementSetter.class)))
                .thenThrow(new BadSqlGrammarException("sql", "sql", null));

        assertThrows(BadSqlGrammarException.class,
                () -> service.create(1L, 7L, "SESSION", "s", 100L, null));
    }

    // ------------------------------------------------------------------
    // list
    // ------------------------------------------------------------------

    @Test
    void listReturnsRowsIncludingDeletedOnesWhenRequested() {
        MemoryRecord deleted = new MemoryRecord(
                5L, null, "RELATIONSHIP", "old", "ACCEPTED", null, NOW, NOW);
        when(jdbc.query(eq(LIST_SQL), any(RowMapper.class), eq(1L), eq(7L), eq(true)))
                .thenReturn(List.of(deleted));

        List<MemoryRecord> result = service.list(1L, 7L, true);

        assertEquals(1, result.size());
        assertNotNull(result.get(0).deletedAt());
        assertNull(result.get(0).relationshipId());
        verify(jdbc).query(eq(LIST_SQL), any(RowMapper.class), eq(1L), eq(7L), eq(true));
    }

    @Test
    void listReturnsEmptyForForeignRelationship() {
        when(jdbc.query(eq(LIST_SQL), any(RowMapper.class), eq(1L), eq(99L), eq(false)))
                .thenReturn(List.of());

        assertTrue(service.list(1L, 99L, false).isEmpty());
    }

    @Test
    void listRejectsNonPositiveArguments() {
        assertThrows(IllegalArgumentException.class, () -> service.list(0L, 7L, null));
        assertThrows(IllegalArgumentException.class, () -> service.list(1L, 0L, null));
    }

    // ------------------------------------------------------------------
    // get
    // ------------------------------------------------------------------

    @Test
    void getReturnsTheMemory() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(42L)))
                .thenReturn(List.of(record(42L, "ACCEPTED")));

        Optional<MemoryRecord> result = service.get(1L, 42L);

        assertTrue(result.isPresent());
        assertEquals(7L, result.get().relationshipId());
        assertEquals(100L, result.get().conversationId());
        assertNull(result.get().deletedAt());
    }

    @Test
    void getReturnsEmptyForForeignOrAbsentMemory() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        assertTrue(service.get(1L, 99L).isEmpty());
    }

    // ------------------------------------------------------------------
    // update
    // ------------------------------------------------------------------

    @Test
    void updateEditsTheSummaryAndKeepsStatus() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));
        when(jdbc.queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new")))
                .thenReturn(true);
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));

        Optional<MemoryRecord> result = service.update(1L, 55L, "new");

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"));
    }

    @Test
    void updateReturnsEmptyForForeignOrAbsentMemoryWithoutCallingTheSd() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        assertTrue(service.update(1L, 99L, "new").isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(99L), eq("new"));
    }

    @Test
    void updateReturnsEmptyForDeadEndStatus() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "REJECTED")));

        assertTrue(service.update(1L, 55L, "new").isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"));
    }

    @Test
    void updateTranslatesSdRaiseToEmpty() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")));
        when(jdbc.queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new")))
                .thenThrow(new DataAccessException("update_memory: memory 55 is deleted") {});

        assertTrue(service.update(1L, 55L, "new").isEmpty());
    }

    @Test
    void updateRejectsBlankSummary() {
        assertThrows(IllegalArgumentException.class, () -> service.update(1L, 55L, "  "));
    }

    // ------------------------------------------------------------------
    // delete
    // ------------------------------------------------------------------

    @Test
    void deleteSoftDeletesAndReturnsThePreDeleteSnapshot() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));
        when(jdbc.queryForObject(eq(DELETE_SQL), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.delete(1L, 55L);

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(eq(DELETE_SQL), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void deleteReturnsEmptyForForeignOrAlreadyDeletedMemoryWithoutCallingTheSd() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        assertTrue(service.delete(1L, 99L).isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(DELETE_SQL), eq(Boolean.class), eq(1L), eq(99L));
    }

    @Test
    void deleteRejectsUnexpectedSdReturn() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));
        when(jdbc.queryForObject(eq(DELETE_SQL), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(false);

        assertThrows(IllegalStateException.class, () -> service.delete(1L, 55L));
    }

    // ------------------------------------------------------------------
    // confirm / reject
    // ------------------------------------------------------------------

    @Test
    void confirmAcceptsAPendingCandidate() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")))
                .thenReturn(List.of(record(55L, "ACCEPTED")));
        when(jdbc.queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.confirm(1L, 55L);

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void confirmReturnsEmptyForNonPendingMemoryWithoutCallingTheSd() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));

        assertTrue(service.confirm(1L, 55L).isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void confirmTranslatesSdRaiseToEmpty() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")));
        when(jdbc.queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L)))
                .thenThrow(new DataAccessException("confirm_memory_candidate: memory 55 is deleted") {});

        assertTrue(service.confirm(1L, 55L).isEmpty());
    }

    @Test
    void rejectRejectsAPendingCandidate() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")))
                .thenReturn(List.of(record(55L, "REJECTED")));
        when(jdbc.queryForObject(eq(REJECT_SQL), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.reject(1L, 55L);

        assertTrue(result.isPresent());
        assertEquals("REJECTED", result.get().status());
        verify(jdbc).queryForObject(eq(REJECT_SQL), eq(Boolean.class), eq(1L), eq(55L));
    }

    @Test
    void rejectReturnsEmptyForNonPendingMemoryWithoutCallingTheSd() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "REJECTED")));

        assertTrue(service.reject(1L, 55L).isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(REJECT_SQL), eq(Boolean.class), eq(1L), eq(55L));
    }

    // ------------------------------------------------------------------
    // evidence
    // ------------------------------------------------------------------

    @Test
    void listEvidenceReturnsTheSourceChain() {
        when(jdbc.query(eq(EVIDENCE_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(new MemoryEvidenceRecord(11L, "ref-1", NOW)));

        List<MemoryEvidenceRecord> result = service.listEvidence(1L, 55L);

        assertEquals(1, result.size());
        assertEquals("ref-1", result.get(0).sourceRef());
        assertEquals(NOW, result.get(0).createdAt());
    }

    @Test
    void listEvidenceReturnsEmptyForForeignOrAbsentMemory() {
        when(jdbc.query(eq(EVIDENCE_SQL), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());

        assertTrue(service.listEvidence(1L, 99L).isEmpty());
    }

    @Test
    void listEvidenceRejectsNonPositiveArguments() {
        assertThrows(IllegalArgumentException.class, () -> service.listEvidence(0L, 55L));
        assertThrows(IllegalArgumentException.class, () -> service.listEvidence(1L, 0L));
    }
}
