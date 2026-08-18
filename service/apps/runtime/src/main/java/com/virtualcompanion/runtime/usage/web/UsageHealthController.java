package com.virtualcompanion.runtime.usage.web;

import com.virtualcompanion.platform.persistence.UsageHealthService;
import com.virtualcompanion.platform.persistence.UsageHealthService.UsageHealthStatus;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Continuous-use reminder HTTP API (USAGE-HEALTH / §20.7 / 21.3.3).
 *
 * <p>{@code GET /api/v1/usage-health} is read-only and does not extend the
 * session. {@code PUT} replaces approved prefs (60/90/120/180 and 15/30/45).
 * {@code POST .../heartbeat} is the mutating assist the client sends while
 * the chat page is open. {@code POST .../reminder} records SHOWN / CONTINUED
 * / ENDED. The reminder is a system-layer fact, never role-played.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class UsageHealthController {

    private final UsageHealthService usageHealthService;

    public UsageHealthController(UsageHealthService usageHealthService) {
        this.usageHealthService = usageHealthService;
    }

    @GetMapping("/usage-health")
    public UsageHealthStatusResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return toResponse(usageHealthService.get(ownerUserId));
    }

    @PutMapping("/usage-health")
    public UsageHealthStatusResponse updatePrefs(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody UsageHealthPrefsUpdateRequest request) {
        return toResponse(usageHealthService.updatePrefs(
                ownerUserId,
                request.reminderAfterMinutes(),
                request.sessionGapMinutes()));
    }

    @PostMapping("/usage-health/heartbeat")
    public UsageHealthStatusResponse heartbeat(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return toResponse(usageHealthService.heartbeat(ownerUserId));
    }

    @PostMapping("/usage-health/reminder")
    public UsageHealthStatusResponse recordReminder(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody UsageReminderRequest request) {
        return toResponse(usageHealthService.recordReminder(ownerUserId, request.result()));
    }

    private static UsageHealthStatusResponse toResponse(UsageHealthStatus status) {
        return new UsageHealthStatusResponse(
                status.reminderAfterMinutes(),
                status.sessionGapMinutes(),
                status.continuousMinutes(),
                status.reminderDue(),
                status.sessionStartedAt() == null ? null : status.sessionStartedAt().toString());
    }

    /** PUT body (OpenAPI {@code UsageHealthPrefsUpdate}). */
    public record UsageHealthPrefsUpdateRequest(
            @NotNull Integer reminderAfterMinutes,
            @NotNull Integer sessionGapMinutes) {
    }

    /** POST /reminder body (OpenAPI {@code UsageReminderRequest}). */
    public record UsageReminderRequest(@NotBlank String result) {
    }

    /** Status body (OpenAPI {@code UsageHealthStatus}). */
    public record UsageHealthStatusResponse(
            int reminderAfterMinutes,
            int sessionGapMinutes,
            int continuousMinutes,
            boolean reminderDue,
            String sessionStartedAt) {
    }
}
