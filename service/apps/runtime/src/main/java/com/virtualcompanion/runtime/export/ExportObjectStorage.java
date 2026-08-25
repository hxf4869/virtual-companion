package com.virtualcompanion.runtime.export;

/**
 * DOGFOOD-02 (ADR-0006 §7.3): the object-storage port for data exports.
 *
 * <p>The local OrbStack MinIO is the only intended implementation target
 * (private bucket, authenticated application-side access — no cloud object
 * storage). Implementations must be fail-closed: construction verifies the
 * bucket exists and refuses to serve otherwise; a missing or misbehaving
 * backend surfaces as an exception, never as a silent no-op.
 *
 * <p>Every export object is addressed by a caller-chosen attempt-scoped key
 * of the form {@code exports/{ownerUserId}/{exportId}-{fenceDigest}.json}
 * (DOGFOOD-STABILIZATION-03, audit defect E — the digest is derived from the
 * claim fence, never its raw value). The bytes stored under that
 * key are an OPAQUE ENCRYPTED ENVELOPE (RestFieldCipher AES-GCM), never the
 * plaintext export JSON (DOGFOOD-STABILIZATION audit). The one-time download
 * path is the application endpoint reading server-side and deleting after a
 * successful delivery; the TTL/expiry semantics live in the database
 * (V42/V76/V109/V110 SD functions). There is deliberately NO presigned-URL
 * method: a TTL-scoped signed URL would be reusable within its lifetime and
 * is not an acceptable user-facing download entry.</p>
 */
public interface ExportObjectStorage {

    /**
     * Upload the encrypted envelope bytes under {@code key}. The content type
     * is the storage backend's opaque-binary type — the payload is NOT plain
     * JSON.
     */
    void put(String key, byte[] bytes);

    /**
     * DOGFOOD-STABILIZATION-07 (defect B): stream upload of a known length —
     * multipart uploads of multi-MiB envelopes go through this form so the
     * worker can hand the storage an ABORTABLE stream (a failed lease
     * heartbeat fails the read mid-flight and thereby the upload). The
     * length is exact; the stream is consumed once. The default buffers the
     * stream and delegates to {@link #put(String, byte[])}; production
     * backends override with their native streaming form.
     */
    default void put(String key, java.io.InputStream stream, long length) {
        try {
            put(key, stream.readAllBytes());
        } catch (java.io.IOException e) {
            throw new IllegalStateException("upload stream failed", e);
        }
    }

    /**
     * Fetch the object bytes. Throws when the object is absent — a missing
     * export object is a terminal failure, not an empty document.
     */
    byte[] get(String key);

    /**
     * Delete the object. Idempotent: deleting an absent object succeeds.
     * A backend failure throws so the caller can alert and retry (the
     * expiry/failed sweeps re-list rows whose object pointer is still set).
     */
    void delete(String key);

    /**
     * DOGFOOD-STABILIZATION-03 (audit defect E): list the object keys under
     * one prefix. Used by the export handler's post-seal sweep to remove
     * attempt objects a crashed earlier claimant left behind (keys are
     * per-attempt: {@code exports/{owner}/{export}-{fenceDigest}.json}).
     * Implementations must consume at most one bounded page — never the
     * backend's auto-paginated full listing.
     */
    java.util.List<String> list(String prefix);

    /**
     * DOGFOOD-STABILIZATION-06: one bounded page of keys after
     * {@code startAfter} (null = from the beginning), at most {@code limit}
     * keys (1..1000). Scanning ordinary objects counts towards the limit —
     * the page size IS the audit bound, so a full-bucket load into memory is
     * structurally impossible.
     *
     * @return the page and the cursor to pass as the next {@code startAfter};
     *         a null next cursor means the listing is exhausted and the next
     *         call starts over from the beginning
     */
    ObjectListing listPage(String prefix, String startAfter, int limit);

    /** One bounded listing page plus its forward cursor. */
    record ObjectListing(java.util.List<String> keys, String nextCursor) {
    }
}
