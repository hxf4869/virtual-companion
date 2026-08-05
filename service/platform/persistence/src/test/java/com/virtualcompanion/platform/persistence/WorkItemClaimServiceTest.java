package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Pure unit test for the {@link WorkItemClaim} value object. The claim/lease/
 * fence runtime behavior (zero write on stale fence / expired lease / wrong
 * token / missing context) is proven by the SQL test suite under
 * {@code infra/db/tests}; this only pins the value-object invariants.
 */
class WorkItemClaimServiceTest {

    @Test
    void claimRecordKeepsFields() {
        byte[] payload = {1, 2, 3};
        WorkItemClaim claim = new WorkItemClaim(7L, 101L, "GENERATION", 9001L, payload, "tok");
        assertEquals(7L, claim.ownerUserId());
        assertEquals(101L, claim.id());
        assertEquals("GENERATION", claim.kind());
        assertEquals(9001L, claim.refId());
        assertEquals("tok", claim.claimToken());
    }

    @Test
    void rejectsBlankKindOrToken() {
        assertThrows(IllegalArgumentException.class,
                () -> new WorkItemClaim(1L, 1L, "  ", 1L, null, "tok"));
        assertThrows(IllegalArgumentException.class,
                () -> new WorkItemClaim(1L, 1L, "GENERATION", 1L, null, "  "));
    }
}
