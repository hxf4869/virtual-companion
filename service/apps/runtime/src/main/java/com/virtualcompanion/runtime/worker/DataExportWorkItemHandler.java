package com.virtualcompanion.runtime.worker;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.platform.persistence.ConversationListRecord;
import com.virtualcompanion.platform.persistence.ConversationListService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.MemoryRecord;
import com.virtualcompanion.platform.persistence.MemoryService;
import com.virtualcompanion.platform.persistence.MessageRepository;
import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.platform.persistence.ReminderRecord;
import com.virtualcompanion.platform.persistence.ReminderService;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Data-export work-item handler (DATA-EXPORT / FR-DATA-002).
 *
 * <p>Consumes {@code DATA_EXPORT} items enqueued by
 * {@code vc.create_export_request} (refId is the export request id). In one
 * owner-bound transaction it asserts the active claim (V28 token/fence),
 * aggregates the owner's data into the export document — conversations with
 * their full message history and per-message AI-content markers, memories
 * (including soft-deleted rows), reminders and the effective consent state —
 * and serializes it to JSON. Then it seals the export as READY with a
 * short-lived expiry via {@code vc.complete_export}; the per-item work-item
 * complete runs in the same transaction; a failure terminalizes the export
 * as FAILED (best-effort, own transaction) and is rethrown so the worker
 * applies its independent per-item fail.
 *
 * <p>Two sealing modes (DOGFOOD-02, ADR-0006 §7.3): with an
 * {@link ExportObjectStorage} wired (object mode) the serialized document is
 * uploaded to the private bucket under
 * {@code exports/{ownerUserId}/{exportId}.json} BEFORE the seal — as an
 * OPAQUE AES-GCM envelope (RestFieldCipher), never plaintext JSON — and
 * {@code vc.complete_export} records only the object pointer (V109). Without
 * storage (inline mode, the default) the document is sealed into the inline
 * payload column exactly as before; the expiry sweep
 * ({@code vc.expire_stale_exports}) purges it, which is the Alpha realization
 * of 过期后自动删除对象存储文件. Conversation pages are keyset-walked to
 * their end, so the document is complete rather than clamped to the first
 * page.
 *
 * <p>DOGFOOD-STABILIZATION audit — no pointer-less bucket orphans: once an
 * upload succeeded, a failing seal keeps a durable pointer by terminalizing
 * FAILED WITH the object pointer ({@code vc.fail_export_with_object}, V110);
 * only when that database write also fails does the handler compensate by
 * deleting the just-uploaded object, and only when BOTH fail does it alert
 * (P1 EXPORT_OBJECT_ORPHAN_RISK) — at that point the database is down for
 * every path including the failure terminalization. DOGFOOD-STABILIZATION-02
 * audit: the pointer write shares the seal transaction, so ANY failure after
 * a successful upload — {@code complete_export} moving 0 rows, the per-item
 * work-item complete returning 0 or throwing — rolls the pointer back and
 * enters the same preserve-or-compensate protocol; an upload that THREW
 * although the object may have landed (client timeout after the server-side
 * put) runs the ambiguous-upload compensation instead.</p>
 */
