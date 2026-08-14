package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Unit tests for {@link WorkItemClaim} (value invariants, TASK-0194 explicit
 * fence) and the {@link WorkItemClaimService} per-item terminalization SQL
 * (V28). The claim/lease/fence runtime behavior (zero write on stale fence /
 * wall-clock expired lease / wrong token / missing context) is proven by the
 * SQL test suite under {@code infra/db/tests}; this pins the value-object
 * invariants and the exact per-item SQL binding.
 */
class WorkItemClaimServiceTest {

    @Test
    void claimRecordKeepsFieldsIncludingExplicitFence() {
        byte[] payload = {1, 2, 3};
        WorkItemClaim claim =
                new WorkItemClaim(7L, 101L, "GENERATION", 9001L, payload, "tok", "FENCE-A");
        assertEquals(7L, claim.ownerUserId());
        assertEquals(101L, claim.id());
        assertEquals("GENERATION", claim.kind());
        assertEquals(9001L, claim.refId());
        assertEquals("tok", claim.claimToken());
        assertEquals("FENCE-A", claim.claimFence());
    }

    @Test
    void rejectsBlankKindTokenOrFence() {
        assertThrows(IllegalArgumentException.class,
                () -> new WorkItemClaim(1L, 1L, "  ", 1L, null, "tok", "FENCE-A"));
        assertThrows(IllegalArgumentException.class,
                () -> new WorkItemClaim(1L, 1L, "GENERATION", 1L, null, "  ", "FENCE-A"));
        assertThrows(IllegalArgumentException.class,
                () -> new WorkItemClaim(1L, 1L, "GENERATION", 1L, null, "tok", "  "));
    }

    @Test
    void claimSelectsTheExplicitFenceColumn() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        WorkItemClaimService service = new WorkItemClaimService(jdbc);
        when(jdbc.query(eq(
                        "SELECT owner_user_id, id, kind, ref_id, payload, claim_token, claim_fence "
                                + "FROM vc.claim_work_items(?, ?, ?, ?)"),
                any(org.springframework.jdbc.core.RowMapper.class),
                eq(7L), eq("FENCE-A"), eq(30), eq(16)))
                .thenReturn(java.util.List.of());

        service.claim(7L, "FENCE-A");

        verify(jdbc).query(eq(
                        "SELECT owner_user_id, id, kind, ref_id, payload, claim_token, claim_fence "
                                + "FROM vc.claim_work_items(?, ?, ?, ?)"),
                any(org.springframework.jdbc.core.RowMapper.class),
                eq(7L), eq("FENCE-A"), eq(30), eq(16));
    }

    @Test
    void perItemTerminalizationBindsExplicitTriple() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        WorkItemClaimService service = new WorkItemClaimService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.complete_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A"))
                .thenReturn(1);
        when(jdbc.queryForObject(
                "SELECT vc.fail_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A"))
                .thenReturn(0);
        when(jdbc.queryForObject(
                "SELECT vc.renew_lease(?, ?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A", 60))
                .thenReturn(1);

        assertEquals(1, service.completePerItem(101L, "tok", "FENCE-A"));
        assertEquals(0, service.failPerItem(101L, "tok", "FENCE-A"));
        assertEquals(1, service.renewPerItem(101L, "tok", "FENCE-A", 60));

        verify(jdbc).queryForObject(
                "SELECT vc.complete_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A");
        verify(jdbc).queryForObject(
                "SELECT vc.fail_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A");
        verify(jdbc).queryForObject(
                "SELECT vc.renew_lease(?, ?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A", 60);
    }

    @Test
    void perItemNullResultIsTreatedAsZero() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        WorkItemClaimService service = new WorkItemClaimService(jdbc);
        when(jdbc.queryForObject(
                "SELECT vc.cancel_work_item(?, ?, ?)", Integer.class, 101L, "tok", "FENCE-A"))
                .thenReturn(null);

        assertEquals(0, service.cancelPerItem(101L, "tok", "FENCE-A"));
    }
}
