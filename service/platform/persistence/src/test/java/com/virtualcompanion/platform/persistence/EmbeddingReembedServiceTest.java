package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class EmbeddingReembedServiceTest {

    @Test
    void ensureAndClaimUseOnlyRestrictedFunctions() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(
                eq(EmbeddingReembedService.ENSURE_SQL), any(RowMapper.class),
                eq("target"), eq("source"), eq("model"), eq("r1"), eq(64), eq(true)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getString("out_status")).thenReturn("RUNNING");
                    when(rs.getLong("out_last_memory_item_id")).thenReturn(7L);
                    RowMapper<EmbeddingReembedService.JobState> mapper = invocation.getArgument(1);
                    return List.of(mapper.mapRow(rs, 0));
                });
        EmbeddingReembedService service = new EmbeddingReembedService(jdbc);

        var state = service.ensure("target", "source", "model", "r1", 64, true);

        assertEquals("RUNNING", state.status());
        assertEquals(7L, state.lastMemoryItemId());
        assertFalse(EmbeddingReembedService.ENSURE_SQL.contains("INSERT"));
        assertFalse(EmbeddingReembedService.COMPLETE_SQL.contains("UPDATE"));
    }

    @Test
    void successAndFailurePinFixedOutcomes() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(any(String.class), eq(Boolean.class),
                any(), any(), any(), any(), any())).thenReturn(true);
        EmbeddingReembedService service = new EmbeddingReembedService(jdbc);

        service.completeSuccess("target", 1L, 10L, "[0,0]");
        service.completeFailure("target", 1L, 11L);

        verify(jdbc).queryForObject(
                EmbeddingReembedService.COMPLETE_SQL, Boolean.class,
                "target", 1L, 10L, "SUCCEEDED", "[0,0]");
        verify(jdbc).queryForObject(
                EmbeddingReembedService.COMPLETE_SQL, Boolean.class,
                "target", 1L, 11L, "FAILED", null);
    }
}
