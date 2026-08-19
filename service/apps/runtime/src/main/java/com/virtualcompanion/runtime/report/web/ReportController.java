package com.virtualcompanion.runtime.report.web;

import com.virtualcompanion.platform.persistence.ReportRecord;
import com.virtualcompanion.platform.persistence.ReportService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import java.util.List;
import java.util.OptionalLong;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Report/complaint intake HTTP API (REPORT-BE V56, FR-DATA-001 举报和申诉
 * 状态, §20.15 投诉申诉和误判).
 *
 * <p>{@code POST /api/v1/reports} appends an intake record, optionally
 * anchored to one of the caller's own persisted messages; the reason follows
 * the report-reasons catalog and the note is bounded free text. Technical
 * Alpha records the submission and exposes its status only — resolution is a
 * human review action, and no ticket numbers, SLA promises or hotline
 * contacts are invented. A foreign or absent message anchor maps to 404
 * NOT_FOUND_OR_FORBIDDEN (existence never disclosed); listing is
 * newest-first keyset over the caller's own rows.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner
 * GUC is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1/reports")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ReportController {

    private final ReportService reportService;

    public ReportController(ReportService reportService) {
        this.reportService = reportService;
    }

    /** Append one report; the response is the appended record. */
    @PostMapping
    public ReportResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestBody CreateReportRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        String reason = ReportService.normalizeReason(request.reason());
        String note = ReportService.normalizeNote(request.note());
        OptionalLong id = reportService.create(
                ownerUserId, request.messageId(), reason, note);
        if (id.isEmpty()) {
            throw new ResourceNotFoundException("message");
        }
        return reportService.get(ownerUserId, id.getAsLong())
                .map(ReportController::toResponse)
                .orElseThrow(() -> new IllegalStateException(
                        "created report not readable"));
    }

    /** The caller's reports, newest-first keyset. */
    @GetMapping
    public List<ReportResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestParam(name = "after", required = false) String after,
            @RequestParam(name = "limit", required = false) String limit) {
        return reportService
                .list(ownerUserId, parseOptionalLong(after, "after"), parseOptionalInt(limit, "limit"))
                .stream()
                .map(ReportController::toResponse)
                .toList();
    }

    /** One of the caller's reports; foreign or absent maps to 404. */
    @GetMapping("/{reportId}")
    public ReportResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String reportId) {
        long id = parseRequiredLong(reportId, "reportId");
        return reportService.get(ownerUserId, id)
                .map(ReportController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("report"));
    }

    private static long parseRequiredLong(String raw, String name) {
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

    private static Long parseOptionalLong(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid id: " + raw, e);
        }
    }

    private static Integer parseOptionalInt(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(name + " is not a valid number: " + raw, e);
        }
    }

    private static ReportResponse toResponse(ReportRecord record) {
        return new ReportResponse(
                Long.toString(record.id()),
                record.messageId() == null ? null : Long.toString(record.messageId()),
                record.reason(),
                record.note(),
                record.status(),
                record.resolutionNote().isEmpty() ? null : record.resolutionNote(),
                record.createdAt().toString(),
                record.resolvedAt() == null ? null : record.resolvedAt().toString());
    }

    /**
     * Submission body (OpenAPI {@code CreateReportRequest}). {@code messageId}
     * is a boxed Long so an omitted JSON field deserializes cleanly; the
     * reason must be a report-reasons catalog code.
     */
    public record CreateReportRequest(Long messageId, String reason, String note) {

        public CreateReportRequest {
            if (messageId != null && messageId <= 0) {
                throw new IllegalArgumentException("messageId must be positive when present");
            }
        }
    }

    /** Report record body (OpenAPI {@code ReportRecord}). */
    public record ReportResponse(
            String id, String messageId, String reason, String note, String status,
            String resolutionNote, String createdAt, String resolvedAt) {
    }
}
