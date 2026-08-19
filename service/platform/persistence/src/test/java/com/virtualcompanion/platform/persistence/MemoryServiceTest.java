package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
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
                    + "out_conversation_id, out_created_at, out_auto_saved, "
                    + "out_superseded_at, out_superseded_by_memory_id, "
                    + "out_event_at, out_event_status, out_event_expires_at "
                    + "FROM vc.get_memory(?, ?)";
    private static final String LIST_SQL =
            "SELECT out_id, out_scope, out_summary, out_status, out_conversation_id, "
                    + "out_deleted_at, out_created_at, out_auto_saved, "
                    + "out_superseded_at, out_superseded_by_memory_id, "
                    + "out_event_at, out_event_status, out_event_expires_at "
                    + "FROM vc.list_memory(?, ?, ?)";
    private static final String CREATE_SQL =
            "SELECT vc.create_memory_candidate(?, ?, ?, ?, ?, ?, ?, ?, ?)";
    private static final String UPDATE_SQL =
            "SELECT vc.update_memory(?, ?, ?, ?, ?, ?)";
    private static final String DELETE_SQL = "SELECT vc.delete_memory(?, ?)";
    private static final String CONFIRM_SQL =
            "SELECT vc.confirm_memory_candidate(?, ?, ?)";
    private static final String REJECT_SQL = "SELECT vc.reject_memory_candidate(?, ?)";
    private static final String EVIDENCE_SQL =
            "SELECT out_id, out_source_ref, out_created_at FROM vc.list_memory_evidence(?, ?)";
    private static final String RECALL_SQL =
            "SELECT out_id, out_scope, out_summary, out_conversation_id, out_created_at, "
                    + "out_event_at, out_event_status "
                    + "FROM vc.recall_memory(?, ?, ?, ?)";

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
        when(jdbc.query(
                eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class)))
                .thenReturn(List.of(42L));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(42L)))
                .thenReturn(List.of(record(42L, "PENDING_CONFIRMATION")));

        Optional<MemoryRecord> result = service.create(1L, 7L, "SESSION", "likes hiking",
                100L, List.of("ref-1"));

        assertTrue(result.isPresent());
        assertEquals("PENDING_CONFIRMATION", result.get().status());
        verify(jdbc).query(
                eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class));
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
        when(jdbc.query(
                eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class)))
                .thenThrow(new DataAccessException("create_memory_candidate: relationship not found") {});

        assertTrue(service.create(1L, 7L, "SESSION", "s", 100L, null).isEmpty());
    }

    @Test
    void createRethrowsBadSqlGrammarForSchemaUnavailable() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));
        when(jdbc.query(
                eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class)))
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
        when(jdbc.queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"), isNull(), isNull(), isNull()))
                .thenReturn(true);
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));

        Optional<MemoryRecord> result = service.update(1L, 55L, "new");

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"), isNull(), isNull(), isNull());
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
                eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"), isNull(), isNull(), isNull());
    }

    @Test
    void updateTranslatesSdRaiseToEmpty() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")));
        when(jdbc.queryForObject(eq(UPDATE_SQL), eq(Boolean.class), eq(1L), eq(55L), eq("new"), isNull(), isNull(), isNull()))
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
        when(jdbc.queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), isNull()))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.confirm(1L, 55L);

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), isNull());
    }

    @Test
    void confirmReturnsEmptyForNonPendingMemoryWithoutCallingTheSd() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "ACCEPTED")));

        assertTrue(service.confirm(1L, 55L).isEmpty());
        verify(jdbc, never()).queryForObject(
                eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), isNull());
    }

    @Test
    void confirmTranslatesSdRaiseToEmpty() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")));
        when(jdbc.queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), isNull()))
                .thenThrow(new DataAccessException("confirm_memory_candidate: memory 55 is deleted") {});

        assertTrue(service.confirm(1L, 55L).isEmpty());
    }

    // ------------------------------------------------------------------
    // R44 (V68): explicit supersede + event memories
    // ------------------------------------------------------------------

    @Test
    void confirmWithSupersedeReplacesTheCanonicalTargetInOneCall() {
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")))
                .thenReturn(List.of(record(55L, "ACCEPTED")));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(66L)))
                .thenReturn(List.of(new MemoryRecord(
                        66L, 7L, "SESSION", "old fact", "ACCEPTED", 100L, null, NOW)));
        when(jdbc.queryForObject(eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), eq(66L)))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.confirm(1L, 55L, 66L);

        assertTrue(result.isPresent());
        assertEquals("ACCEPTED", result.get().status());
        verify(jdbc).queryForObject(
                eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), eq(66L));
    }

    @Test
    void confirmWithSupersedeRejectsStaleTargetsAsClientErrors() {
        // Self, a REJECTED target, an already-superseded target, a foreign
        // target and a cross-relationship target are all 400s — the ids came
        // from the caller's own list, so stale UI state is not a hidden 404.
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(record(55L, "PENDING_CONFIRMATION")));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(77L)))
                .thenReturn(List.of(record(77L, "REJECTED")));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(88L)))
                .thenReturn(List.of(new MemoryRecord(88L, 7L, "SESSION", "s", "ACCEPTED",
                        100L, null, NOW, false, NOW, 55L, null, null, null)));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(99L)))
                .thenReturn(List.of());
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(11L)))
                .thenReturn(List.of(new MemoryRecord(
                        11L, 9L, "SESSION", "s", "ACCEPTED", 100L, null, NOW)));

        assertThrows(IllegalArgumentException.class, () -> service.confirm(1L, 55L, 55L));
        assertThrows(IllegalArgumentException.class, () -> service.confirm(1L, 55L, 77L));
        assertThrows(IllegalArgumentException.class, () -> service.confirm(1L, 55L, 88L));
        assertThrows(IllegalArgumentException.class, () -> service.confirm(1L, 55L, 99L));
        assertThrows(IllegalArgumentException.class, () -> service.confirm(1L, 55L, 11L));
        verify(jdbc, never()).queryForObject(
                eq(CONFIRM_SQL), eq(Boolean.class), eq(1L), eq(55L), any());
    }

    @Test
    void createWithEventValidatesTheTripleBeforeCallingTheSd() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));

        // Status without the event_at anchor, an uncatalogued status, and an
        // expiry not strictly after the start all fail fast (400).
        assertThrows(IllegalArgumentException.class, () -> service.create(
                1L, 7L, "RELATIONSHIP", "s", null, null, null, "PLANNED", null));
        assertThrows(IllegalArgumentException.class, () -> service.create(
                1L, 7L, "RELATIONSHIP", "s", null, null, NOW, "SOMEDAY", null));
        assertThrows(IllegalArgumentException.class, () -> service.create(
                1L, 7L, "RELATIONSHIP", "s", null, null, NOW, "PLANNED", NOW.minusSeconds(1)));
        verifyNoInteractions(jdbc);
    }

    @Test
    void createWithEventPassesTheTripleThrough() {
        when(relationshipService.get(1L, 7L)).thenReturn(Optional.of(relationship()));
        when(jdbc.query(eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class)))
                .thenReturn(List.of(42L));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(42L)))
                .thenReturn(List.of(record(42L, "PENDING_CONFIRMATION")));

        Optional<MemoryRecord> result = service.create(
                1L, 7L, "RELATIONSHIP", "周五汇报", null, null,
                NOW, "PLANNED", NOW.plusSeconds(3600));

        assertTrue(result.isPresent());
        verify(jdbc).query(
                eq(CREATE_SQL), any(PreparedStatementSetter.class), any(RowMapper.class));
    }

    @Test
    void updateWithEventEditValidatesEffectiveShapeAndPassesThrough() {
        MemoryRecord eventRecord = new MemoryRecord(55L, 7L, "SESSION", "汇报", "ACCEPTED",
                100L, null, NOW, false, null, null, NOW, "PLANNED", NOW.plusSeconds(3600));
        when(jdbc.query(eq(GET_SQL), any(RowMapper.class), eq(1L), eq(55L)))
                .thenReturn(List.of(eventRecord))
                .thenReturn(List.of(eventRecord));
        when(jdbc.queryForObject(eq(UPDATE_SQL), eq(Boolean.class),
                eq(1L), eq(55L), eq("汇报完成"), isNull(), eq("COMPLETED"), isNull()))
                .thenReturn(true);

        Optional<MemoryRecord> result = service.update(
                1L, 55L, "汇报完成", null, "COMPLETED", null);

        assertTrue(result.isPresent());
        verify(jdbc).queryForObject(eq(UPDATE_SQL), eq(Boolean.class),
                eq(1L), eq(55L), eq("汇报完成"), isNull(), eq("COMPLETED"), isNull());
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

    // ------------------------------------------------------------------
    // recall (MEM-LOOP context injection)
    // ------------------------------------------------------------------

    @Test
    void recallReturnsAcceptedRowsFromTheSd() {
        when(jdbc.query(eq(RECALL_SQL), any(RowMapper.class), eq(1L), eq(7L), eq(100L), eq(20)))
                .thenReturn(List.of(new MemoryRecord(
                        9L, null, "RELATIONSHIP", "has a cat", "ACCEPTED", null, null, NOW)));

        List<MemoryRecord> result = service.recall(1L, 7L, 100L, 20);

        assertEquals(1, result.size());
        assertEquals("RELATIONSHIP", result.get(0).scope());
        assertEquals("ACCEPTED", result.get(0).status());
        assertNull(result.get(0).deletedAt());
        verify(jdbc).query(eq(RECALL_SQL), any(RowMapper.class), eq(1L), eq(7L), eq(100L), eq(20));
    }

    @Test
    void recallPassesNullConversationThroughForRelationshipOnlyRecall() {
        when(jdbc.query(eq(RECALL_SQL), any(RowMapper.class), eq(1L), eq(7L), isNull(), eq(50)))
                .thenReturn(List.of());

        assertTrue(service.recall(1L, 7L, null, 50).isEmpty());
    }

    @Test
    void recallRejectsNonPositiveArguments() {
        assertThrows(IllegalArgumentException.class, () -> service.recall(0L, 7L, null, 20));
        assertThrows(IllegalArgumentException.class, () -> service.recall(1L, 0L, null, 20));
        assertThrows(IllegalArgumentException.class, () -> service.recall(1L, 7L, 0L, 20));
        assertThrows(IllegalArgumentException.class, () -> service.recall(1L, 7L, null, 0));
    }
}
