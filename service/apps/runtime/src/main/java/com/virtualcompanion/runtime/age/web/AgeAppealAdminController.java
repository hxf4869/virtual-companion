package com.virtualcompanion.runtime.age.web;

import com.virtualcompanion.platform.persistence.AgeAppealService;
import org.springframework.dao.DataAccessException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** S0-12 human-only appeal disposition. SQL rechecks ADMIN/PRIVACY_OPERATOR. */
@RestController
@RequestMapping("/api/v1/auth/admin/age-appeals")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class AgeAppealAdminController {

    private final AgeAppealService appeals;

    public AgeAppealAdminController(AgeAppealService appeals) {
        this.appeals = appeals;
    }

    @PostMapping("/{appealId}/resolve")
    public ResolutionResponse resolve(
            @AuthenticationPrincipal(expression = "accountId") long actingAccountId,
            @PathVariable String appealId,
            @RequestBody ResolutionRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request is required");
        }
        long id;
        try {
            id = Long.parseLong(appealId);
        } catch (NumberFormatException invalid) {
            throw new IllegalArgumentException("appealId is invalid", invalid);
        }
        AgeAppealService.Resolution result;
        try {
            result = appeals.resolve(
                    actingAccountId, id, request.decision(), request.resolutionNote());
        } catch (DataAccessException failure) {
            if (hasMessage(failure, "mutation denied")) {
                throw new AccessDeniedException("age appeal review role required");
            }
            if (hasMessage(failure, "resolve_age_appeal:")) {
                throw new IllegalArgumentException(
                        "the age appeal cannot be resolved in its current state");
            }
            throw failure;
        }
        return new ResolutionResponse(
                Long.toString(result.appealId()),
                result.decision(),
                result.ageState(),
                result.resolvedAt().toString());
    }

    private static boolean hasMessage(Throwable failure, String marker) {
        for (Throwable current = failure; current != null; current = current.getCause()) {
            if (current.getMessage() != null && current.getMessage().contains(marker)) {
                return true;
            }
        }
        return false;
    }

    public record ResolutionRequest(String decision, String resolutionNote) {}

    public record ResolutionResponse(
            String appealId, String decision, String ageState, String resolvedAt) {}
}
