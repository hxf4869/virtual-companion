package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link WorkItemCoordinator}: one poll round must recover
 * expired leases, enumerate pending owners through the V24 SECURITY DEFINER
 * functions, and run one owner-bound worker batch per owner under a freshly
 * issued fence; failures stay contained so the {@code @Scheduled} loop
 * survives (TASK-0173).
 */
class WorkItemCoordinatorTest {

    private final WorkItemWorker workItemWorker = mock(WorkItemWorker.class);
    private final JdbcTemplate authJdbcTemplate = mock(JdbcTemplate.class);
    private final List<String> issuedFences = new ArrayList<>();

    private WorkItemCoordinator coordinator;

    @BeforeEach
    void setUp() {
        coordinator = new WorkItemCoordinator(workItemWorker, authJdbcTemplate);
        issuedFences.clear();
        when(authJdbcTemplate.queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class))
                .thenReturn(0);
        doAnswer(invocation -> {
            issuedFences.add(invocation.getArgument(1));
            return 0;
        }).when(workItemWorker).processOwnerBatch(any(Long.class), any(String.class));
    }

    @SuppressWarnings("unchecked")
    private void stubPendingOwners(List<Long> owners) {
        when(authJdbcTemplate.query(
                        eq(WorkItemCoordinator.LIST_PENDING_OWNERS_SQL),
                        any(RowMapper.class)))
                .thenReturn(owners);
    }

    @Test
    void recoversThenEnumeratesAndProcessesEachOwnerWithFreshFence() {
        stubPendingOwners(List.of(1L, 2L));
        when(authJdbcTemplate.queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class))
                .thenReturn(2);

        coordinator.pollOwnerQueues();

        verify(authJdbcTemplate).queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class);
        verify(authJdbcTemplate).query(
                eq(WorkItemCoordinator.LIST_PENDING_OWNERS_SQL), any(RowMapper.class));
        verify(workItemWorker).processOwnerBatch(eq(1L), any(String.class));
        verify(workItemWorker).processOwnerBatch(eq(2L), any(String.class));
        // Each owner gets its own freshly issued fence; no fence is ever reused.
        assertEquals(2, issuedFences.size());
        assertNotEquals(issuedFences.get(0), issuedFences.get(1));
        assertTrue(issuedFences.stream().allMatch(f -> f != null && !f.isBlank()));
    }

    @Test
    void emptyPendingQueueOnlyRecovers() {
        stubPendingOwners(List.of());

        coordinator.pollOwnerQueues();

        verify(authJdbcTemplate).queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class);
        verify(workItemWorker, never()).processOwnerBatch(any(Long.class), any(String.class));
    }

    @Test
    void oneOwnerBatchFailureDoesNotBlockTheRemainingOwners() {
        stubPendingOwners(List.of(1L, 2L));
        doAnswer(invocation -> {
            if ((long) invocation.getArgument(0) == 1L) {
                throw new IllegalStateException("boom");
            }
            issuedFences.add(invocation.getArgument(1));
            return 0;
        }).when(workItemWorker).processOwnerBatch(any(Long.class), any(String.class));

        coordinator.pollOwnerQueues();

        // Owner 1's failure is contained; owner 2 is still processed.
        verify(workItemWorker).processOwnerBatch(eq(1L), any(String.class));
        verify(workItemWorker).processOwnerBatch(eq(2L), any(String.class));
        assertEquals(1, issuedFences.size());
    }

    @Test
    void pollWideRecoveryFailureIsContainedAndNextRunSurvives() {
        stubPendingOwners(List.of(7L));
        when(authJdbcTemplate.queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class))
                .thenThrow(new IllegalStateException("db down"));

        coordinator.pollOwnerQueues(); // must not throw
        coordinator.pollOwnerQueues(); // second run still executes

        verify(workItemWorker, never()).processOwnerBatch(any(Long.class), any(String.class));
        verify(authJdbcTemplate, times(2))
                .queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class);
    }

    @Test
    void nullRecoveryResultIsTreatedAsZero() {
        stubPendingOwners(List.of());
        when(authJdbcTemplate.queryForObject(WorkItemCoordinator.RECOVER_SQL, Integer.class))
                .thenReturn(null);

        coordinator.pollOwnerQueues();

        // No exception, no batch call; null row count is safe (mirrors
        // WorkItemClaimService null handling).
        verify(workItemWorker, never()).processOwnerBatch(any(Long.class), any(String.class));
    }
}