public class DataExportWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(DataExportWorkItemHandler.class);

    /** Work-item kind handled here; also the dispatcher's DATA_EXPORT key. */
    public static final String KIND_DATA_EXPORT = "DATA_EXPORT";

    /** Stable FAILED reason (no user content ever lands in error_message). */
    static final String FAULT_EXPORT_FAILED = "export-failed";

    /** P1 when an uploaded object could neither keep a pointer nor be deleted. */
    public static final String ALERT_ORPHAN_RISK = "EXPORT_OBJECT_ORPHAN_RISK";

    /** FR-DATA-002 包含 AI 生成内容标识 — plain-language notice in every document. */
    static final String AI_CONTENT_NOTICE =
            "本导出包含 AI 生成内容：role 为 assistant 的消息由 AI 模型生成，"
                    + "以 aiGenerated=true 标识，可能包含不准确信息。";

    /** Keyset page size when walking the owner's conversations to their end. */
    static final int CONVERSATION_PAGE = 100;

    /**
     * DOGFOOD-STABILIZATION-07 (defect B): the upload lease is kept alive by
     * a DURABLE heartbeat for the WHOLE multipart upload — a multi-MiB
     * envelope issues one HTTP call per 5 MiB part plus the complete call,
     * so the per-call timeout is NOT a bound on the upload's duration. The
     * record holds the lease for {@link #UPLOAD_LEASE_SECONDS} and the
     * heartbeat renews it every {@link #UPLOAD_HEARTBEAT_SECONDS} (lease =
     * 3 × interval, tolerating one transient renew failure); while the
     * heartbeat lives, the sweeper's live-lease re-validation can never
     * claim the attempt. A renew that fails (0 rows — the attempt was
     * claimed/fenced — or a database error) ABORTS the upload through the
     * abortable envelope stream and fails closed into the compensation
     * path: no READY seal, the intent row stays durable for the unified
     * reclaim protocol.
     */
    static final int UPLOAD_LEASE_SECONDS = 90;

    /** Heartbeat cadence: one third of the lease window. */
    static final int UPLOAD_HEARTBEAT_SECONDS = 30;

    /**
     * Object key layout for object mode (DOGFOOD-STABILIZATION-03, audit
     * defect E): {@code exports/{owner}/{export}-{fenceDigest}.json}. The
     * per-attempt segment is the first 16 hex chars of SHA-256 over the CLAIM
     * FENCE — never the fence itself and never the claim token, so no raw
     * claim secret is derivable from the key (the attempt intent already
     * persists only the digest of the same fence). Two claimants of the same
     * export (stale lease + takeover) therefore address DIFFERENT objects: a
     * stale claimant's compensation delete can never remove the object the
     * takeover claimant sealed READY, and the post-seal sweep below removes
     * any attempt object left behind by a crashed predecessor.
     */
    static String objectKey(long ownerUserId, long exportId, String claimFence) {
        java.util.Objects.requireNonNull(claimFence, "claimFence must not be null");
        if (claimFence.isBlank()) {
            throw new IllegalArgumentException("claimFence must not be blank");
        }
        String digest = sha256Hex(claimFence).substring(0, 16);
        return "exports/" + ownerUserId + "/" + exportId + "-" + digest + ".json";
    }

    private static String sha256Hex(String value) {
        try {
            java.security.MessageDigest digest =
                    java.security.MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(hash.length * 2);
            for (byte b : hash) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16));
                hex.append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private final GenerationFinalizeService finalizeService;
    private final ExportService exportService;
    private final RelationshipService relationshipService;
    private final ConversationListService conversationListService;
    private final MessageRepository messageRepository;
    private final MemoryService memoryService;
    private final ReminderService reminderService;
    private final ConsentService consentService;
    private final ObjectMapper objectMapper;
    private final Duration ttl;
    private final ExportObjectStorage objectStorage;
    /** AES-GCM envelope cipher for object mode (plain JSON never leaves the host). */
    private final com.virtualcompanion.platform.persistence.RestFieldCipher objectCipher;
    /** Optional orphan-risk alerter (null in unit tests). */
    private final com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier;
    /** Optional deletion-intent probe blocking new seals (null in unit tests). */
    private final com.virtualcompanion.platform.persistence.AccountDeletionIntentService
            deletionIntents;

    public DataExportWorkItemHandler(
            GenerationFinalizeService finalizeService,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            MessageRepository messageRepository,
            MemoryService memoryService,
            ReminderService reminderService,
            ConsentService consentService,
            ObjectMapper objectMapper,
            Duration ttl) {
        this(
                finalizeService,
                exportService,
                relationshipService,
                conversationListService,
                messageRepository,
                memoryService,
                reminderService,
                consentService,
                objectMapper,
                ttl,
                null);
    }

    /** Full constructor; {@code objectStorage} non-null selects object mode. */
    public DataExportWorkItemHandler(
            GenerationFinalizeService finalizeService,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            MessageRepository messageRepository,
            MemoryService memoryService,
            ReminderService reminderService,
            ConsentService consentService,
            ObjectMapper objectMapper,
            Duration ttl,
            ExportObjectStorage objectStorage) {
        this(
                finalizeService,
                exportService,
                relationshipService,
                conversationListService,
                messageRepository,
                memoryService,
                reminderService,
                consentService,
                objectMapper,
                ttl,
                objectStorage,
                null,
                null);
    }

    /**
     * Complete constructor (DOGFOOD-STABILIZATION): object mode additionally
     * takes the envelope cipher (required in object mode; null keeps the
     * legacy behavior for existing callers that never upload) and the orphan
     * alerter.
     */
    public DataExportWorkItemHandler(
            GenerationFinalizeService finalizeService,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            MessageRepository messageRepository,
            MemoryService memoryService,
            ReminderService reminderService,
            ConsentService consentService,
            ObjectMapper objectMapper,
            Duration ttl,
            ExportObjectStorage objectStorage,
            com.virtualcompanion.platform.persistence.RestFieldCipher objectCipher,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier) {
        this(
                finalizeService,
                exportService,
                relationshipService,
                conversationListService,
                messageRepository,
                memoryService,
                reminderService,
                consentService,
                objectMapper,
                ttl,
                objectStorage,
                objectCipher,
                alertNotifier,
                null);
    }

    /**
     * DOGFOOD-STABILIZATION-02 full constructor: additionally carries the
     * deletion-intent probe so an active account deletion blocks new seals
     * (ADR-0006 §7 ordering — the intent is persisted before object cleanup,
     * so a seal that still starts must at least refuse to upload). Null keeps
     * the check off for no-database tests.
     */
    public DataExportWorkItemHandler(
            GenerationFinalizeService finalizeService,
            ExportService exportService,
            RelationshipService relationshipService,
            ConversationListService conversationListService,
            MessageRepository messageRepository,
            MemoryService memoryService,
            ReminderService reminderService,
            ConsentService consentService,
            ObjectMapper objectMapper,
            Duration ttl,
            ExportObjectStorage objectStorage,
            com.virtualcompanion.platform.persistence.RestFieldCipher objectCipher,
            com.virtualcompanion.runtime.observability.AlertNotifier alertNotifier,
            com.virtualcompanion.platform.persistence.AccountDeletionIntentService deletionIntents) {
        if (objectStorage != null && objectCipher == null) {
            throw new IllegalArgumentException(
                    "object mode requires the rest field cipher for envelope encryption");
        }
        this.finalizeService = finalizeService;
        this.exportService = exportService;
        this.relationshipService = relationshipService;
        this.conversationListService = conversationListService;
        this.messageRepository = messageRepository;
        this.memoryService = memoryService;
        this.reminderService = reminderService;
        this.consentService = consentService;
        this.objectMapper = objectMapper.copy()
                .setSerializationInclusion(JsonInclude.Include.NON_NULL);
        this.ttl = ttl;
        this.objectStorage = objectStorage;
        this.objectCipher = objectCipher;
        this.alertNotifier = alertNotifier;
        this.deletionIntents = deletionIntents;
    }

    @Override
    public void handle(WorkItemClaim claim) {
        if (!KIND_DATA_EXPORT.equals(claim.kind())) {
            log.warn("data-export handler skipping non-DATA_EXPORT item kind={}", claim.kind());
            return;
        }
        WorkItemWorker.OwnerExecutor executor = WorkItemWorker.segmentExecutor();
        long ownerUserId = claim.ownerUserId();
        long exportId = claim.refId();
        java.util.concurrent.atomic.AtomicReference<PreparedUpload> prepared =
                new java.util.concurrent.atomic.AtomicReference<>();
        try {
            if (objectStorage == null) {
                // Inline mode: the V42 single-transaction path, unchanged —
                // still inside the shared failure terminalization below.
                executor.asOwner(ownerUserId, () ->
                        buildAndSealInline(ownerUserId, exportId, claim));
                return;
            }
            // DOGFOOD-STABILIZATION-05 (upload protocol): the document and
            // its encrypted envelope are built FIRST, in one owner
            // transaction; the fenced upload intent is recorded only then,
            // in its OWN committed transaction as close to the put as
            // possible, and the put itself runs OUTSIDE every database
            // transaction. A refusal of the record (deletion barrier, fenced
            // attempt, terminal export) therefore happens BEFORE any object
            // exists, and a crash after the put leaves the durable V114
            // intent row the reconciliation sweep acts on.
            executor.asOwner(ownerUserId, () ->
                    prepared.set(prepareUpload(ownerUserId, exportId, claim)));
            PreparedUpload upload = prepared.get();
            executor.asOwner(ownerUserId, () ->
                    exportService.recordUploadIntent(
                            ownerUserId, exportId, upload.key(), UPLOAD_LEASE_SECONDS));
            // 07 (defect B): the durable lease heartbeat keeps the intent
            // leased for the WHOLE multipart upload (many HTTP calls — the
            // per-call timeout is not a duration bound). A failed renew
            // aborts the abortable envelope stream, so the put fails into
            // the compensation path instead of outliving its lease.
            UploadLeaseHeartbeat heartbeat = newUploadLeaseHeartbeat(() ->
                    executor.asOwner(ownerUserId, () -> {
                        int rows = exportService.renewUploadLease(
                                ownerUserId, exportId, upload.key(), UPLOAD_LEASE_SECONDS);
                        if (rows != 1) {
                            // 0 rows = the attempt was claimed/fenced out —
                            // the renew lost the lease and must abort.
                            throw new IllegalStateException(
                                    "upload lease renewal lost the lease (rows=" + rows + ")");
                        }
                    }));
            try {
                try {
                    objectStorage.put(upload.key(),
                            heartbeat.abortableStream(upload.envelope()),
                            upload.envelope().length);
                } catch (RuntimeException putFailure) {
                    throw new PossibleUploadException(
                            upload.key(), upload.envelope().length, putFailure);
                }
                if (heartbeat.isAborted() || !heartbeat.renewOnce()) {
                    // The lease was lost during (or exactly at the end of)
                    // the upload: the put's outcome is not trusted — fail
                    // closed into the same compensation path (no READY seal;
                    // the intent row stays durable for the reclaim).
                    throw new PossibleUploadException(
                            upload.key(), upload.envelope().length,
                            new IllegalStateException("upload lease lost during the put"));
                }
            } finally {
                heartbeat.close();
            }
            try {
                executor.asOwner(ownerUserId, () ->
                        sealObject(ownerUserId, exportId, claim, upload));
            } catch (RuntimeException sealFailure) {
                throw new SealAfterUploadException(
                        upload.key(), upload.envelope().length, sealFailure);
            }
            // The seal committed with THIS attempt's key — sweep away any
            // object a crashed earlier attempt left under the same export
            // prefix (audit defect E's takeover cleanup).
            cleanupStaleAttemptObjects(ownerUserId, exportId, upload.key());
        } catch (SealAfterUploadException e) {
            // The owner-bound seal transaction rolled back AFTER the bucket
            // upload had already succeeded — run the no-orphan protocol in
            // fresh transactions (see preserveOrCompensate).
            preserveOrCompensate(ownerUserId, exportId, executor, e);
        } catch (PossibleUploadException e) {
            // The upload client threw although the object may already have
            // landed (e.g. a timeout after the server-side put); no seal ever
            // ran, so compensate the possibly-live object (see
            // compensatePossibleUpload).
            compensatePossibleUpload(ownerUserId, exportId, executor, e);
        } catch (RuntimeException e) {
            log.error(
                    "data-export handler failed for owner={} export={} workItem={}",
                    ownerUserId,
                    exportId,
                    claim.id(),
                    e);
            // Best-effort FAILED terminal state in its own owner transaction;
            // then rethrow so the worker fails the work item independently.
            markFailed(ownerUserId, exportId, executor);
            throw e;
        }
    }

    /**
     * Thrown when the object upload succeeded but the READY seal failed —
     * carries the uploaded pointer so the no-orphan protocol can act on it
     * outside the rolled-back transaction.
     */
    static final class SealAfterUploadException extends RuntimeException {
        private final String objectKey;
        private final long objectBytes;

        SealAfterUploadException(String objectKey, long objectBytes, RuntimeException cause) {
            super(cause.getMessage(), cause);
            this.objectKey = objectKey;
            this.objectBytes = objectBytes;
        }
    }

    /**
     * Thrown when the upload itself threw although the object may already be
     * in the bucket (ambiguous success, e.g. a client timeout after the
     * server-side put completed). Carries the deterministic key so the
     * compensation can act on it.
     */
    static final class PossibleUploadException extends RuntimeException {
        private final String objectKey;
        private final long objectBytes;

        PossibleUploadException(String objectKey, long objectBytes, RuntimeException cause) {
            super(cause.getMessage(), cause);
            this.objectKey = objectKey;
            this.objectBytes = objectBytes;
        }
    }

    /**
     * The fully prepared upload of one attempt (05 protocol): the document
     * is aggregated, serialized and encrypted; {@code key} is this attempt's
     * fenced key; {@code expiresAt} is the expiry stamped into the envelope.
     */
    record PreparedUpload(String key, byte[] envelope, Instant expiresAt) {
    }

    /**
     * 07 (defect B): the durable upload-lease heartbeat. One daemon thread
     * renews the intent's lease every {@link #UPLOAD_HEARTBEAT_SECONDS}
     * while the (possibly multipart, many-HTTP-call) put runs; a renew that
     * returns 0 rows (attempt claimed/fenced) or throws sets the abort flag
     * — the abortable envelope stream then fails the put mid-read, and even
     * a put that already completed is not trusted. Either way the handler
     * fails closed into the compensation path; the intent row stays durable
     * for the unified reclaim protocol. Exceptions never escape the
     * scheduler thread (a throwing fixed-rate task would silently stop the
     * heartbeat).
     */
    static final class UploadLeaseHeartbeat implements AutoCloseable {
        /** One lease renewal (opens its own owner transaction). */
        interface Renewal {
            void renew();
        }

        private final java.util.concurrent.ScheduledExecutorService executor;
        private final Renewal renewalTarget;
        private final java.util.concurrent.atomic.AtomicBoolean aborted =
                new java.util.concurrent.atomic.AtomicBoolean();
        private final java.util.concurrent.atomic.AtomicReference<byte[]> envelope =
                new java.util.concurrent.atomic.AtomicReference<>();

        private UploadLeaseHeartbeat(Renewal renewal, long periodMillis) {
            this.renewalTarget = renewal;
            this.executor = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(
                    runnable -> {
                        Thread thread = new Thread(runnable, "export-upload-lease-heartbeat");
                        thread.setDaemon(true);
                        return thread;
                    });
            this.executor.scheduleAtFixedRate(() -> {
                try {
                    renewal.renew();
                } catch (RuntimeException e) {
                    log.warn("export upload lease renewal failed; aborting the upload");
                    aborted.set(true);
                    // A throwing fixed-rate task would silently stop future
                    // runs — swallow here, the abort flag is the signal.
                }
            }, periodMillis, periodMillis, java.util.concurrent.TimeUnit.MILLISECONDS);
        }

        static UploadLeaseHeartbeat start(Renewal renewal) {
            return new UploadLeaseHeartbeat(renewal,
                    UPLOAD_HEARTBEAT_SECONDS * 1000L);
        }

        /** Package-visible: tests compress the cadence (no real waiting). */
        static UploadLeaseHeartbeat start(Renewal renewal, long periodMillis) {
            return new UploadLeaseHeartbeat(renewal, periodMillis);
        }

        /**
         * The deterministic post-put gate (07): one FINAL synchronous renewal
         * after the upload finished. The background heartbeat only makes the
         * failure LIKELY to surface mid-put (the abortable stream); this
         * synchronous check closes the narrow race where the upload and the
         * failing renewal complete at the same instant — the seal only ever
         * runs on an attempt whose lease was just re-confirmed.
         */
        boolean renewOnce() {
            if (aborted.get()) {
                return false;
            }
            try {
                renewalTarget.renew();
                return true;
            } catch (RuntimeException e) {
                log.warn("export upload lease final renewal failed; failing closed");
                aborted.set(true);
                return false;
            }
        }

        boolean isAborted() {
            return aborted.get();
        }

        /**
         * The put's byte source: the envelope, failing mid-read once the
         * heartbeat aborted (the storage client turns the IOException into
         * its own failure, which the handler maps to compensation).
         */
        java.io.InputStream abortableStream(byte[] bytes) {
            envelope.set(bytes);
            return new java.io.InputStream() {
                private int position;

                @Override
                public int read() throws java.io.IOException {
                    if (aborted.get()) {
                        throw new java.io.IOException("upload aborted: lease heartbeat failed");
                    }
                    byte[] source = envelope.get();
                    if (position >= source.length) {
                        return -1;
                    }
                    return source[position++] & 0xFF;
                }

                @Override
                public int read(byte[] buffer, int offset, int length)
                        throws java.io.IOException {
                    if (aborted.get()) {
                        throw new java.io.IOException("upload aborted: lease heartbeat failed");
                    }
                    byte[] source = envelope.get();
                    if (position >= source.length) {
                        return -1;
                    }
                    int chunk = Math.min(length, source.length - position);
                    System.arraycopy(source, position, buffer, offset, chunk);
                    position += chunk;
                    return chunk;
                }
            };
        }

        @Override
        public void close() {
            executor.shutdownNow();
        }
    }

    /** The lease heartbeat of one object-mode attempt (07 cadence). */
    UploadLeaseHeartbeat newUploadLeaseHeartbeat(UploadLeaseHeartbeat.Renewal renewal) {
        return UploadLeaseHeartbeat.start(renewal);
    }

    /**
     * Inline mode keeps the V42 single-transaction behavior byte for byte:
     * guard, aggregate, serialize and seal in ONE owner transaction (no
     * storage interaction exists to order).
     */
    private void buildAndSealInline(long ownerUserId, long exportId, WorkItemClaim claim) {
        deletionGuard(ownerUserId, exportId);
        finalizeService.assertActiveClaim(
                ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
        Instant expiresAt = Instant.now().plus(ttl);
        String payload = serialize(withExpiry(buildDocument(ownerUserId, exportId), expiresAt));
        boolean sealed = exportService.complete(ownerUserId, exportId, payload, expiresAt);
        if (!sealed) {
            throw new IllegalStateException(
                    "complete_export moved 0 rows for owner=" + ownerUserId + " export=" + exportId);
        }
        int rows = finalizeService.completeWorkItem(
                claim.id(), claim.claimToken(), claim.claimFence());
        if (rows != 1) {
            throw new IllegalStateException(
                    "per-item complete inside data-export returned rows=" + rows);
        }
    }

    /**
     * Phase 1 (05): one owner transaction — guard, aggregate, serialize,
     * encrypt. NO put happens here; the fenced intent record and the put
     * follow in their own steps so the protocol ordering (document first,
     * record next to the put) is structurally guaranteed.
     */
    private PreparedUpload prepareUpload(long ownerUserId, long exportId, WorkItemClaim claim) {
        deletionGuard(ownerUserId, exportId);
        finalizeService.assertActiveClaim(
                ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
        Instant expiresAt = Instant.now().plus(ttl);
        String payload = serialize(withExpiry(buildDocument(ownerUserId, exportId), expiresAt));
        String key = objectKey(ownerUserId, exportId, claim.claimFence());
        byte[] envelope = objectCipher.encrypt(payload).getBytes(StandardCharsets.UTF_8);
        return new PreparedUpload(key, envelope, expiresAt);
    }

    /**
     * Phase 3 (05): the READY seal in its own owner transaction — re-assert
     * the live claim (it could have been taken over while the put ran),
     * consume the fenced intent and write the pointer atomically inside
     * {@code complete_export}, then complete the work item. Any failure here
     * rolls the pointer back and surfaces as {@link SealAfterUploadException}.
     */
    private void sealObject(
            long ownerUserId, long exportId, WorkItemClaim claim, PreparedUpload upload) {
        finalizeService.assertActiveClaim(
                ownerUserId, claim.id(), claim.claimToken(), claim.claimFence());
        boolean sealed = exportService.completeObject(
                ownerUserId, exportId, upload.key(), upload.envelope().length,
                upload.expiresAt());
        if (!sealed) {
            throw new IllegalStateException(
                    "complete_export moved 0 rows for owner=" + ownerUserId
                            + " export=" + exportId);
        }
        int rows = finalizeService.completeWorkItem(
                claim.id(), claim.claimToken(), claim.claimFence());
        if (rows != 1) {
            throw new IllegalStateException(
                    "per-item complete inside data-export returned rows=" + rows);
        }
    }

    private void deletionGuard(long ownerUserId, long exportId) {
        if (deletionIntents != null && deletionIntents.activeCurrent(ownerUserId)) {
            // ADR-0006 §7 ordering: the deletion intent is persisted before
            // the object cleanup; a seal that starts afterwards must refuse
            // so it cannot strand a new object behind the final re-check.
            // (V113 also enforces this atomically inside complete_export /
            // fail_export_with_object — this early check saves the upload.)
            throw new IllegalStateException(
                    "account deletion intent blocks export sealing (owner=" + ownerUserId
                            + " export=" + exportId + ")");
        }
    }

    /**
     * DOGFOOD-STABILIZATION-03 (audit defect E): after THIS attempt's seal
     * committed under its own fence-digest key, delete every OTHER object
     * under the export's key prefix — the residue of a crashed earlier
     * claimant whose compensation never ran. Best-effort: the READY seal is
     * already durable, and a cleanup failure alerts (P1
     * EXPORT_OBJECT_ORPHAN_RISK) instead of rolling anything back.
     */
    private void cleanupStaleAttemptObjects(
            long ownerUserId, long exportId, String currentKey) {
        String prefix = "exports/" + ownerUserId + "/" + exportId + "-";
        try {
            for (String key : objectStorage.list(prefix)) {
                if (!key.equals(currentKey)) {
                    objectStorage.delete(key);
                    log.warn(
                            "removed stale export attempt object left by an earlier claimant "
                                    + "(owner={} export={} key={})",
                            ownerUserId, exportId, key);
                }
            }
        } catch (RuntimeException cleanupFailure) {
            log.error(
                    "stale export attempt cleanup failed (owner={} export={})",
                    ownerUserId, exportId, cleanupFailure);
            if (alertNotifier != null) {
                alertNotifier.alert(
                        com.virtualcompanion.runtime.observability.AlertSeverity.P1,
                        ALERT_ORPHAN_RISK,
                        "a stale export attempt object could not be cleaned after a successful "
                                + "seal; manual cleanup may be required");
            }
        }
    }

    /**
     * No-orphan protocol after a failed seal with the object already in the
     * bucket (DOGFOOD-STABILIZATION audit). Preference order:
     * <ol>
     *   <li>durable pointer — terminalize FAILED WITH the object pointer
     *       ({@code fail_export_with_object}, V110) in a fresh owner
     *       transaction; the object stays protected and the FAILED-object
     *       sweep removes it later;</li>
     *   <li>compensation — delete the just-uploaded object (safe: no pointer
     *       ever existed) and terminalize plain FAILED;</li>
     *   <li>if both fail, P1 {@code EXPORT_OBJECT_ORPHAN_RISK} — the
     *       database is down for every path including failure
     *       terminalization.</li>
     * </ol>
     * Always rethrows the original cause so the worker fails the item.
     */
    private void preserveOrCompensate(
            long ownerUserId, long exportId, WorkItemWorker.OwnerExecutor executor,
            SealAfterUploadException failure) {
        boolean pointerKept = false;
        try {
            AtomicBoolean kept = new AtomicBoolean();
            executor.asOwner(ownerUserId, () -> kept.set(exportService.failWithObject(
                    ownerUserId, exportId, failure.objectKey, failure.objectBytes,
                    FAULT_EXPORT_FAILED)));
            pointerKept = kept.get();
        } catch (RuntimeException pointerFailure) {
            log.error(
                    "durable pointer after failed export seal also failed for owner={} export={}",
                    ownerUserId,
                    exportId,
                    pointerFailure);
        }
        if (pointerKept) {
            log.warn(
                    "export seal failed; object preserved with durable pointer (owner={} export={})",
                    ownerUserId,
                    exportId);
            throw failure;
        }
        try {
            objectStorage.delete(failure.objectKey);
            log.warn(
                    "export seal failed and pointer write failed; uploaded object compensated "
                            + "away (owner={} export={})",
                    ownerUserId,
                    exportId);
        } catch (RuntimeException deleteFailure) {
            log.error(
                    "export object neither kept a pointer nor was deleted (owner={} export={})",
                    ownerUserId,
                    exportId,
                    deleteFailure);
            if (alertNotifier != null) {
                alertNotifier.alert(
                        com.virtualcompanion.runtime.observability.AlertSeverity.P1,
                        ALERT_ORPHAN_RISK,
                        "an uploaded export object could neither keep a durable pointer nor be "
                                + "compensated away; manual cleanup may be required");
            }
        }
        markFailed(ownerUserId, exportId, executor);
        throw failure;
    }

    /**
     * Ambiguous-upload compensation (DOGFOOD-STABILIZATION-02): the put threw
     * but the object may already be in the bucket and no seal ever ran, so no
     * pointer exists. Delete-compensate first — deleting an absent key is
     * harmless and the object most likely never landed; only when the delete
     * itself cannot confirm the object's absence does the handler fall back
     * to the durable FAILED-with-pointer terminal (the sweep then removes the
     * object once the store recovers), and only when THAT fails too does it
     * alert P1 {@code EXPORT_OBJECT_ORPHAN_RISK}.
     */
    private void compensatePossibleUpload(
            long ownerUserId, long exportId, WorkItemWorker.OwnerExecutor executor,
            PossibleUploadException failure) {
        log.warn(
                "export upload threw ambiguously; compensating the possibly-live object "
                        + "(owner={} export={})",
                ownerUserId,
                exportId,
                failure);
        try {
            objectStorage.delete(failure.objectKey);
        } catch (RuntimeException deleteFailure) {
            log.error(
                    "ambiguous export object could not be confirmed deleted (owner={} export={})",
                    ownerUserId,
                    exportId,
                    deleteFailure);
            boolean pointerKept = false;
            try {
                AtomicBoolean kept = new AtomicBoolean();
                executor.asOwner(ownerUserId, () -> kept.set(exportService.failWithObject(
                        ownerUserId, exportId, failure.objectKey, failure.objectBytes,
                        FAULT_EXPORT_FAILED)));
                pointerKept = kept.get();
            } catch (RuntimeException pointerFailure) {
                log.error(
                        "durable pointer for the ambiguous export object also failed "
                                + "(owner={} export={})",
                        ownerUserId,
                        exportId,
                        pointerFailure);
            }
            if (!pointerKept && alertNotifier != null) {
                alertNotifier.alert(
                        com.virtualcompanion.runtime.observability.AlertSeverity.P1,
                        ALERT_ORPHAN_RISK,
                        "an ambiguously uploaded export object could neither be deleted nor "
                                + "keep a durable pointer; manual cleanup may be required");
            }
        }
        markFailed(ownerUserId, exportId, executor);
        throw failure;
    }

    /** Best-effort FAILED terminal state (never blocks the worker's own fail). */
    private void markFailed(long ownerUserId, long exportId, WorkItemWorker.OwnerExecutor executor) {
        try {
            executor.asOwner(
                    ownerUserId, () -> exportService.fail(ownerUserId, exportId, FAULT_EXPORT_FAILED));
        } catch (RuntimeException suppressed) {
            log.error(
                    "failed to mark export {} FAILED for owner {}",
                    exportId,
                    ownerUserId,
                    suppressed);
        }
    }

    /**
     * Aggregate the owner's data. Conversations are keyset-walked to their end
     * (the list SD clamps pages to 1..100); the other sections are
     * relationship-scoped reads plus the effective consent state.
     */
    private ExportDocument buildDocument(long ownerUserId, long exportId) {
        List<ExportConversation> conversations = new ArrayList<>();
        Long afterId = null;
        while (true) {
            List<ConversationListRecord> page = conversationListService.listConversations(
                    ownerUserId, null, afterId, CONVERSATION_PAGE);
            if (page.isEmpty()) {
                break;
            }
            for (ConversationListRecord conversation : page) {
                List<MessageRepository.Message> messages =
                        messageRepository.listByConversation(ownerUserId, conversation.id());
                conversations.add(new ExportConversation(
                        String.valueOf(conversation.id()),
                        String.valueOf(conversation.relationshipId()),
                        conversation.title(),
                        conversation.incognito(),
                        messages.stream()
                                .map(DataExportWorkItemHandler::toExportMessage)
                                .toList()));
            }
            afterId = page.get(page.size() - 1).id();
        }

        List<ExportMemory> memories = new ArrayList<>();
        List<ExportReminder> reminders = new ArrayList<>();
        for (RelationshipRecord relationship : relationshipService.list(ownerUserId)) {
            for (MemoryRecord memory :
                    memoryService.list(ownerUserId, relationship.id(), Boolean.TRUE)) {
                memories.add(toExportMemory(memory));
            }
            for (ReminderRecord reminder :
                    reminderService.list(ownerUserId, relationship.id(), null, null)) {
                reminders.add(toExportReminder(reminder));
            }
        }

        List<ExportConsent> consents = consentService.list(ownerUserId).stream()
                .map(DataExportWorkItemHandler::toExportConsent)
                .toList();

        return new ExportDocument(
                String.valueOf(exportId),
                Instant.now().toString(),
                null,
                AI_CONTENT_NOTICE,
                conversations,
                memories,
                reminders,
                consents);
    }

    /** Stamp the document with the authoritative download expiry before sealing. */
    private static ExportDocument withExpiry(ExportDocument document, Instant expiresAt) {
        return new ExportDocument(
                document.exportId(),
                document.generatedAt(),
                expiresAt.toString(),
                document.aiContentNotice(),
                document.conversations(),
                document.memories(),
                document.reminders(),
                document.consents());
    }

    private String serialize(ExportDocument document) {
        try {
            return objectMapper.writeValueAsString(document);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("export document serialization failed", e);
        }
    }

    private static ExportMessage toExportMessage(MessageRepository.Message message) {
        return new ExportMessage(
                String.valueOf(message.id()),
                message.role(),
                message.content(),
                "assistant".equalsIgnoreCase(message.role()));
    }

    private static ExportMemory toExportMemory(MemoryRecord memory) {
        return new ExportMemory(
                String.valueOf(memory.id()),
                memory.relationshipId() == null ? null : String.valueOf(memory.relationshipId()),
                memory.scope(),
                memory.summary(),
                memory.status(),
                memory.createdAt().toString(),
                memory.deletedAt() == null ? null : memory.deletedAt().toString());
    }

    private static ExportReminder toExportReminder(ReminderRecord reminder) {
        return new ExportReminder(
                String.valueOf(reminder.id()),
                String.valueOf(reminder.relationshipId()),
                reminder.text(),
                reminder.remindAt().toString(),
                reminder.recurrence(),
                reminder.status());
    }

    private static ExportConsent toExportConsent(ConsentRecord consent) {
        return new ExportConsent(
                String.valueOf(consent.id()),
                consent.consentType(),
                consent.version(),
                consent.granted(),
                consent.grantedAt().toString(),
                consent.revokedAt() == null ? null : consent.revokedAt().toString());
    }

    /**
     * The serialized document (OpenAPI {@code ExportDownload}). expiresAt is
     * stamped by {@link #withExpiry} right before sealing, so every stored
     * document carries the authoritative download expiry.
     */
    record ExportDocument(
            String exportId,
            String generatedAt,
            String expiresAt,
            String aiContentNotice,
            List<ExportConversation> conversations,
            List<ExportMemory> memories,
            List<ExportReminder> reminders,
            List<ExportConsent> consents) {
    }

    record ExportConversation(
            String conversationId,
            String relationshipId,
            String title,
            boolean incognito,
            List<ExportMessage> messages) {
    }

    record ExportMessage(String messageId, String role, String content, boolean aiGenerated) {
    }

    record ExportMemory(
            String memoryId,
            String relationshipId,
            String scope,
            String summary,
            String status,
            String createdAt,
            String deletedAt) {
    }

    record ExportReminder(
            String reminderId,
            String relationshipId,
            String text,
            String remindAt,
            String recurrence,
            String status) {
    }

    record ExportConsent(
            String consentId,
            String consentType,
            String version,
            boolean granted,
            String grantedAt,
            String revokedAt) {
    }
}
