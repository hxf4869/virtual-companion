package com.virtualcompanion.runtime.admission;

/**
 * S0-04: a new generation was refused by the server admission gate.
 * History, memory and data-right endpoints stay available.
 */
public class AdmissionDeniedException extends RuntimeException {

    private final String reason;

    public AdmissionDeniedException(String reason) {
        super("new generative turns are closed: " + reason);
        this.reason = reason;
    }

    public String reason() {
        return reason;
    }
}
