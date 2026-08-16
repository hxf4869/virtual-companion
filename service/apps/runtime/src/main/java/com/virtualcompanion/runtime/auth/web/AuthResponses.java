package com.virtualcompanion.runtime.auth.web;

/**
 * Response bodies for the identity endpoints. The raw refresh token is handed
 * to the controller exactly once (inside {@link IssuedSession}) so it can be
 * placed into the HttpOnly {@code vc_refresh} cookie; it is never persisted,
 * logged, echoed back on refresh or returned in any response body -- the
 * server stores only its sha256 hash.
 */
public final class AuthResponses {

    private AuthResponses() {
    }

    /** {@code POST /api/v1/auth/login} and {@code /refresh}. */
    public record AuthResponse(
            String accessToken,
            String tokenType,
            long expiresInSeconds,
            String accountId,
            String role) {
    }

    /**
     * What login/refresh produce: the JSON response body plus the plaintext
     * refresh token that must ONLY be written into the HttpOnly session cookie
     * by the controller (never into the body or script-readable storage).
     */
    public record IssuedSession(AuthResponse response, String refreshToken) {
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

    /** ADMIN-ACCTS: one registry entry (never the password hash). */
    public record AccountListItem(
            String accountId,
            String username,
            String role,
            String status,
            String displayName,
            String createdAt) {
    }

    /** ADMIN-ACCTS: {@code POST /api/v1/auth/admin/accounts/{id}/disable}. */
    public record DisableAccountResponse(String accountId, String status) {
    }

    /** ACCT-DELETE: {@code DELETE /api/v1/auth/account} (FR-AUTH-004). */
    public record AccountDeletedResponse(boolean ok) {
    }

    /** ADMIN-OPS: one identity_auth_event audit row (V36). */
    public record AuditEventResponse(
            String id,
            String eventType,
            String accountId,
            String username,
            String occurredAt) {
    }

    /** ADMIN-OPS: one day of settled usage/cost aggregates (V36). */
    public record UsageSummaryResponse(
            String day,
            long generations,
            long inputTokens,
            long outputTokens,
            java.math.BigDecimal cost) {
    }

    /** ENT-SNAP (V40): the applied simulated service-class assignment. */
    public record ServiceClassAssignResponse(String accountId, String serviceClass) {
    }

    /** ENT-SNAP (V40): one assignment registry row. */
    public record ServiceClassAssignmentItem(
            String accountId,
            String username,
            String serviceClass,
            String assignedAt,
            String updatedAt) {
    }
}
