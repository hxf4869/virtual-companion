package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.platform.persistence.GenerationStateService;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link GenerationWorkItemHandler} (TASK-0174). Verifies the
 * degradation path: a claimed GENERATION item is promoted to IN_PROGRESS then
 * terminated as FAILED_FINAL (no live model wiring yet); non-GENERATION items
 * are skipped; a promotion failure propagates so the worker records the batch
 * as failed.
 */
class GenerationWorkItemHandlerTest {

    private final GenerationStateService stateService = mock(GenerationStateService.class);
    private final JdbcTemplate jdbcTemplate = mock(JdbcTemplate.class);

    @SuppressWarnings("unchecked")
    private final ObjectProvider<LiveModelInvoker> invokerProvider = mock(ObjectProvider.class);

    private GenerationWorkItemHandler handler;

    @BeforeEach
    void setUp() {
        handler = new GenerationWorkItemHandler(stateService, jdbcTemplate, invokerProvider);
        when(invokerProvider.getIfAvailable()).thenReturn(null);
        when(jdbcTemplate.queryForObject(
                        any(String.class), eq(String.class),
                        any(), any(), any(), any(), any()))
                .thenReturn("FAILED_FINAL");
    }

    private static WorkItemClaim generationClaim(long ownerId, long genId) {
        return new WorkItemClaim(ownerId, 1L, "GENERATION", genId, null, "token-1");
    }

    @Test
    void skipsNonGenerationItem() {
        WorkItemClaim claim = new WorkItemClaim(1L, 1L, "OTHER", 10L, null, "token-1");
        handler.handle(claim);
        verify(stateService, never()).promote(any(Long.class), any(Long.class), any(String.class));
        verify(jdbcTemplate, never()).queryForObject(
                any(String.class), eq(String.class), any(), any(), any(), any(), any());
    }

    @Test
    void degradesToFailedWhenProvidersDisabled() {
        WorkItemClaim claim = generationClaim(1L, 10L);
        handler.handle(claim);

        verify(stateService).promote(1L, 10L, GenerationStateService.IN_PROGRESS);
        // terminalize_generation(owner, gen, FAILED_FINAL, chat.failed, payload)
        verify(jdbcTemplate).queryForObject(
                any(String.class), eq(String.class),
                eq(1L), eq(10L), eq("FAILED_FINAL"), eq("chat.failed"), any());
    }

    @Test
    void degradesToFailedWhenInvokerPresentButIntegrationPending() {
        when(invokerProvider.getIfAvailable()).thenReturn(mock(LiveModelInvoker.class));
        WorkItemClaim claim = generationClaim(2L, 20L);

        handler.handle(claim);

        verify(stateService).promote(2L, 20L, GenerationStateService.IN_PROGRESS);
        verify(jdbcTemplate).queryForObject(
                any(String.class), eq(String.class),
                eq(2L), eq(20L), eq("FAILED_FINAL"), eq("chat.failed"), any());
    }

    @Test
    void promotionFailurePropagatesAndAttemptsTerminalize() {
        when(stateService.promote(any(Long.class), any(Long.class), any(String.class)))
                .thenThrow(new IllegalStateException("db down"));

        assertThrows(IllegalStateException.class,
                () -> handler.handle(generationClaim(3L, 30L)));

        // Best-effort terminalize is attempted even after the promotion failure.
        verify(jdbcTemplate).queryForObject(
                any(String.class), eq(String.class),
                eq(3L), eq(30L), eq("FAILED_FINAL"), eq("chat.failed"), any());
    }
}
