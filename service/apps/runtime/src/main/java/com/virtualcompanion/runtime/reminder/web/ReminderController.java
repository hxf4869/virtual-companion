package com.virtualcompanion.runtime.reminder.web;

import com.virtualcompanion.platform.persistence.ReminderRecord;
import com.virtualcompanion.platform.persistence.ReminderService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Structured reminder HTTP API (REMINDER / FR-NOTIFY-001).
 *
 * <p>Create/list under a relationship plus update/delete by reminder id. All
 * writes re-verify the trusted owner inside the V39 SD functions; a foreign or
 * absent reminder maps to 404 NOT_FOUND_OR_FORBIDDEN (existence undisclosed).
 * Unapproved recurrence/status codes map to 400 INVALID_REQUEST via the eager
 * normalizers. Technical Alpha stores and lists reminders without any push
 * transport (product-scope: 不提供主动消息).
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ReminderController {

    private final ReminderService reminderService;

    public ReminderController(ReminderService reminderService) {
        this.reminderService = reminderService;
    }

    @PostMapping("/relationships/{relationshipId}/reminders")
    public ReminderResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId,
            @Valid @RequestBody ReminderCreateRequest request) {
        long relationship = parseRequiredId(relationshipId, "relationshipId");
        Instant remindAt = parseInstant(request.remindAt());
        // FR-NOTIFY-001: eager validation rejects unapproved codes with a 400
        // (fail closed; the SD re-checks as defense in depth).
        String recurrence = ReminderService.normalizeRecurrence(request.recurrence());
        long id = reminderService.create(
                ownerUserId,
                relationship,
                request.text(),
                remindAt,
                recurrence);
        ReminderRecord record = reminderService.get(ownerUserId, id)
                .orElseThrow(() -> new ResourceNotFoundException("reminder"));
        return toResponse(record);
    }

    @GetMapping("/relationships/{relationshipId}/reminders")
    public List<ReminderResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId,
            @RequestParam(name = "after", required = false) String after,
            @RequestParam(name = "limit", required = false) String limit) {
        long relationship = parseRequiredId(relationshipId, "relationshipId");
        Long afterId = parseOptionalId(after, "after");
        Integer pageLimit = parseOptionalInt(limit, "limit");
        return reminderService.list(ownerUserId, relationship, afterId, pageLimit).stream()
                .map(ReminderController::toResponse)
                .toList();
    }

    @PatchMapping("/reminders/{reminderId}")
    public ReminderResponse update(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String reminderId,
            @Valid @RequestBody ReminderUpdateRequest request) {
        long id = parseRequiredId(reminderId, "reminderId");
        Instant remindAt = parseInstant(request.remindAt());
        // FR-NOTIFY-001: eager validation rejects unapproved codes with a 400.
        String recurrence = ReminderService.normalizeRecurrence(request.recurrence());
        String status = ReminderService.normalizeStatus(request.status());
        ReminderRecord record = reminderService.update(
                        ownerUserId,
                        id,
                        request.text(),
                        remindAt,
                        recurrence,
                        status)
                .orElseThrow(() -> new ResourceNotFoundException("reminder"));
        return toResponse(record);
    }

    @DeleteMapping("/reminders/{reminderId}")
    public ReminderDeletedResponse delete(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String reminderId) {
        long id = parseRequiredId(reminderId, "reminderId");
        if (!reminderService.delete(ownerUserId, id)) {
            throw new ResourceNotFoundException("reminder");
        }
        return new ReminderDeletedResponse(true);
    }

    private static ReminderResponse toResponse(ReminderRecord record) {
        return new ReminderResponse(
                record.id(),
                record.relationshipId(),
                record.text(),
                record.remindAt().toString(),
                record.recurrence(),
                record.status(),
                record.createdAt().toString(),
                record.updatedAt().toString());
    }

    private static Instant parseInstant(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("remindAt is required");
        }
        try {
            return Instant.parse(raw);
        } catch (java.time.format.DateTimeParseException e) {
            throw new IllegalArgumentException("remindAt is not a valid instant: " + raw, e);
        }
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

    private static Long parseOptionalId(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        return parseRequiredId(raw, name);
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

    /** Create body (OpenAPI {@code ReminderCreateRequest}). */
    public record ReminderCreateRequest(
            @NotBlank @Size(max = ReminderService.MAX_TEXT_LENGTH) String text,
            @NotNull String remindAt,
            String recurrence) {
    }

    /** Update body (OpenAPI {@code ReminderUpdateRequest}). */
    public record ReminderUpdateRequest(
            @NotBlank @Size(max = ReminderService.MAX_TEXT_LENGTH) String text,
            @NotNull String remindAt,
            @NotBlank String recurrence,
            @NotBlank String status) {
    }

    /** Response body (OpenAPI {@code Reminder}). */
    public record ReminderResponse(
            long reminderId,
            long relationshipId,
            String text,
            String remindAt,
            String recurrence,
            String status,
            String createdAt,
            String updatedAt) {
    }

    /** Delete result (OpenAPI {@code ReminderDeletedResponse}). */
    public record ReminderDeletedResponse(boolean ok) {
    }
}
