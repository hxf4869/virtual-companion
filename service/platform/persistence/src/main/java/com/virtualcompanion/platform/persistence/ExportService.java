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

    /** One-time download result: the document (inline payload and/or object
     * pointer, V109) plus its expiry. Exactly one of payload/objectKey is
     * set: inline mode carries the document, object mode carries the key. */
    public record ExportDownload(
            String payload, String objectKey, Long objectBytes, Instant expiresAt) {
        public ExportDownload {
            Objects.requireNonNull(expiresAt, "expiresAt must not be null");
            if (payload == null && objectKey == null) {
                throw new IllegalArgumentException(
                        "either payload or objectKey must be present");
            }
        }

        /** Inline-mode shortcut (V42 shape, objectKey absent). */
        public ExportDownload(String payload, Instant expiresAt) {
            this(payload, null, null, expiresAt);
        }
    }

    /** Expiry-sweep worklist entry (V109): an EXPIRED row whose bucket
     * object still needs deletion. */
    public record ExpiredExportObject(long ownerUserId, long exportId, String objectKey) {
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

    /** Seal a PENDING export as READY in OBJECT mode (V109): the document
     * lives in the private bucket under {@code objectKey}; the inline payload
     * column stays NULL. The worker uploads first and seals second, so a row
     * sealed here always has its object in place.
     */
    public boolean completeObject(
            long ownerUserId, long exportId, String objectKey, long objectBytes,
            Instant expiresAt) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        if (objectBytes < 0) {
            throw new IllegalArgumentException("objectBytes must not be negative");
        }
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        Integer rows = jdbc.queryForObject(
                "SELECT vc.complete_export(?, ?, NULL::text, ?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                Timestamp.from(expiresAt),
                objectKey,
                objectBytes);
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
     * One-time download: returns the document (inline payload and/or the
     * object pointer, V109) and expiry, consuming the token atomically; empty
     * for a consumed, expired, foreign or absent export (existence
     * undisclosed).
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
                        "SELECT out_payload, out_object_key, out_object_bytes, "
                                + "out_expires_at FROM vc.consume_export(?, ?, ?)",
                        (ResultSet rs, int rowNum) -> new ExportDownload(
                                decrypt(rs.getString("out_payload")),
                                rs.getString("out_object_key"),
                                rs.getObject("out_object_bytes") == null
                                        ? null : rs.getLong("out_object_bytes"),
                                rs.getTimestamp("out_expires_at").toInstant()),
                        ownerUserId,
                        exportId,
                        token)
                .stream()
                .findFirst();
    }

    /** Scheduled sweep: READY rows past expiry become EXPIRED, payload purged
     * (V109: the object pointer survives for the object-deletion pass). */
    public int expireStale() {
        Integer rows = jdbc.queryForObject("SELECT vc.expire_stale_exports()", Integer.class);
        return rows == null ? 0 : rows;
    }

    /**
     * V109 object-deletion worklist: EXPIRED rows that still carry an object
     * pointer. The caller deletes each bucket object and then confirms via
     * {@link #clearObject}; a row whose deletion failed stays listed and is
     * retried on the next sweep.
     */
    public java.util.List<ExpiredExportObject> listExpiredObjects() {
        return jdbc.query(
                "SELECT out_owner_user_id, out_id, out_object_key "
                        + "FROM vc.list_expired_export_objects()",
                (ResultSet rs, int rowNum) -> new ExpiredExportObject(
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_id"),
                        rs.getString("out_object_key")));
    }

    /**
     * V109: clear the object pointer after the bucket object was deleted.
     * CAS on the exact object key — a retry or a re-sealed row can never be
     * wiped by mistake. V114 additionally removes the owner's upload-intent
     * rows for the same key, so the SD may legitimately affect more than one
     * row. Returns true when at least the pointer was cleared.
     */
    public boolean clearObject(long ownerUserId, long exportId, String objectKey) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.clear_export_object(?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                objectKey);
        return rows != null && rows >= 1;
    }

    /**
     * V114 (DOGFOOD-STABILIZATION-05/06): record the planned bucket put in its
     * OWN committed owner transaction AFTER the document/envelope is built
     * and as close to the put as possible — a crash after the put leaves a
     * durable record the reconciliation sweep reclaims. Refuses under an
     * active account-deletion intent, for keys not bound to this
     * owner/export attempt, and when the sweeper already CLAIMED the attempt
     * (fencing).
     *
     * <p>06: {@code leaseSeconds} must be the bounded upload window — the
     * storage put's total call timeout plus the compensation margin — so the
     * zero-second default never masquerades as a live lease in production
     * (the sweeper's claim re-validates the live lease before winning).</p>
     *
     * @return the intent row id
     */
    public long recordUploadIntent(long ownerUserId, long exportId, String objectKey,
            int leaseSeconds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        if (leaseSeconds < 0 || leaseSeconds > 86400) {
            throw new IllegalArgumentException("leaseSeconds must be within 0..86400");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.record_export_upload_intent(?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                exportId,
                objectKey,
                leaseSeconds);
        if (id == null || id <= 0) {
            throw new IllegalStateException(
                    "record_export_upload_intent returned no id for owner=" + ownerUserId
                            + " export=" + exportId);
        }
        return id;
    }

    /**
     * V114/06: heartbeat for a still-active upload — extends an OPEN intent's
     * lease past the grace window. Returns 0 when the attempt was already
     * CLAIMED by the sweeper (the attempt is fenced out and must stop
     * sealing); callers must treat 0 as failure.
     */
    public int renewUploadLease(long ownerUserId, long exportId, String objectKey,
            int leaseSeconds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        if (leaseSeconds <= 0 || leaseSeconds > 86400) {
            throw new IllegalArgumentException("leaseSeconds must be within 1..86400");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.renew_export_upload_lease(?, ?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                objectKey,
                leaseSeconds);
        return rows == null ? 0 : rows;
    }

    /** One reclaimable upload intent of the V114 reconciliation worklist. */
    public record StaleUploadIntent(
            long intentId, long ownerUserId, long exportId, String objectKey) {
    }

    /**
     * V114/05: bounded CANDIDATE worklist of OPEN intents whose lease/grace
     * window expired, whose key still has no export pointer and whose owner
     * has no deletion intent. Listing grants nothing — every row must still
     * win {@link #claimUploadIntent} before its object may be touched.
     */
    public java.util.List<StaleUploadIntent> staleUploadIntents(int limit, int minAgeSeconds) {
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be positive");
        }
        if (minAgeSeconds < 0) {
            throw new IllegalArgumentException("minAgeSeconds must not be negative");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_export_id, out_object_key "
                        + "FROM vc.stale_export_upload_intents(?, ?)",
                (ResultSet rs, int rowNum) -> new StaleUploadIntent(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_export_id"),
                        rs.getString("out_object_key")),
                limit,
                minAgeSeconds);
    }

    /**
     * V114/05/06: THE atomic reclaim — a single-row conditional UPDATE that
     * re-validates the LIVE row: state, the live lease against the caller's
     * grace (a renew or re-record after the stale listing loses), the absence
     * of a pointer and the absence of a deletion intent, all inside the one
     * statement. Empty when any check fails; the caller MUST then skip the
     * object entirely.
     *
     * @return the claimed object key, empty when the claim was lost
     */
    public Optional<String> claimUploadIntent(long ownerUserId, long intentId,
            int graceSeconds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (intentId <= 0) {
            throw new IllegalArgumentException("intentId must be positive");
        }
        if (graceSeconds < 0) {
            throw new IllegalArgumentException("graceSeconds must not be negative");
        }
        return Optional.ofNullable(jdbc.queryForObject(
                "SELECT vc.claim_export_upload_intent(?, ?, ?)",
                String.class,
                ownerUserId,
                intentId,
                graceSeconds));
    }

    /**
     * V114/05: bounded re-sweep worklist of CLAIMED tombstones (late puts
     * after the first reclaim remain discoverable and deletable through the
     * retained row).
     */
    public java.util.List<StaleUploadIntent> claimedUploadIntents(int limit, int minAgeSeconds) {
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be positive");
        }
        if (minAgeSeconds < 0) {
            throw new IllegalArgumentException("minAgeSeconds must not be negative");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_export_id, out_object_key "
                        + "FROM vc.claimed_export_upload_intents(?, ?)",
                (ResultSet rs, int rowNum) -> new StaleUploadIntent(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_export_id"),
                        rs.getString("out_object_key")),
                limit,
                minAgeSeconds);
    }

    /**
     * V114/05: bookkeeping after a tombstone's idempotent object re-delete;
     * 0 rows means the row vanished (terminal cleanup or cascade won) and is
     * not a failure.
     */
    public int markUploadIntentSwept(long ownerUserId, long intentId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (intentId <= 0) {
            throw new IllegalArgumentException("intentId must be positive");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.mark_export_upload_intent_swept(?, ?)",
                Integer.class,
                ownerUserId,
                intentId);
        return rows == null ? 0 : rows;
    }

    /**
     * V114/06/07: retire a CLAIMED tombstone row after its final object delete
     * and no-pointer re-check. The single atomic DELETE re-verifies the
     * provably-safe conditions on the live row — the claim window past the
     * WHOLE upload lifecycle (floor 300s, default 900s: the lease heartbeat
     * keeps a live upload claimable only after lease + grace, and every
     * individual storage call is bounded by the client's per-call timeout —
     * the fenced prefix audit remains the backstop for a pathological
     * writer), the export terminal (no PENDING row) and no pointer on the
     * key. Returns 0 when any condition fails — the row stays for the next
     * re-sweep cadence.
     */
    public int retireUploadTombstone(long ownerUserId, long intentId, int minAgeSeconds) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (intentId <= 0) {
            throw new IllegalArgumentException("intentId must be positive");
        }
        if (minAgeSeconds < 0) {
            throw new IllegalArgumentException("minAgeSeconds must not be negative");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.retire_export_upload_tombstone(?, ?, ?)",
                Integer.class,
                ownerUserId,
                intentId,
                minAgeSeconds);
        return rows == null ? 0 : rows;
    }

    /**
     * V114/07: does any database record still reference this object key (an
     * export pointer or an upload-intent row)? The scheduler's prefix audit
     * uses this only as a candidate PRE-FILTER — the atomic deletion gate is
     * {@link #fenceOrphanReclaim}, which serializes against a concurrent
     * record on the key's single fence row.
     */
    public boolean objectHasRecord(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        Boolean has = jdbc.queryForObject(
                "SELECT vc.export_object_has_record(?)", Boolean.class, objectKey);
        return Boolean.TRUE.equals(has);
    }

    /**
     * V114/07/08 (defect D/A/B): the prefix audit's DURABLE reclaim fence.
     * Holding the key's RECLAIM fence means the audit exclusively owns
     * deleting the object: a worker's record of the same key loses on the
     * same unique row (it RAISES and the worker is fenced out before its
     * put), no matter how the two transactions interleave — the fence row IS
     * the atomic gate the double objectHasRecord read could never be.
     *
     * <p>08: the call re-verifies INSIDE the fence transaction that no
     * pointer/intent record exists — a record that committed between the
     * scheduler's pre-filter and this call makes the call release its
     * placeholder and return false (a READY/FAILED pointer can never
     * reference an audit-deleted object). A deleted owner's key is fenced
     * OWNERLESS (the cascade SET NULLs the fence's owner link instead of
     * destroying it), and an orphaned WRITER fence left behind by the
     * cascade is taken over — late objects of deleted accounts converge.</p>
     *
     * @return true when the fence was held (or re-held by the audit);
     *         false when a live WRITER holds the key or a record appeared —
     *         skip either way
     */
    public boolean fenceOrphanReclaim(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        Boolean held = jdbc.queryForObject(
                "SELECT vc.fence_export_orphan_reclaim(?)", Boolean.class, objectKey);
        return Boolean.TRUE.equals(held);
    }

    /**
     * V114/07 (defect D): release the audit's RECLAIM fence after its object
     * delete finished. Never touches a WRITER fence.
     */
    public int clearOrphanReclaim(String objectKey) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.clear_export_orphan_reclaim(?)", Integer.class, objectKey);
        return rows == null ? 0 : rows;
    }

    /** V114: maintenance row removal (RLS harness cleanups). */
    public int deleteUploadIntent(long ownerUserId, long intentId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (intentId <= 0) {
            throw new IllegalArgumentException("intentId must be positive");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.delete_export_upload_intent(?, ?)",
                Integer.class,
                ownerUserId,
                intentId);
        return rows == null ? 0 : rows;
    }

    /** CRYPTO-REST: legacy plaintext passes through; the null cipher is raw. */
    private String decrypt(String stored) {
        return cipher == null ? stored : cipher.decrypt(stored);
    }

    /**
     * V110 (DOGFOOD-STABILIZATION): terminalize a PENDING export as FAILED
     * while KEEPING the object pointer — the durable, retryable record for a
     * bucket object whose READY seal failed. Returns false when the row is
     * absent, foreign or no longer PENDING (the caller then falls back to
     * compensating the object away).
     */
    public boolean failWithObject(
            long ownerUserId, long exportId, String objectKey, long objectBytes, String error) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (exportId <= 0) {
            throw new IllegalArgumentException("exportId must be positive");
        }
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("objectKey must not be blank");
        }
        if (objectBytes < 0) {
            throw new IllegalArgumentException("objectBytes must not be negative");
        }
        Integer rows = jdbc.queryForObject(
                "SELECT vc.fail_export_with_object(?, ?, ?, ?, ?)",
                Integer.class,
                ownerUserId,
                exportId,
                objectKey,
                objectBytes,
                error == null ? "export failed" : error);
        return rows != null && rows == 1;
    }

    /** V110: FAILED rows still carrying an object pointer (sweep worklist). */
    public java.util.List<ExpiredExportObject> listFailedObjects() {
        return jdbc.query(
                "SELECT out_owner_user_id, out_id, out_object_key "
                        + "FROM vc.list_failed_export_objects()",
                (ResultSet rs, int rowNum) -> new ExpiredExportObject(
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_id"),
                        rs.getString("out_object_key")));
    }

    /**
     * V110: every pointer-carrying row of one owner (account-deletion cleanup
     * runs BEFORE the cascade would destroy the pointers).
     */
    public java.util.List<ExpiredExportObject> listOwnerObjects(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                "SELECT out_owner_user_id, out_id, out_object_key "
                        + "FROM vc.list_owner_export_objects(?)",
                (ResultSet rs, int rowNum) -> new ExpiredExportObject(
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_id"),
                        rs.getString("out_object_key")),
                ownerUserId);
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
