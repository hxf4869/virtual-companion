package com.virtualcompanion.modelruntime.routing;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;

/**
 * Quota-ledger fail-closed contract tests: provisioning, deterministic
 * reservation ids, insufficient-budget and unknown-owner fail-closed,
 * per-owner independence, and reservation-scoped release idempotency.
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
        QuotaReservation reservation = ledger.reserve("owner-1", 2L).orElseThrow();

        long remaining = ledger.release(reservation);

        assertEquals(5L, remaining);
        assertEquals(5L, ledger.remaining("owner-1"));
    }

    @Test
    void releaseCapsAtProvisionedCeiling() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 3L);
        QuotaReservation reservation = ledger.reserve("owner-1", 1L).orElseThrow();

        // Restore is capped at the provisioned ceiling; it can never inflate the balance above it.
        assertEquals(3L, ledger.release(reservation));
        // A repeated release of the same reservation cannot lift the balance either:
        // it is an idempotent no-op (restores nothing a second time).
        assertEquals(3L, ledger.release(reservation));
        assertEquals(3L, ledger.remaining("owner-1"));
    }

    @Test
    void releaseOnUnknownOwnerIsNoOpReturningZero() {
        QuotaLedger ledger = new QuotaLedger();
        // A reservation whose owner has never been provisioned cannot restore anything.
        QuotaReservation ghost = new QuotaReservation("qr-ghost", "ghost", 1L, 0L);

        long remaining = ledger.release(ghost);

        assertEquals(0L, remaining);
        assertEquals(0L, ledger.remaining("ghost"));
    }

    @Test
    void releaseZeroUnitsIsNoOp() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 4L);
        QuotaReservation reservation = ledger.reserve("owner-1", 0L).orElseThrow();

        assertEquals(4L, ledger.release(reservation));
    }

    @Test
    void reservationRejectsNegativeUnitsSoReleaseCannotUnderflow() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 1L);
        // The release path takes its units from QuotaReservation, whose compact
        // constructor forbids negative reservedUnits, so a forged negative reservation
        // can never reach the restore arithmetic.
        assertThrows(IllegalArgumentException.class,
                () -> new QuotaReservation("qr-x", "owner-1", -1L, 0L));
    }

    @Test
    void reserveThenReleaseThenReserveIsCyclicallyStable() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 2L);

        QuotaReservation first = ledger.reserve("owner-1", 2L).orElseThrow();
        ledger.release(first);
        assertTrue(ledger.reserve("owner-1", 2L).isPresent());
        assertEquals(0L, ledger.remaining("owner-1"));
    }

    @Test
    void releaseRepeatedForSameReservationIsIdempotent() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 100L);
        QuotaReservation r1 = ledger.reserve("owner-1", 60L).orElseThrow();

        // First release restores up to the ceiling.
        assertEquals(100L, ledger.release(r1));
        // Repeated releases of the SAME reservation restore nothing a second time.
        assertEquals(100L, ledger.release(r1));
        assertEquals(100L, ledger.release(r1));
        // The idempotently-released budget is still fully available to new reservations.
        QuotaReservation r2 = ledger.reserve("owner-1", 100L).orElseThrow();
        assertEquals(0L, ledger.remaining("owner-1"));
        assertEquals(100L, ledger.release(r2));
    }

    @Test
    void releaseIdempotencyPreventsOverReserve() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 100L);
        QuotaReservation r1 = ledger.reserve("owner-1", 60L).orElseThrow();  // rem 40
        QuotaReservation r2 = ledger.reserve("owner-1", 40L).orElseThrow();  // rem 0
        assertEquals(60L, ledger.release(r1));                                // rem 60
        QuotaReservation r3 = ledger.reserve("owner-1", 50L).orElseThrow();   // rem 10

        // A duplicate release of the already-released r1 must be a no-op (rem stays 10).
        // Without reservation-level idempotency this would refund 60 again (rem -> 70),
        // re-opening budget that is actually still consumed by r2/r3.
        assertEquals(10L, ledger.release(r1));

        // With idempotency rem=10, a 50-unit reservation is correctly rejected.
        // (Without idempotency rem would be 70 and this would succeed = over-reserve.)
        assertTrue(ledger.reserve("owner-1", 50L).isEmpty());

        // The still-active r2 can be released independently and restores its own units.
        assertEquals(50L, ledger.release(r2));  // rem min(100, 10 + 40) = 50
    }

    @Test
    void distinctReservationsReleaseIndependently() {
        QuotaLedger ledger = new QuotaLedger();
        ledger.provision("owner-1", 100L);
        QuotaReservation r1 = ledger.reserve("owner-1", 40L).orElseThrow();  // rem 60
        QuotaReservation r2 = ledger.reserve("owner-1", 40L).orElseThrow();  // rem 20

        assertEquals(60L, ledger.release(r1));    // rem 60
        assertEquals(100L, ledger.release(r2));   // rem min(100, 60 + 40) = 100

        // The already-released r1 is a no-op and does not disturb r2's restored units.
        assertEquals(100L, ledger.release(r1));
        assertEquals(100L, ledger.remaining("owner-1"));

        // Each reservation gets a distinct id within one ledger.
        assertNotEquals(r1.reservationId(), r2.reservationId());
        assertNotEquals(r1.reservationId(), ledger.reserve("owner-1", 10L).orElseThrow().reservationId());
    }
}
