package com.virtualcompanion.runtime.auth.application;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class SharedSourceAdmissionTest {

    @Test
    @SuppressWarnings("unchecked")
    void storesOnlyDomainSeparatedHmacDigest() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.query(anyString(), any(RowMapper.class), any(), any(), any(), any()))
                .thenAnswer(invocation -> {
                    String digest = invocation.getArgument(2, String.class);
                    org.junit.jupiter.api.Assertions.assertTrue(
                            digest.matches("[0-9a-f]{64}"));
                    assertFalse(digest.contains("192.0.2.1"));
                    return List.of(new SharedSourceAdmission.Decision(true, 1));
                });
        SharedSourceAdmission admission = new SharedSourceAdmission(
                jdbc, "0123456789abcdef0123456789abcdef");

        admission.admit("LOGIN", "192.0.2.1", 30, 60);
    }

    @Test
    void rejectsMissingOrShortSecret() {
        assertThrows(IllegalArgumentException.class,
                () -> new SharedSourceAdmission(mock(JdbcTemplate.class), "short"));
    }
}
