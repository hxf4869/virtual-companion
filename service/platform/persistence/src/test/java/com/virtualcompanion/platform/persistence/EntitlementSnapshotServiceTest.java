package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Unit tests for {@link EntitlementSnapshotService} (ENT-SNAP / V40): eager
 * class normalization, the mint/assign/list SD call shapes, and the mappings.
 */
class EntitlementSnapshotServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final EntitlementSnapshotService service = new EntitlementSnapshotService(jdbc);

    @Test
    void normalizeServiceClassKeepsApprovedAndRejectsOthers() {
        assertEquals("ECONOMY", EntitlementSnapshotService.normalizeServiceClass("ECONOMY"));
        assertEquals("PREMIUM", EntitlementSnapshotService.normalizeServiceClass("PREMIUM"));
        assertThrows(IllegalArgumentException.class,
                () -> EntitlementSnapshotService.normalizeServiceClass(null));
        assertThrows(IllegalArgumentException.class,
                () -> EntitlementSnapshotService.normalizeServiceClass("PLATINUM"));
    }

    @Test
    void mintReturnsTheMintedSnapshot() {
        when(jdbc.query(
                eq("SELECT out_id, out_service_class, out_entitled_service_class, "
                        + "out_actual_service_class "
                        + "FROM vc.mint_entitlement_snapshot(?, ?, ?)"),
                any(RowMapper.class),
                eq(1L),
                eq(10L),
                eq(false)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_id")).thenReturn(9001L);
                    when(rs.getString("out_service_class")).thenReturn("PREMIUM");
                    when(rs.getString("out_entitled_service_class")).thenReturn("PREMIUM");
                    when(rs.getString("out_actual_service_class")).thenReturn("PREMIUM");
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        EntitlementSnapshotService.MintedEntitlementSnapshot minted = service.mint(1L, 10L);

        assertEquals(9001L, minted.id());
        assertEquals("PREMIUM", minted.serviceClass());
    }

    @Test
    void mintRejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class, () -> service.mint(0L, 10L));
        assertThrows(IllegalArgumentException.class, () -> service.mint(1L, 0L));
    }

    @Test
    void assignCallsTheSdFunctionWithTheNormalizedClass() {
        when(jdbc.queryForObject(
                eq("SELECT vc.assign_service_class(?, ?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(7L),
                eq("PREMIUM")))
                .thenReturn(true);

        assertTrue(service.assign(1L, 7L, "PREMIUM"));
    }

    @Test
    void listAssignmentsMapsTheRegistryRows() {
        when(jdbc.query(
                any(String.class),
                any(RowMapper.class),
                eq(1L)))
                .thenAnswer(invocation -> {
                    ResultSet rs = mock(ResultSet.class);
                    when(rs.getLong("out_account_id")).thenReturn(7L);
                    when(rs.getString("out_username")).thenReturn("alice");
                    when(rs.getString("out_service_class")).thenReturn("ECONOMY");
                    when(rs.getTimestamp("out_assigned_at")).thenReturn(null);
                    when(rs.getTimestamp("out_updated_at")).thenReturn(null);
                    var mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        List<EntitlementSnapshotService.ServiceClassAssignment> rows = service.listAssignments(1L);

        assertEquals(1, rows.size());
        assertEquals("alice", rows.get(0).username());
        assertEquals("ECONOMY", rows.get(0).serviceClass());
    }
}
