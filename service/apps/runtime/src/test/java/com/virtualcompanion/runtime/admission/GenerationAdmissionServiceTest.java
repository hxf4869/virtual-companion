package com.virtualcompanion.runtime.admission;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * S0-04: the wired admission service fail-closes when a reader throws, and
 * refuses a disabled account through the shipped policy.
 */
class GenerationAdmissionServiceTest {

    @Test
    void readerFailureIsFailClosed() {
        IdentityAccountRepository accounts = mock(IdentityAccountRepository.class);
        when(accounts.statusOf(7L)).thenThrow(new IllegalStateException("db down"));
        GenerationAdmissionService service = new GenerationAdmissionService(
                accounts,
                mock(AgeVerificationService.class),
                mock(ConsentService.class),
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                false,
                false,
                List.of());

        AdmissionDeniedException ex = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));
        assertEquals(GenerationAdmissionPolicy.ADMISSION_READ_FAILED, ex.reason());
    }

    @Test
    void disabledAccountIsRefused() {
        IdentityAccountRepository accounts = mock(IdentityAccountRepository.class);
        when(accounts.statusOf(7L)).thenReturn("DISABLED");
        AgeVerificationService ages = mock(AgeVerificationService.class);
        when(ages.get(7L)).thenReturn(java.util.Optional.empty());
        ConsentService consents = mock(ConsentService.class);
        when(consents.list(7L)).thenReturn(List.of());

        GenerationAdmissionService service = new GenerationAdmissionService(
                accounts,
                ages,
                consents,
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                false,
                false,
                List.of());

        AdmissionDeniedException ex = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));
        assertEquals(GenerationAdmissionPolicy.ACCOUNT_DISABLED, ex.reason());
    }
}
