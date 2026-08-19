package com.virtualcompanion.runtime.web;

/**
 * EMERGENCY-CONTACT (§20.14): the capability is not enabled on this
 * deployment — the legal/safety/professional review that §20.14 requires
 * before enabling it has not been recorded. Every emergency-contact endpoint
 * fails closed with 403 {@code BETA_OPERATIONS_NOT_READY} (宁可不启用，也不
 * 能做「半自动外呼」); the rest of the consent page keeps working.
 */
public class EmergencyContactDisabledException extends RuntimeException {

    public EmergencyContactDisabledException() {
        super("the emergency contact capability is not enabled on this deployment");
    }
}
