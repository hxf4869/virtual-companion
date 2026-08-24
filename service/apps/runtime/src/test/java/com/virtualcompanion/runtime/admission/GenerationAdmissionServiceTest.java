package com.virtualcompanion.runtime.admission;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.AgeVerificationRecord;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.ReleaseGate;
import com.virtualcompanion.platform.persistence.ServiceWindowService;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
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
                List.of(),
                mock(ReleaseGate.class));

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
                List.of(),
                mock(ReleaseGate.class));

        AdmissionDeniedException ex = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));
        assertEquals(GenerationAdmissionPolicy.ACCOUNT_DISABLED, ex.reason());
    }

    @Test
    void enforcedBetaRemainsBlockedWhenReleaseEvalHasNotPassed() {
        Instant now = Instant.parse("2026-08-23T12:00:00Z");
        IdentityAccountRepository accounts = mock(IdentityAccountRepository.class);
        when(accounts.statusOf(7L)).thenReturn("ACTIVE");
        AgeVerificationService ages = mock(AgeVerificationService.class);
        when(ages.get(7L)).thenReturn(Optional.of(
                new AgeVerificationRecord(1L, "ADULT_VERIFIED", "test-provider", now)));
        ConsentService consents = mock(ConsentService.class);
        when(consents.list(7L)).thenReturn(List.of(
                new ConsentRecord(1L, "SERVICE_TERMS", "v1", true, now, null)));
        ReleaseGate releaseGate = mock(ReleaseGate.class);
        when(releaseGate.allowsGenerationFor(7L)).thenReturn(false);

        GenerationAdmissionService service = new GenerationAdmissionService(
                accounts,
                ages,
                consents,
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                true,
                true,
                List.of("SERVICE_TERMS"),
                releaseGate);

        AdmissionDeniedException ex = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));

        assertEquals(GenerationAdmissionPolicy.RELEASE_EVAL_BLOCKED, ex.reason());
        verify(releaseGate).allowsGenerationFor(7L);
    }

    @Test
    void releaseGateRemainsEnforcedWhenAdultAndConsentChecksAreOff() {
        IdentityAccountRepository accounts = mock(IdentityAccountRepository.class);
        when(accounts.statusOf(7L)).thenReturn("ACTIVE");
        AgeVerificationService ages = mock(AgeVerificationService.class);
        when(ages.get(7L)).thenReturn(Optional.empty());
        ConsentService consents = mock(ConsentService.class);
        when(consents.list(7L)).thenReturn(List.of());
        ReleaseGate releaseGate = mock(ReleaseGate.class);
        when(releaseGate.allowsGenerationFor(7L)).thenReturn(false);

        GenerationAdmissionService service = new GenerationAdmissionService(
                accounts,
                ages,
                consents,
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                false,
                false,
                List.of(),
                releaseGate);

        AdmissionDeniedException ex = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));

        assertEquals(GenerationAdmissionPolicy.RELEASE_EVAL_BLOCKED, ex.reason());
        verify(releaseGate).allowsGenerationFor(7L);
    }

    @Test
    void enforcedBetaAllowsTheOwnerSelectedByTheReleaseGate() {
        Instant now = Instant.parse("2026-08-23T12:00:00Z");
        IdentityAccountRepository accounts = mock(IdentityAccountRepository.class);
        when(accounts.statusOf(7L)).thenReturn("ACTIVE");
        AgeVerificationService ages = mock(AgeVerificationService.class);
        when(ages.get(7L)).thenReturn(Optional.of(
                new AgeVerificationRecord(1L, "ADULT_VERIFIED", "test-provider", now)));
        ConsentService consents = mock(ConsentService.class);
        when(consents.list(7L)).thenReturn(List.of(
                new ConsentRecord(1L, "SERVICE_TERMS", "v1", true, now, null)));
        ReleaseGate releaseGate = mock(ReleaseGate.class);
        when(releaseGate.allowsGenerationFor(7L)).thenReturn(true);

        GenerationAdmissionService service = new GenerationAdmissionService(
                accounts,
                ages,
                consents,
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                true,
                true,
                List.of("SERVICE_TERMS"),
                releaseGate);

        assertDoesNotThrow(() -> service.assertAdmitted(7L));
        verify(releaseGate).allowsGenerationFor(7L);
    }

    @Test
    void durableDeletionIntentBlocksBeforeAnyOtherAdmissionReader() {
        AccountDeletionIntentService deletions = mock(AccountDeletionIntentService.class);
        when(deletions.activeCurrent(7L)).thenReturn(true);
        GenerationAdmissionService service = new GenerationAdmissionService(
                mock(IdentityAccountRepository.class),
                mock(AgeVerificationService.class),
                mock(ConsentService.class),
                new BetaServiceWindow(false, false, "10:00", "22:00", 10, "Asia/Shanghai"),
                mock(ServiceWindowService.class),
                mock(AlertNotifier.class),
                false, false, List.of(), mock(ReleaseGate.class), deletions);

        AdmissionDeniedException denied = assertThrows(
                AdmissionDeniedException.class, () -> service.assertAdmitted(7L));
        assertEquals("account-deletion-in-progress", denied.reason());
    }
}
