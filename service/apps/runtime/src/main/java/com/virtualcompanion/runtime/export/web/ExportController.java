package com.virtualcompanion.runtime.export.web;

import com.virtualcompanion.platform.persistence.ExportRecord;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Asynchronous data-export HTTP API (DATA-EXPORT / FR-DATA-002).
 *
 * <p>{@code POST /api/v1/exports} enqueues the export (one in-flight per
 * account, 400 otherwise); {@code GET /api/v1/exports/{exportId}} returns the
 * status and, while READY, the short-lived one-time {@code downloadUrl} built
 * from the sealed token; {@code GET /api/v1/exports/{exportId}/download}
 * consumes the token exactly once and returns the document. A foreign,
 * absent, consumed or expired export maps to 404 NOT_FOUND_OR_FORBIDDEN
 * (existence is never disclosed).
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter so every V42 SD call runs
 * inside the server-trusted owner context.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ExportController {

    private final ExportService exportService;

    public ExportController(ExportService exportService) {
        this.exportService = exportService;
    }

    @PostMapping("/exports")
    public ExportResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        long id = exportService.create(ownerUserId);
        ExportRecord record = exportService.get(ownerUserId, id)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        return toResponse(record);
    }

    @GetMapping("/exports/{exportId}")
    public ExportResponse status(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String exportId) {
        long id = parseRequiredId(exportId, "exportId");
        ExportRecord record = exportService.get(ownerUserId, id)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        return toResponse(record);
    }

    @GetMapping("/exports/{exportId}/download")
    public ResponseEntity<String> download(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String exportId,
            @RequestParam(name = "token") String token) {
        long id = parseRequiredId(exportId, "exportId");
        ExportService.ExportDownload download = exportService.consume(ownerUserId, id, token)
                .orElseThrow(() -> new ResourceNotFoundException("export"));
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(download.payload());
    }

    private static ExportResponse toResponse(ExportRecord record) {
        String downloadUrl = null;
        if (ExportService.STATUS_READY.equals(record.status())
                && record.downloadToken() != null) {
            downloadUrl = "/api/v1/exports/" + record.id() + "/download?token="
                    + URLEncoder.encode(record.downloadToken(), StandardCharsets.UTF_8);
        }
        return new ExportResponse(
                record.id(),
                record.status(),
                record.requestedAt().toString(),
                record.completedAt() == null ? null : record.completedAt().toString(),
                record.expiresAt() == null ? null : record.expiresAt().toString(),
                record.errorMessage(),
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

    /** Status body (OpenAPI {@code ExportRequest}). */
    public record ExportResponse(
            long exportId,
            String status,
            String requestedAt,
            String completedAt,
            String expiresAt,
            String errorMessage,
            String downloadUrl) {
    }
}
