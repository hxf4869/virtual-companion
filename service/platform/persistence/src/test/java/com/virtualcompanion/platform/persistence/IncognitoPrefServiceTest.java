package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class IncognitoPrefServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final IncognitoPrefService service = new IncognitoPrefService(jdbc);

    @Test
    void getMapsNullToFalse() {
        when(jdbc.queryForObject(eq("SELECT vc.get_incognito_pref(?)"), eq(Boolean.class), eq(1L)))
                .thenReturn(null);
        assertFalse(service.get(1L));
    }

    @Test
    void updateWritesTheFlag() {
        when(jdbc.queryForObject(
                eq("SELECT vc.update_incognito_pref(?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(true)))
                .thenReturn(true);

        assertTrue(service.update(1L, true));
        verify(jdbc).queryForObject(
                eq("SELECT vc.update_incognito_pref(?, ?)"),
                eq(Boolean.class),
                eq(1L),
                eq(true));
    }

    @Test
    void ownerMustBePositive() {
        assertThrows(IllegalArgumentException.class, () -> service.get(0L));
        assertThrows(IllegalArgumentException.class, () -> service.update(-1L, false));
    }
}
