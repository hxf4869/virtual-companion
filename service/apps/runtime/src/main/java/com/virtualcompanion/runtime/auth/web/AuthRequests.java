package com.virtualcompanion.runtime.auth.web;

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
    public record LoginRequest(String username, String password) {
    }

    /**
     * {@code POST /api/v1/auth/admin/accounts}. Role is optional and defaults
     * to USER in the service; only an ACTIVE ADMIN can call the endpoint.
     */
    public record CreateAccountRequest(
            String username,
            String password,
            String role,
            String displayName) {
    }
}
