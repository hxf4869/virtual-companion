package com.virtualcompanion.modelruntime.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Quota-ledger fail-closed contract tests: provisioning, deterministic
 * reservation ids, insufficient-budget and unknown-owner fail-closed, and
 * per-owner independence.
 */
class QuotaLedgerTest {

    @Test
    void provisionThenReserveDecrementsRemaining() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 5L);

        QuotaReservation reservation = ledger.reserve("owner-1", 2L).orElseThrow();

        assertEquals(2L, reservation.reservedUnits());
        assertEquals(3L, reservation.remainingUnits());
        assertEquals(3L, ledger.remaining("owner-1"));
    }

    @Test
    void reserveInsufficientReturnsEmptyAndLeavesBudgetUntouched() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 1L);

        Optional<QuotaReservation> result = ledger.reserve("owner-1", 2L);

        assertTrue(result.isEmpty());
        assertEquals(1L, ledger.remaining("owner-1"));
    }

    @Test
    void reserveUnknownOwnerReturnsEmpty() {
        QuotaLedger ledger = new QuotaLedger();

        assertTrue(ledger.reserve("ghost", 1L).isEmpty());
        assertEquals(0L, ledger.remaining("ghost"));
    }

    @Test
    void reserveExactBudgetThenExhausted() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 2L);

        assertTrue(ledger.reserve("owner-1", 2L).isPresent());
        assertTrue(ledger.reserve("owner-1", 1L).isEmpty());
        assertEquals(0L, ledger.remaining("owner-1"));
    }

    @Test
    void reservationIdIsDeterministicForTheSameEvent() {
        QuotaLedger a = new QuotaLedger();
        QuotaLedger b = new QuotaLedger();
        a.provision("owner-1", 10L);
        b.provision("owner-1", 10L);

        QuotaReservation ra = a.reserve("owner-1", 1L).orElseThrow();
        QuotaReservation rb = b.reserve("owner-1", 1L).orElseThrow();

        assertEquals(ra.reservationId(), rb.reservationId());
        assertEquals(ra, rb);
    }

    @Test
    void reserveZeroUnitsSucceedsWhenProvisioned() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 0L);

        QuotaReservation reservation = ledger.reserve("owner-1", 0L).orElseThrow();

        assertEquals(0L, reservation.reservedUnits());
        assertEquals(0L, reservation.remainingUnits());
    }

    @Test
    void reserveZeroUnitsFailsForUnknownOwner() {
        QuotaLedger ledger = new QuotaLedger();
        assertTrue(ledger.reserve("ghost", 0L).isEmpty());
    }

    @Test
    void distinctOwnersAreIndependent() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 3L);
        ledger.provision("owner-2", 3L);

        ledger.reserve("owner-1", 1L);

        assertEquals(2L, ledger.remaining("owner-1"));
        assertEquals(3L, ledger.remaining("owner-2"));
    }

    @Test
    void rejectsNegativeBudgetAndNegativeUnits() {
        QuotaLedger ledger = new QuotaLedger();
        assertThrows(IllegalArgumentException.class, () -> ledger.provision("owner-1", -1L));
        ledger.provision("owner-1", 1L);
        assertThrows(IllegalArgumentException.class, () -> ledger.reserve("owner-1", -1L));
    }

    @Test
    void releaseRestoresReservedBudget() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 5L);
        ledger.reserve("owner-1", 2L).orElseThrow();

        long remaining = ledger.release("owner-1", 2L);

        assertEquals(5L, remaining);
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void releaseOnUnknownOwnerIsNoOpReturningZero() {
        QuotaLedger ledger = new QuotaLedger();

        long remaining = ledger.release("ghost", 1L);

        assertEquals(0L, remaining);
        assertEquals(0L, ledger.remaining("ghost"));
    }

    @Test
    void releaseZeroUnitsIsNoOp() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 4L);

        assertEquals(4L, ledger.release("owner-1", 0L));
    }

    @Test
    void releaseRejectsNegativeUnits() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 1L);
        assertThrows(IllegalArgumentException.class, () -> ledger.release("owner-1", -1L));
    }

    @Test
    void reserveThenReleaseThenReserveIsCyclicallyStable() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 2L);

        assertTrue(ledger.reserve("owner-1", 2L).isPresent());
        ledger.release("owner-1", 2L);
        assertTrue(ledger.reserve("owner-1", 2L).isPresent());
        assertEquals(0L, ledger.remaining("owner-1"));
    }
}
