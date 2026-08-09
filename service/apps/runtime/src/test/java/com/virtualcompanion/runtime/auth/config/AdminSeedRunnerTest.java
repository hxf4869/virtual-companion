package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.virtualcompanion.runtime.auth.application.AuthService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class AdminSeedRunnerTest {

    @Test
    void ensuredLogContainsNoAccountIdentityOrCredential(CapturedOutput output) {
        AuthService authService = mock(AuthService.class);
        String username = "seed-username-sentinel";
        String password = "seed-password-sentinel";
        String displayName = "seed-display-sentinel";
        long accountId = 908172635L;
        when(authService.seedAdmin(username, password, displayName)).thenReturn(accountId);

        new AdminSeedRunner(authService, username, password, displayName)
                .run(mock(ApplicationArguments.class));

        verify(authService).seedAdmin(username, password, displayName);
        assertThat(output).contains("admin seed ensured")
                .doesNotContain(Long.toString(accountId), username, password, displayName,
                        "token", "hash");
    }

    @Test
    void skippedLogContainsNoInjectedIdentity(CapturedOutput output) {
        AuthService authService = mock(AuthService.class);
        String username = "skip-username-sentinel";
        String password = "skip-password-sentinel";
        String displayName = "skip-display-sentinel";

        new AdminSeedRunner(authService, username, "   ", displayName)
                .run(mock(ApplicationArguments.class));

        verifyNoInteractions(authService);
        assertThat(output).contains("admin seed skipped (no injected credentials)")
                .doesNotContain("admin seed ensured", username, password, displayName,
                        "token-sentinel", "hash-sentinel", "account-id-sentinel");
    }
}
