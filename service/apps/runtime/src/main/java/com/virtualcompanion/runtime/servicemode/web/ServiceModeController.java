package com.virtualcompanion.runtime.servicemode.web;

import com.virtualcompanion.runtime.servicemode.ServiceModeService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Service-mode HTTP API (SVC-MODE / FR-RES-005).
 *
 * <p>{@code GET /api/v1/service-mode} returns the current generation-service
 * mode for the authenticated caller. The mode is an ops fact — the client must
 * display it plainly (FULL_AI / ZERO_LLM) and never role-play an outage. The
 * endpoint is authenticated so the state is scoped to real callers rather than
 * public probing.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ServiceModeController {

    private final ServiceModeService serviceModeService;

    public ServiceModeController(ServiceModeService serviceModeService) {
        this.serviceModeService = serviceModeService;
    }

    @GetMapping("/service-mode")
    public ServiceModeStatusResponse getServiceMode(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        ServiceModeService.Status status = serviceModeService.current(ownerUserId);
        return new ServiceModeStatusResponse(status.mode(), status.summary());
    }

    /** Response body (OpenAPI {@code ServiceModeStatus}). */
    public record ServiceModeStatusResponse(String mode, String summary) {
    }
}
