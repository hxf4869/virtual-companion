package com.virtualcompanion.modelruntime.routing;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import org.junit.jupiter.api.Test;

/**
 * GenerationRecovery contract tests covering the TASK-0032 acceptance matrix: per-scenario
 * quota disposition (AC1), stable generationId + unique terminal (AC2), ZERO_LLM creates no
 * provider_attempt (AC3), and the all-failure/ZERO_LLM response is the reviewed safety
 * constant rather than free text (AC4).
 */
class GenerationRecoveryTest {

    private static final String ZERO_LLM = DeterministicSafetyResponse.ZERO_LLM_FALLBACK;

    @Test
    void timeoutReleasesQuotaAndReachesReleasedOnTimeout() {
        QuotaLedger ledger = provision(5);
        QuotaReservation reservation = reserveOne(ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.recover(own(), RecoveryScenario.TIMEOUT, reservation);

        assertEquals(RecoveryTerminal.RELEASED_ON_TIMEOUT, outcome.terminal());
        assertEquals(QuotaDisposition.RELEASED, outcome.quotaDisposition());
        assertEquals(5L, ledger.remaining("owner-1"));
        assertTrue(outcome.response().isEmpty());
    }

    @Test
    void cancelledReleasesQuotaAndReachesReleasedOnCancel() {
        QuotaLedger ledger = provision(5);
        QuotaReservation reservation = reserveOne(ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.recover(own(), RecoveryScenario.CANCELLED, reservation);

        assertEquals(RecoveryTerminal.RELEASED_ON_CANCEL, outcome.terminal());
        assertEquals(QuotaDisposition.RELEASED, outcome.quotaDisposition());
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void noCapacityHasNoReleaseAndReachesNoCapacityTerminal() {
        QuotaLedger ledger = provision(5);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.recover(own(), RecoveryScenario.NO_CAPACITY, null);

        assertEquals(RecoveryTerminal.NO_CAPACITY_TERMINAL, outcome.terminal());
        assertEquals(QuotaDisposition.NONE, outcome.quotaDisposition());
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void noCapacityRejectsNonNullReservationFailClosed() {
        QuotaLedger ledger = provision(5);
        QuotaReservation reservation = reserveOne(ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        assertThrows(IllegalArgumentException.class,
                () -> recovery.recover(own(), RecoveryScenario.NO_CAPACITY, reservation));
    }

    @Test
    void allFailureReleasesAndEmitsReviewedSafetyResponse() {
        QuotaLedger ledger = provision(5);
        QuotaReservation reservation = reserveOne(ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.recover(own(), RecoveryScenario.ALL_FAILURE, reservation);

        assertEquals(RecoveryTerminal.ALL_FAILURE_BLOCKED, outcome.terminal());
        assertEquals(QuotaDisposition.RELEASED, outcome.quotaDisposition());
        assertEquals(5L, ledger.remaining("owner-1"));
        assertEquals(ZERO_LLM, outcome.response());
    }

    @Test
    void completeZeroLlmReleasesPriorReservationAndCreatesNoProviderAttempt() {
        QuotaLedger ledger = provision(5);
        QuotaReservation reservation = reserveOne(ledger);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.completeZeroLlm(own(), reservation);

        assertEquals(RecoveryTerminal.ZERO_LLM_COMPLETED, outcome.terminal());
        assertEquals(QuotaDisposition.RELEASED, outcome.quotaDisposition());
        assertEquals(ZERO_LLM, outcome.response());
        assertFalse(outcome.providerAttemptCreated());
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void completeZeroLlmWithoutPriorReservationIsNoneDisposition() {
        QuotaLedger ledger = provision(5);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        RecoveryOutcome outcome = recovery.completeZeroLlm(own(), null);

        assertEquals(RecoveryTerminal.ZERO_LLM_COMPLETED, outcome.terminal());
        assertEquals(QuotaDisposition.NONE, outcome.quotaDisposition());
        assertEquals(ZERO_LLM, outcome.response());
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void recoveryKeepsGenerationIdStableAcrossAllScenarios() {
        QuotaLedger ledger = provision(5);
        GenerationRecovery recovery = new GenerationRecovery(ledger);
        OwnershipTuple ownership = own();

        for (RecoveryScenario scenario : RecoveryScenario.values()) {
            RecoveryOutcome outcome = recovery.recover(ownership, scenario, null);
            assertEquals(ownership.generationId(), outcome.ownership().generationId(),
                    "generationId must be stable for " + scenario);
            assertEquals(ownership, outcome.ownership(), "ownership carried unchanged for " + scenario);
        }
        assertEquals(ownership, recovery.completeZeroLlm(ownership, null).ownership());
    }

    @Test
    void eachScenarioReachesExactlyOneTerminal() {
        QuotaLedger ledger = provision(9);
        GenerationRecovery recovery = new GenerationRecovery(ledger);

        assertEquals(RecoveryTerminal.RELEASED_ON_TIMEOUT,
                recovery.recover(own(), RecoveryScenario.TIMEOUT, null).terminal());
        assertEquals(RecoveryTerminal.RELEASED_ON_CANCEL,
                recovery.recover(own(), RecoveryScenario.CANCELLED, null).terminal());
        assertEquals(RecoveryTerminal.NO_CAPACITY_TERMINAL,
                recovery.recover(own(), RecoveryScenario.NO_CAPACITY, null).terminal());
        assertEquals(RecoveryTerminal.ALL_FAILURE_BLOCKED,
                recovery.recover(own(), RecoveryScenario.ALL_FAILURE, null).terminal());
        assertEquals(RecoveryTerminal.ZERO_LLM_COMPLETED,
                recovery.completeZeroLlm(own(), null).terminal());
    }

    @Test
    void recoveryNeverCreatesProviderAttempt() {
        QuotaLedger ledger = provision(9);
        GenerationRecovery recovery = new GenerationRecovery(ledger);
        for (RecoveryScenario scenario : RecoveryScenario.values()) {
            assertFalse(recovery.recover(own(), scenario, null).providerAttemptCreated(),
                    "no provider_attempt for " + scenario);
        }
        assertFalse(recovery.completeZeroLlm(own(), null).providerAttemptCreated());
    }

    @Test
    void recoveryOutcomeRejectsProviderAttemptCreatedTrue() {
        assertThrows(IllegalArgumentException.class, () -> new RecoveryOutcome(
                own(), RecoveryTerminal.ZERO_LLM_COMPLETED, QuotaDisposition.NONE, "", true));
    }

    @Test
    void nullArgumentsRejected() {
        GenerationRecovery recovery = new GenerationRecovery(provision(5));
        assertThrows(NullPointerException.class,
                () -> recovery.recover(null, RecoveryScenario.TIMEOUT, null));
        assertThrows(NullPointerException.class,
                () -> recovery.recover(own(), null, null));
        assertThrows(NullPointerException.class,
                () -> recovery.completeZeroLlm(null, null));
    }

    @Test
    void zeroLlmResponseEqualsSafetyConstantAndIsNotEmpty() {
        // AC4: the response is the reviewed safety constant, never free text and never blank.
        QuotaLedger ledger = provision(5);
        GenerationRecovery recovery = new GenerationRecovery(ledger);
        String zeroLlm = recovery.completeZeroLlm(own(), null).response();
        String allFailure = recovery.recover(own(), RecoveryScenario.ALL_FAILURE, null).response();

        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, zeroLlm);
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, allFailure);
        assertFalse(zeroLlm.isBlank());
        assertDoesNotThrow(() -> DeterministicSafetyResponse.fallbackFor(
                com.virtualcompanion.safety.SafetyVerdict.BLOCK));
    }

    private static OwnershipTuple own() {
        return new OwnershipTuple("owner-1", "rel-1", "conv-1", "gen-1");
    }

    private static QuotaLedger provision(long budget) {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", budget);
        return ledger;
    }

    private static QuotaReservation reserveOne(QuotaLedger ledger) {
        return ledger.reserve("owner-1", 1L).orElseThrow();
    }
}
