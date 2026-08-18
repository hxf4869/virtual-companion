package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Persistence wrapper around V50 {@code vc.end_conversation}. The SQL
 * round-trip lives in {@code 105_end_conversation.sql}.
 */
class ConversationRepositoryTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final ConversationRepository repository = new ConversationRepository(jdbc);

    @Test
    void endCallsTheSdFunctionAndMapsTheRow() {
        when(jdbc.query(
                eq("SELECT out_ok, out_incognito_cleared FROM vc.end_conversation(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(55L)))
                .thenReturn(List.of(new ConversationRepository.ConversationEndResult(true, true)));

        Optional<ConversationRepository.ConversationEndResult> result = repository.end(1L, 55L);

        assertTrue(result.isPresent());
        assertTrue(result.get().ok());
        assertTrue(result.get().incognitoCleared());
        verify(jdbc).query(
                eq("SELECT out_ok, out_incognito_cleared FROM vc.end_conversation(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(55L));
    }

    @Test
    void endReturnsEmptyForForeignOrAbsentId() {
        when(jdbc.query(
                eq("SELECT out_ok, out_incognito_cleared FROM vc.end_conversation(?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(99L)))
                .thenReturn(List.of());

        assertTrue(repository.end(1L, 99L).isEmpty());
    }

    @Test
    void deleteCallsTheV32Function() {
        when(jdbc.queryForObject(
                eq("SELECT vc.delete_conversation(?, ?)"), eq(Boolean.class), eq(1L), eq(55L)))
                .thenReturn(true);

        assertTrue(repository.delete(1L, 55L));
        verify(jdbc).queryForObject(
                eq("SELECT vc.delete_conversation(?, ?)"), eq(Boolean.class), eq(1L), eq(55L));
    }
}
