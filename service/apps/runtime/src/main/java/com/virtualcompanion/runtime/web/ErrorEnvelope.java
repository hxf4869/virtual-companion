package com.virtualcompanion.runtime.web;

/**
 * Uniform runtime API error response shape (TASK-0178).
 *
 * <p>Mirrors the OpenAPI {@code ErrorEnvelope} contract ({@code code} +
 * {@code message}, both required). The auth module keeps its own
 * {@code com.virtualcompanion.runtime.auth.web.ErrorEnvelope} for auth-flow
 * failures; the Spring Modulith application structure forbids the runtime
 * {@code web} module from depending on a non-exposed type inside the
 * {@code auth} module, so the runtime API carries this equivalent shape. The
 * wire format is identical ({@code {"code": ..., "message": ...}}), so the
 * OpenAPI contract is unchanged.
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
