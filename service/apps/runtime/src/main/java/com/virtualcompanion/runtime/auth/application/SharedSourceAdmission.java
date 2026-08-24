package com.virtualcompanion.runtime.auth.application;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import java.util.Objects;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.jdbc.core.JdbcTemplate;

/** DB-shared login/refresh source limiter storing only HMAC digests. */
public final class SharedSourceAdmission {

    public record Decision(boolean admitted, int retryAfterSeconds) {}

    private final JdbcTemplate jdbc;
    private final byte[] secret;

    public SharedSourceAdmission(JdbcTemplate jdbc, String secret) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        if (secret == null || secret.isBlank()
                || secret.getBytes(StandardCharsets.UTF_8).length < 32) {
            throw new IllegalArgumentException("shared rate-limit secret must be at least 32 bytes");
        }
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
    }

    public Decision admit(String route, String source, int limit, int windowSeconds) {
        if (!("LOGIN".equals(route) || "REFRESH".equals(route))
                || limit <= 0 || windowSeconds <= 0) {
            throw new IllegalArgumentException("shared source admission request is invalid");
        }
        String digest = digest(route + "|" + (source == null ? "unknown" : source));
        return jdbc.query(
                "SELECT out_admitted, out_retry_after "
                        + "FROM vc.admit_shared_auth_source(?, ?, ?, ?)",
                (rs, rowNum) -> new Decision(
                        rs.getBoolean("out_admitted"),
                        rs.getInt("out_retry_after")),
                digest, route, limit, windowSeconds).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("admit_shared_auth_source returned no row"));
    }

    private String digest(String value) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception failure) {
            throw new IllegalStateException("shared source digest failed", failure);
        }
    }
}
