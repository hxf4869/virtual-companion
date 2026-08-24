package com.virtualcompanion.runtime.retention;

import com.virtualcompanion.platform.persistence.RetentionLegalHoldService;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** S0-17 legal-hold mutations; SQL rechecks active ADMIN/PRIVACY_OPERATOR. */
@RestController
@RequestMapping("/api/v1/auth/admin/retention-holds")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class RetentionAdminController {

    private final RetentionLegalHoldService holds;

    public RetentionAdminController(RetentionLegalHoldService holds) {
        this.holds = holds;
    }

    @PostMapping
    public HoldResponse set(
            @AuthenticationPrincipal(expression = "accountId") long actingAccountId,
            @RequestBody HoldRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request is required");
        }
        long ownerUserId = parsePositive(request.ownerUserId(), "ownerUserId");
        try {
            long id = holds.set(
                    actingAccountId, ownerUserId, request.category(), request.reasonCode());
            return new HoldResponse(Long.toString(id), "ACTIVE");
        } catch (DataAccessException failure) {
            throw mapped(failure);
        }
    }

    @DeleteMapping("/{holdId}")
    public ReleaseResponse release(
            @AuthenticationPrincipal(expression = "accountId") long actingAccountId,
            @PathVariable String holdId) {
        long id = parsePositive(holdId, "holdId");
        try {
            return new ReleaseResponse(holds.release(actingAccountId, id));
        } catch (DataAccessException failure) {
            throw mapped(failure);
        }
    }

    private static RuntimeException mapped(DataAccessException failure) {
        boolean knownRejection = false;
        for (Throwable current = failure; current != null; current = current.getCause()) {
            String message = current.getMessage();
            if (message != null && message.contains("mutation denied")) {
                return new AccessDeniedException("retention legal-hold role required");
            }
            if (message != null && (message.contains("set_retention_legal_hold_current:")
                    || message.contains("release_retention_legal_hold_current:"))) {
                knownRejection = true;
            }
        }
        return knownRejection
                ? new IllegalArgumentException("retention legal-hold request rejected")
                : failure;
    }

    private static long parsePositive(String raw, String name) {
        try {
            long value = Long.parseLong(raw);
            if (value > 0) return value;
        } catch (RuntimeException invalid) {
            // Uniform invalid request below.
        }
        throw new IllegalArgumentException(name + " is invalid");
    }

    public record HoldRequest(String ownerUserId, String category, String reasonCode) {}

    public record HoldResponse(String holdId, String status) {}

    public record ReleaseResponse(boolean released) {}
}
