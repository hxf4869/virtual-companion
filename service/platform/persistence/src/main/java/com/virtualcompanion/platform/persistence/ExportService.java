package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Asynchronous data-export persistence over the V42 SD functions
 * (DATA-EXPORT / FR-DATA-002).
 *
 * <p>{@link #create} inserts a PENDING request and enqueues the
 * {@code DATA_EXPORT} work item in one SD call (one in-flight export per
 * account — the eager pre-check maps to 400, the SD guard re-checks as
 * defense in depth). The create call carries the one-time download token;
 * only its sha256 digest is persisted (V76) and the plaintext is returned
 * to the caller exactly once. The worker seals the payload with
 * {@link #complete} — encrypted at rest when a cipher is wired, so a table
 * reader holds neither the token nor the document; a download succeeds
 * exactly once via {@link #consume}
 * (the presented token is digested and consumed in the same statement), and
 * {@link #expireStale} is the scheduled sweep that purges expired READY
 * payloads (过期后自动删除).
 *
 * <p>Every user-scoped call re-verifies the trusted-owner context inside the
 * SD (V17 pattern); the runtime supplies the server-verified owner id.
 */
public class ExportService {

    /** V42 export status codes (mirrors the CHECK constraint). */
    public static final String STATUS_PENDING = "PENDING";
    public static final String STATUS_READY = "READY";
    public static final String STATUS_FAILED = "FAILED";
    public static final String STATUS_EXPIRED = "EXPIRED";

    /** One-time download result: the document payload plus its expiry. */
    public record ExportDownload(String payload, Instant expiresAt) {
        public ExportDownload {
            Objects.requireNonNull(payload, "payload must not be null");
            Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        }
    }

    private final JdbcTemplate jdbc;
    private final RestFieldCipher cipher;

    public ExportService(JdbcTemplate jdbc) {
        this(jdbc, null);
    }

    /**
     * CRYPTO-REST (§17.4): when a cipher is wired, the sealed export document
     * encrypts at rest ({@code enc2:…}) on complete and decrypts on the
     * one-time consume — the database never sees the export body in
     * plaintext. The null cipher keeps unit tests on raw passthrough.
     */
    public ExportService(JdbcTemplate jdbc, RestFieldCipher cipher) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
        this.cipher = cipher;
    }

    /**
     * Create a PENDING export request (and its DATA_EXPORT work item). The
     * one-time download token is passed through to the SD call, which stores
     * only its sha256 digest (V76) — the plaintext never persists.
     */
    public long create(long ownerUserId, String token) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
        // Eager one-in-flight check so the normal case maps to 400 (the SD
        // re-checks inside the same call as defense in depth).
        Integer inFlight = jdbc.queryForObject(
                "SELECT vc.count_inflight_exports(?)", Integer.class, ownerUserId);
        if (inFlight != null && inFlight > 0) {
            throw new IllegalArgumentException("an export is already in flight");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.create_export_request(?, ?)", Long.class, ownerUserId, token);
        if (id == null || id <= 0) {
            throw new IllegalStateException("create_export_request returned no id");
        }
        return id;
    }

    /** Status view for the owner (never the payload). */
    public Optional<ExportRecord> get(long ownerUserId, long exportId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        return jdbc.query(
                        "SELECT out_id, out_status, out_requested_at, out_completed_at, "
                                + "out_expires_at, out_error_message "
                                + "FROM vc.get_export_request(?, ?)",
                        rowMapper(),
                        ownerUserId,
                        exportId)
                .stream()
                .findFirst();
    }

    /** Seal a PENDING export as READY (worker). No token parameter:
     * possession originates at create time (V76); only payload and expiry
     * are sealed. */
    public boolean complete(
            long ownerUserId, long exportId, String payload, Instant expiresAt) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        Objects.requireNonNull(payload, "payload must not be null");
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        String storedPayload = cipher == null ? payload : cipher.encrypt(payload);
        Integer rows = jdbc.queryForObject(
                "SELECT vc.complete_export(?, ?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                storedPayload,
                Timestamp.from(expiresAt));
        return rows != null && rows == 1;
    }

    /** Terminalize a PENDING export as FAILED (worker). */
    public boolean fail(long ownerUserId, long exportId, String error) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.fail_export(?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                error == null ? "export failed" : error);
        return rows != null && rows == 1;
    }

    /**
     * One-time download: returns the payload (and expiry) and consumes the
     * token atomically; empty for a consumed, expired, foreign or absent
     * export (existence undisclosed).
     */
    public Optional<ExportDownload> consume(long ownerUserId, long exportId, String token) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
        return jdbc.query(
                        "SELECT out_payload, out_expires_at FROM vc.consume_export(?, ?, ?)",
                        (ResultSet rs, int rowNum) -> new ExportDownload(
                                decrypt(rs.getString("out_payload")),
                                rs.getTimestamp("out_expires_at").toInstant()),
                        ownerUserId,
                        exportId,
                        token)
                .stream()
                .findFirst();
    }

    /** Scheduled sweep: READY rows past expiry become EXPIRED, payload purged. */
    public int expireStale() {
        Integer rows = jdbc.queryForObject("SELECT vc.expire_stale_exports()", Integer.class);
        return rows == null ? 0 : rows;
    }

    /** CRYPTO-REST: legacy plaintext passes through; the null cipher is raw. */
    private String decrypt(String stored) {
        return cipher == null ? stored : cipher.decrypt(stored);
    }

    private static RowMapper<ExportRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new ExportRecord(
                rs.getLong("out_id"),
                rs.getString("out_status"),
                rs.getTimestamp("out_requested_at").toInstant(),
                rs.getTimestamp("out_completed_at") == null
                        ? null : rs.getTimestamp("out_completed_at").toInstant(),
                rs.getTimestamp("out_expires_at") == null
                        ? null : rs.getTimestamp("out_expires_at").toInstant(),
                rs.getString("out_error_message"));
    }
}
