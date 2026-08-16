package com.virtualcompanion.runtime.consent.web;

import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Versioned consent HTTP API (CONSENT / FR-AUTH-003).
 *
 * <p>{@code PUT /api/v1/consents} appends a versioned grant/revoke record;
 * {@code GET /api/v1/consents} returns the effective latest row per type. The
 * append-only history stays in the database; unapproved consent types map to
 * 400 INVALID_REQUEST via the eager normalizer. Withdrawing MODEL_TRAINING
 * never affects basic chat service.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class ConsentController {

    private final ConsentService consentService;

    public ConsentController(ConsentService consentService) {
        this.consentService = consentService;
    }

    @PutMapping("/consents")
    public ConsentResponse record(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody ConsentUpsertRequest request) {
        // FR-AUTH-003: eager validation rejects unapproved types with a 400.
        String consentType = ConsentService.normalizeConsentType(request.consentType());
        long id = consentService.record(
                ownerUserId, consentType, request.version(), request.granted());
        ConsentRecord record = consentService.findLatestByType(ownerUserId, consentType)
                .orElseThrow(() -> new ResourceNotFoundException("consent"));
        return toResponse(record);
    }

    @GetMapping("/consents")
    public List<ConsentResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return consentService.list(ownerUserId).stream()
                .map(ConsentController::toResponse)
                .toList();
    }

    private static ConsentResponse toResponse(ConsentRecord record) {
        return new ConsentResponse(
                record.id(),
                record.consentType(),
                record.version(),
                record.granted(),
                record.grantedAt().toString(),
                record.revokedAt() == null ? null : record.revokedAt().toString());
    }

    /** Upsert body (OpenAPI {@code ConsentUpsertRequest}). */
    public record ConsentUpsertRequest(
            @NotBlank String consentType,
            @NotBlank @Size(max = ConsentService.MAX_VERSION_LENGTH) String version,
            @NotNull Boolean granted) {
    }

    /** Response body (OpenAPI {@code ConsentRecord}). */
    public record ConsentResponse(
            long consentId,
            String consentType,
            String version,
            boolean granted,
            String grantedAt,
            String revokedAt) {
    }
}
