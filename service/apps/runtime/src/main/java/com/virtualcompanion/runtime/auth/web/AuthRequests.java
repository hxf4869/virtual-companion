package com.virtualcompanion.runtime.auth.web;

/**
 * Request bodies for the identity endpoints. Passwords and refresh tokens are
 * never logged, never placed in a URL and never returned by any response.
 */
public final class AuthRequests {

    private AuthRequests() {
    }

    /** {@code POST /api/v1/auth/login}. */
    public record LoginRequest(String username, String password) {
    }

    /** {@code POST /api/v1/auth/refresh}. */
    public record RefreshTokenRequest(String refreshToken) {
    }

    /** {@code POST /api/v1/auth/logout}. */
    public record LogoutRequest(String refreshToken) {
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
