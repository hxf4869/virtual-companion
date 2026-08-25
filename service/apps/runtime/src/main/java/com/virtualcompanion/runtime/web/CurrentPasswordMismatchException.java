package com.virtualcompanion.runtime.web;

/**
 * ADR-0006 §7.7 (DOGFOOD-08): the caller's freshly re-entered current
 * password did not verify against the stored identity (wrong password, or
 * the identity no longer matches the verified principal). Maps to the
 * non-disclosing 404 NOT_FOUND_OR_FORBIDDEN — "password wrong" is never
 * separable from "account gone", and no detail is carried.
 */
public class CurrentPasswordMismatchException extends RuntimeException {

    public CurrentPasswordMismatchException() {
        super("Invalid username or password");
    }
}
