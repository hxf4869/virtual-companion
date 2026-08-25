package com.virtualcompanion.runtime.export.web;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.virtualcompanion.platform.persistence.ExportRecord;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.web.CurrentPasswordGuard;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Asynchronous data-export HTTP API (DATA-EXPORT / FR-DATA-002).
 *
 * <p>{@code POST /api/v1/exports} enqueues the export (one in-flight per
 * account, 400 otherwise) and issues the one-time download token — the
 * {@code downloadToken}/{@code downloadUrl} appear in THAT response only,
 * while READY; {@code GET /api/v1/exports/{exportId}} returns the bare status
 * (only the token's sha256 digest is persisted, V76);
 * {@code GET /api/v1/exports/{exportId}/download} consumes the token exactly
 * once and returns the document. A foreign,
 * absent, consumed or expired export maps to 404 NOT_FOUND_OR_FORBIDDEN
 * (existence is never disclosed).
 *
 * <p>ADR-0006 §7.7 (DOGFOOD-08): creating an export is a high-risk
 * data-rights operation — the request body must carry the caller's CURRENT
 * password and the shared {@link CurrentPasswordGuard} verifies it
 * synchronously (fail-closed, no time window) before anything is enqueued.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter so every V42 SD call runs
 * inside the server-trusted owner context.
 *
 * <p>Object mode (DOGFOOD-02, ADR-0006 §7.3): when an
 * {@link ExportObjectStorage} bean is wired the document lives in the private
 * bucket; the download fetches the object server-side and returns its body,
 * then deletes the object best-effort (a failed delete is logged and picked
 * up by the expiry sweep once the row passes its expiry). The response shape
 * is unchanged — the existing H5 client parses the same export document —
 * and the one-time semantics stay in the token consumption, not in the
 * storage.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ExportController {

    private static final Logger log = LoggerFactory.getLogger(ExportController.class);

    private final ExportService exportService;
    private final CurrentPasswordGuard currentPasswordGuard;
    private final ExportObjectStorage objectStorage;
    /** AES-GCM envelope cipher for object mode (null in inline mode). */
    private final com.virtualcompanion.platform.persistence.RestFieldCipher objectCipher;
    /** DOGFOOD-STABILIZATION-02: blocks new exports once a deletion intent is active. */
    private final com.virtualcompanion.platform.persistence.AccountDeletionIntentService
            deletionIntents;

    public ExportController(
            ExportService exportService, CurrentPasswordGuard currentPasswordGuard) {
        this(exportService, currentPasswordGuard, null, null, null);
    }

    /**
     * Full constructor; a non-null {@code objectStorage} enables object
     * mode (the cipher is then mandatory — bucket objects are opaque
     * envelopes, never plaintext JSON). Spring wires this one — the storage
     * bean exists only while object mode is on, otherwise the nullable
     * parameters stay null and the controller keeps the inline behavior.
     */
    @org.springframework.beans.factory.annotation.Autowired
    public ExportController(
            ExportService exportService,
            CurrentPasswordGuard currentPasswordGuard,
            @org.springframework.lang.Nullable ExportObjectStorage objectStorage,
            @org.springframework.lang.Nullable
                    com.virtualcompanion.platform.persistence.RestFieldCipher objectCipher,
            @org.springframework.lang.Nullable
                    com.virtualcompanion.platform.persistence.AccountDeletionIntentService
                            deletionIntents) {
        if (objectStorage != null && objectCipher == null) {
            throw new IllegalArgumentException(
                    "object mode requires the rest field cipher for envelope decryption");
        }
        this.exportService = exportService;
        this.currentPasswordGuard = currentPasswordGuard;
        this.objectStorage = objectStorage;
        this.objectCipher = objectCipher;
        this.deletionIntents = deletionIntents;
    }

    @PostMapping("/exports")
    public ExportResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @AuthenticationPrincipal(expression = "username") String username,
            @Valid @RequestBody ExportCreateRequest request) {
        // ADR-0006 §7.7: the freshly re-entered current password gates the
        // export creation before the worker sees anything.
        currentPasswordGuard.assertCurrentPassword(ownerUserId, username, request.currentPassword());
        // DOGFOOD-STABILIZATION-02 (ADR-0006 §7 ordering): an active deletion
        // intent refuses new export requests so the pre-cascade cleanup loop
        // cannot race a fresh seal.
        if (deletionIntents != null && deletionIntents.activeCurrent(ownerUserId)) {
            throw new IllegalArgumentException(
                    "account deletion is in progress; export requests are closed");
        }
        // V76: the one-time download secret is issued HERE and shown exactly
        // once; only its sha256 digest is persisted (status polls never carry
        // it — same issuance shape as the V8 realtime ticket).
        String token = UUID.randomUUID().toString();
        long id = exportService.create(ownerUserId, token);
        ExportRecord record = exportService.get(ownerUserId, id)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        String downloadUrl = "/api/v1/exports/" + id + "/download?token="
                + URLEncoder.encode(token, StandardCharsets.UTF_8);
        return toResponse(record, token, downloadUrl);
    }

    @GetMapping("/exports/{exportId}")
    public ExportResponse status(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String exportId) {
        long id = parseRequiredId(exportId, "exportId");
        ExportRecord record = exportService.get(ownerUserId, id)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        return toResponse(record, null, null);
    }

    @GetMapping("/exports/{exportId}/download")
    public ResponseEntity<String> download(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String exportId,
            @RequestParam(name = "token") String token) {
        long id = parseRequiredId(exportId, "exportId");
        ExportService.ExportDownload download = exportService.consume(ownerUserId, id, token)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        if (download.objectKey() != null) {
            // Object mode: the token is already consumed; fetch the OPAQUE
            // envelope, decrypt server-side, deliver, then remove the object.
            // A fetch or decrypt failure after consumption is a terminal 500
            // — the owner must re-request the export (one-time semantics),
            // and the sweep deletes the leftover object later.
            byte[] envelope = objectStorage.get(download.objectKey());
            String document = objectCipher.decrypt(new String(envelope, StandardCharsets.UTF_8));
            deleteConsumedObject(ownerUserId, id, download.objectKey());
            return ResponseEntity.ok()
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(document);
        }
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(download.payload());
    }

    /**
     * Best-effort object cleanup after a successful one-time download. A
     * delete failure is logged (never blocks the delivered response); the
     * row's object pointer survives, so once the row passes its expiry the
     * sweep ({@code vc.expire_stale_exports} + object deletion) removes the
     * object and clears the pointer.
     */
    private void deleteConsumedObject(long ownerUserId, long exportId, String objectKey) {
        try {
            objectStorage.delete(objectKey);
            exportService.clearObject(ownerUserId, exportId, objectKey);
        } catch (RuntimeException e) {
            log.error(
                    "export object cleanup after download failed for owner={} export={} "
                            + "(sweep will retry after expiry)",
                    ownerUserId,
                    exportId,
                    e);
        }
    }

    private static ExportResponse toResponse(
            ExportRecord record, String downloadToken, String downloadUrl) {
        return new ExportResponse(
                record.id(),
                record.status(),
                record.requestedAt().toString(),
                record.completedAt() == null ? null : record.completedAt().toString(),
                record.expiresAt() == null ? null : record.expiresAt().toString(),
                record.errorMessage(),
                downloadToken,
                downloadUrl);
    }

    private static long parseRequiredId(String raw, String name) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new IllegalArgumentException(name + " must be positive");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid id: " + raw, e);
        }
    }

    /** Create body (OpenAPI {@code ExportCreateRequest}); ADR-0006 §7.7:
     * the caller's freshly re-entered CURRENT password. */
    public record ExportCreateRequest(
            @NotBlank @Size(max = 128) String currentPassword) {
    }

    /** Status body (OpenAPI {@code ExportRequest}); {@code downloadToken} and
     * {@code downloadUrl} are present only in the create response. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ExportResponse(
            long exportId,
            String status,
            String requestedAt,
            String completedAt,
            String expiresAt,
            String errorMessage,
            String downloadToken,
            String downloadUrl) {
    }
}
