package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * EMERGENCY-CONTACT (V65): SD-call glue — the upsert id, the invite row
 * mapping and input validation. The lifecycle itself (consent gate, token
 * hash, expiry demotion) is covered by the SQL test 120 against the real SD
 * functions.
 */
@ExtendWith(MockitoExtension.class)
class EmergencyContactServiceTest {

    @Mock
    private JdbcTemplate jdbc;

    private EmergencyContactService service;

    @BeforeEach
    void setUp() {
        service = new EmergencyContactService(jdbc);
    }

    @Test
    void upsertReturnsTheRowId() {
        when(jdbc.queryForObject(
                eq("SELECT vc.upsert_emergency_contact(?, ?, ?)"),
                eq(Long.class),
                eq(1L),
                eq("妈妈"),
                eq("cipher-1")))
                .thenReturn(41L);

        assertEquals(41L, service.upsert(1L, " 妈妈 ", "cipher-1"));
    }

    @Test
    void startVerificationMapsTheInviteRow() throws Exception {
        ResultSet rs = mock(ResultSet.class);
        when(rs.getLong("out_id")).thenReturn(41L);
        when(rs.getString("out_token")).thenReturn("a1b2c3d4");
        when(rs.getTimestamp("out_invited_at"))
                .thenReturn(Timestamp.from(Instant.parse("2026-08-19T08:00:00Z")));
        when(jdbc.query(
                eq("SELECT out_id, out_token, out_invited_at "
                        + "FROM vc.start_emergency_contact_verification(?)"),
                any(RowMapper.class),
                eq(1L)))
                .thenAnswer(invocation -> {
                    RowMapper<?> mapper = invocation.getArgument(1, RowMapper.class);
                    return List.of(mapper.mapRow(rs, 1));
                });

        EmergencyContactService.VerificationInvite invite = service.startVerification(1L);

        assertEquals(41L, invite.id());
        assertEquals("a1b2c3d4", invite.token());
        assertEquals(Instant.parse("2026-08-19T08:00:00Z"), invite.invitedAt());
    }

    @Test
    void rejectInvalidInputsBeforeSql() {
        assertThrows(IllegalArgumentException.class,
                () -> service.upsert(0L, "妈妈", "cipher"));
        assertThrows(IllegalArgumentException.class,
                () -> service.upsert(1L, " ", "cipher"));
        assertThrows(IllegalArgumentException.class,
                () -> service.upsert(1L, "妈妈", " "));
        assertThrows(IllegalArgumentException.class,
                () -> service.confirmVerification(1L, " ", "m", "v"));
        assertThrows(IllegalArgumentException.class,
                () -> service.revoke(-1L));
    }
}
