package com.virtualcompanion.runtime.auth.web;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.OpsCase;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.observability.AlertProperties;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class AuthControllerOpsCaseTest {

    private final OpsCase cases = mock(OpsCase.class);
    private final AuthController controller = new AuthController(
            mock(AuthService.class), mock(AuthAbuseGuard.class),
            mock(AlertProperties.class), cases);
    private final JwtTokenService.Principal privacy =
            new JwtTokenService.Principal(41L, "PRIVACY_OPERATOR", "privacy");

    @Test
    void updatesPublicNoteAndReturnsOnlyTheRedactedSnapshot() {
        when(cases.updateNote(41L, 3L, "PUBLIC", "用户可见说明")).thenReturn(true);
        when(cases.snapshot(41L, 3L)).thenReturn(snapshot());

        Map<String, Object> result = controller.updateOpsCaseNote(
                privacy, "3", Map.of("visibility", "PUBLIC", "note", "用户可见说明"));

        assertEquals("用户可见说明", result.get("publicNote"));
        assertFalse(result.containsKey("internalNote"));
        verify(cases).updateNote(41L, 3L, "PUBLIC", "用户可见说明");
    }

    @Test
    void internalReadIsExplicitAndInvalidNoteRequestIsRejected() {
        when(cases.readInternalNote(41L, 3L)).thenReturn("内部备注");
        assertEquals(Map.of("note", "内部备注"),
                controller.readOpsCaseInternalNote(privacy, "3"));

        AuthErrorException invalid = assertThrows(AuthErrorException.class,
                () -> controller.updateOpsCaseNote(
                        privacy, "3", Map.of("visibility", "UNKNOWN", "note", "x")));
        assertEquals(HttpStatus.BAD_REQUEST, invalid.status());
        assertEquals("INVALID_REQUEST", invalid.code());
    }

    private static OpsCase.Snapshot snapshot() {
        return new OpsCase.Snapshot(
                3L, "REPORT", 7L, 9L, "OPEN", "P2", null, 41L,
                "", "用户可见说明", Instant.parse("2026-08-24T00:00:00Z"));
    }
}
