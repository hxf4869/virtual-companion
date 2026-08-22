package com.virtualcompanion.runtime.admission;

/**
 * S0-04 server admission for creating a generation. Implementations must
 * fail closed on read errors; the frontend is not the security source.
 */
@FunctionalInterface
public interface GenerationAdmission {

    void assertAdmitted(long ownerUserId);
}
