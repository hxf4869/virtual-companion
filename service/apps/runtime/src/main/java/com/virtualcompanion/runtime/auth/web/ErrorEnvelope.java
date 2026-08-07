package com.virtualcompanion.runtime.auth.web;

/**
 * Uniform error response shape (mirrors the OpenAPI {@code ErrorEnvelope}:
 * required {@code code} and {@code message}). NOT_FOUND_OR_FORBIDDEN never
 * discloses whether a resource exists; messages are stable and non-sensitive.
 */
public record ErrorEnvelope(String code, String message) {

    public ErrorEnvelope {
        if (code == null || code.isBlank()) {
            throw new IllegalArgumentException("code is required");
        }
        if (message == null) {
            throw new IllegalArgumentException("message is required");
        }
    }
}
