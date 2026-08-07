package com.virtualcompanion.runtime.auth.web;

/**
 * Response bodies for the identity endpoints. The raw refresh token is
 * returned exactly once here (and only here); it is never persisted, logged or
 * echoed back on refresh -- the server stores only its sha256 hash.
 */
public final class AuthResponses {

    private AuthResponses() {
    }

    /** {@code POST /api/v1/auth/login} and {@code /refresh}. */
    public record AuthResponse(
            String accessToken,
            String refreshToken,
            String tokenType,
            long expiresInSeconds,
            String accountId,
            String role) {
    }

    /** {@code POST /api/v1/auth/logout}. Idempotent: always {@code true}. */
    public record LogoutResponse(boolean ok) {
    }

    /** {@code POST /api/v1/auth/admin/accounts}. */
    public record AccountResponse(
            String accountId,
            String username,
            String role,
            String status) {
    }
}
