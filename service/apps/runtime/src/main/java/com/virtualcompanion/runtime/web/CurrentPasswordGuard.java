package com.virtualcompanion.runtime.web;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import java.util.Optional;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * ADR-0006 §7.7 (DOGFOOD-08): synchronous current-password verification for
 * high-risk self-service operations OUTSIDE the auth module (export creation,
 * consent withdrawal). The check is bound to the verified principal's account
 * id + username (the stored identity must carry both and stay ACTIVE), so it
 * is inherently per-request — no time window, no cross-session reuse, and the
 * V92 15-minute admin reauth window is deliberately NOT used. A missing
 * account still runs the dummy BCrypt compare so the unknown-account path
 * costs the same as a real one. Wrong password, missing account and status
 * mismatch are indistinguishable ({@link CurrentPasswordMismatchException} —
 * one 404 NOT_FOUND_OR_FORBIDDEN surface). A blank or oversized password is
 * an {@link IllegalArgumentException} (400 INVALID_REQUEST) before any lookup.
 *
 * <p>Lives in the shared web module (same place as
 * {@link ResourceNotFoundException}) because Spring Modulith forbids the
 * export/consent slices from depending on the auth module (auth already
 * depends on export for the expiry-scheduler wiring — the reverse edge would
 * be a cycle). The auth module keeps its own equivalent check inside
 * {@code AuthService} (changePassword / reauth / deleteAccount).
 */
public class CurrentPasswordGuard {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final int MAX_PASSWORD_LENGTH = 128;
    private static final int MAX_PASSWORD_UTF8_BYTES = 128;

    private final IdentityAccountRepository accounts;
    private final PasswordEncoder passwordEncoder;
    /** A valid BCrypt hash so the unknown-account path runs a real (equally
     * expensive) compare instead of short-circuiting. */
    private final String dummyHash;

    public CurrentPasswordGuard(
            IdentityAccountRepository accounts, PasswordEncoder passwordEncoder) {
        this.accounts = accounts;
        this.passwordEncoder = passwordEncoder;
        this.dummyHash = passwordEncoder.encode("virtual-companion-timing-equalization");
    }

    /**
     * Verify that {@code rawPassword} is the CURRENT password of the ACTIVE
     * account identified by the verified principal ({@code accountId} +
     * {@code username}). Fail-closed on every mismatch.
     */
    public void assertCurrentPassword(long accountId, String username, String rawPassword) {
        if (accountId <= 0 || username == null || username.isBlank()) {
            throw new IllegalArgumentException("A verified authentication context is required");
        }
        if (rawPassword == null || rawPassword.isBlank()
                || rawPassword.length() > MAX_PASSWORD_LENGTH
                || !withinUtf8Bytes(rawPassword, MAX_PASSWORD_UTF8_BYTES)) {
            throw new IllegalArgumentException("The request is invalid");
        }
        Optional<AuthenticatedIdentity> identity = accounts.authenticate(username);
        // Timing equalization: an absent identity still runs a real BCrypt
        // compare against the dummy hash.
        String storedHash = identity.map(AuthenticatedIdentity::passwordHash).orElse(dummyHash);
        boolean passwordOk = passwordEncoder.matches(rawPassword, storedHash);
        if (identity.isEmpty()
                || identity.get().accountId() != accountId
                || !STATUS_ACTIVE.equals(identity.get().status())
                || !passwordOk) {
            throw new CurrentPasswordMismatchException();
        }
    }

    private static boolean withinUtf8Bytes(String value, int maxBytes) {
        return value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length <= maxBytes;
    }
}
