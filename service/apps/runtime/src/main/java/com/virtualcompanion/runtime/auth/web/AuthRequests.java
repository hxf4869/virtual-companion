package com.virtualcompanion.runtime.auth.web;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request bodies for the identity endpoints. Passwords are never logged, never
 * placed in a URL and never returned by any response. Refresh and logout take
 * the refresh token from the HttpOnly {@code vc_refresh} cookie instead of a
 * request body (P1-09, Owner decision 2026-08-08).
 */
public final class AuthRequests {

    private AuthRequests() {
    }

    /** {@code POST /api/v1/auth/login}. */
    public record LoginRequest(
            @NotBlank @Size(max = 64) String username,
            @NotBlank @Size(max = 128) String password) {
    }

    /**
     * {@code POST /api/v1/auth/admin/accounts}. Role is optional and defaults
     * to USER in the service; only an ACTIVE ADMIN can call the endpoint.
     */
    public record CreateAccountRequest(
            @NotBlank @Size(max = 64) String username,
            @NotBlank @Size(min = 8, max = 128) String password,
            @Size(max = 16)
            @Pattern(regexp = "(?i:ADMIN|USER)") String role,
            @NotBlank @Size(max = 256) String displayName) {
    }

    /** ENT-SNAP (V40): {@code POST /api/v1/auth/admin/service-class}. */
    public record ServiceClassAssignRequest(
            @NotBlank String accountId,
            @NotBlank String serviceClass) {
    }
}
