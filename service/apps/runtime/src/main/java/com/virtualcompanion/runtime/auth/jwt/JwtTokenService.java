package com.virtualcompanion.runtime.auth.jwt;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import javax.crypto.SecretKey;

/**
 * HS256 self-issued Bearer access token service built on the mature jjwt
 * library (no self-written crypto primitive). The subject is the account id,
 * which IS the owner_user_id the runtime derives for RLS (user_id ==
 * owner_user_id, INV-TENANT-001); role and username ride as claims so the
 * security filter can authorize without a per-request database hit.
 *
 * <p>Verification fails closed: an invalid signature, expired token, wrong
 * issuer, tampered payload or unparsable subject returns {@code null} and the
 * caller treats it exactly like a missing credential (AUTHENTICATION_REQUIRED).
 */
public class JwtTokenService {

    private final SecretKey key;
    private final Duration accessTtl;
    private final String issuer;

    public JwtTokenService(String secret, Duration accessTtl, String issuer) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("JWT secret must be at least 256 bits");
        }
        if (accessTtl == null || accessTtl.isZero() || accessTtl.isNegative()) {
            throw new IllegalArgumentException("access TTL must be positive");
        }
        if (issuer == null || issuer.isBlank()) {
            throw new IllegalArgumentException("issuer is required");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTtl = accessTtl;
        this.issuer = issuer;
    }

    /** Issue a signed access token for an authenticated account. */
    public String issueAccessToken(long accountId, String role, String username) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(issuer)
                .subject(Long.toString(accountId))
                .claim("role", role)
                .claim("username", username)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTtl)))
                .signWith(key)
                .compact();
    }

    /** Access token lifetime (also returned as {@code expiresInSeconds}). */
    public Duration accessTtl() {
        return accessTtl;
    }

    /**
     * Verify signature, issuer and expiry. Returns the principal bound to the
     * token, or {@code null} on any failure (fail closed -- never throws).
     */
    public Principal verifyAccessToken(String token) {
        if (token == null || token.isBlank()) {
            return null;
        }
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .requireIssuer(issuer)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            long accountId = Long.parseLong(claims.getSubject());
            String role = claims.get("role", String.class);
            String username = claims.get("username", String.class);
            if (role == null || role.isBlank()) {
                return null;
            }
            return new Principal(accountId, role, username);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /**
     * The server-verified identity bound to an access token. {@code accountId}
     * is both the identity account id and the owner_user_id used for RLS.
     */
    public record Principal(long accountId, String role, String username) {

        public Principal {
            if (accountId <= 0) {
                throw new IllegalArgumentException("accountId must be positive");
            }
            if (role == null || role.isBlank()) {
                throw new IllegalArgumentException("role is required");
            }
        }
    }
}
