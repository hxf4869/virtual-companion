package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link GenerationCancelService} (TASK-0179). Verifies the
 * existence pre-check (NOT_FOUND_OR_FORBIDDEN contract), the V10
 * {@code vc.cancel_generation} call, and the DataAccessException translation —
 * a leaked SD RAISE would otherwise be misclassified by the global auth advice
 * as 401 AUTHENTICATION_REQUIRED. The real SQL round-trip is carried by DB
 * tests 30/41/45.
 */
class GenerationCancelServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GenerationRepository generationRepository = mock(GenerationRepository.class);
    private final GenerationCancelService service =
            new GenerationCancelService(jdbc, generationRepository);

    private static GenerationRecord record(long id, String status) {
        return new GenerationRecord(1L, id, 100L, "gen-" + id, status, null);
    }

    @Test
    void cancelCallsTheV10FunctionAndReturnsTheCancelledGeneration() {
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(record(55L, "IN_PROGRESS")))
                .thenReturn(Optional.of(record(55L, "CANCELLED")));
        when(jdbc.queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L)))
                .thenReturn("CANCELLED");

        Optional<GenerationRecord> result = service.cancel(1L, 55L);

        assertTrue(result.isPresent());
        assertEquals("CANCELLED", result.get().status());
        verify(jdbc).queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L));
    }

    @Test
    void cancelReturnsEmptyForForeignOrAbsentGenerationWithoutCallingTheSd() {
        when(generationRepository.find(1L, 99L)).thenReturn(Optional.empty());

        Optional<GenerationRecord> result = service.cancel(1L, 99L);

        assertTrue(result.isEmpty());
        verify(jdbc, never()).queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(99L));
    }

    @Test
    void cancelRejectsNonCancellableStateViaPreCheck() {
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(record(55L, "COMPLETED")));

        assertThrows(IllegalArgumentException.class, () -> service.cancel(1L, 55L));
        verify(jdbc, never()).queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L));
    }

    @Test
    void cancelTranslatesSdRaiseToIllegalArgumentException() {
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(record(55L, "IN_PROGRESS")));
        when(jdbc.queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L)))
                .thenThrow(new DataAccessException("cancel_generation: state not cancellable") {});

        assertThrows(IllegalArgumentException.class, () -> service.cancel(1L, 55L));
    }

    @Test
    void cancelRethrowsBadSqlGrammarForSchemaUnavailable() {
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(record(55L, "IN_PROGRESS")));
        when(jdbc.queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L)))
                .thenThrow(new BadSqlGrammarException("sql", "sql", null));

        assertThrows(BadSqlGrammarException.class, () -> service.cancel(1L, 55L));
    }

    @Test
    void cancelRejectsNonPositiveArguments() {
        assertThrows(IllegalArgumentException.class, () -> service.cancel(0L, 55L));
        assertThrows(IllegalArgumentException.class, () -> service.cancel(1L, 0L));
    }

    @Test
    void cancelRejectsUnexpectedSdReturnStatus() {
        when(generationRepository.find(1L, 55L))
                .thenReturn(Optional.of(record(55L, "IN_PROGRESS")));
        when(jdbc.queryForObject(
                eq("SELECT vc.cancel_generation(?, ?)"), eq(String.class), eq(1L), eq(55L)))
                .thenReturn("COMPLETED");

        assertThrows(IllegalStateException.class, () -> service.cancel(1L, 55L));
    }
}
