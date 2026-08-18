package com.virtualcompanion.runtime.relationship.web;

import com.virtualcompanion.catalog.CompanionAdvicePref;
import com.virtualcompanion.catalog.CompanionAvatar;
import com.virtualcompanion.catalog.CompanionAvoidTopic;
import com.virtualcompanion.catalog.CompanionGender;
import com.virtualcompanion.catalog.CompanionHumor;
import com.virtualcompanion.catalog.CompanionInitiative;
import com.virtualcompanion.catalog.CompanionReplyLength;
import com.virtualcompanion.catalog.PersonaTemplate;
import com.virtualcompanion.conversation.contextplan.CompanionPreferenceInstructions;
import com.virtualcompanion.platform.persistence.CompanionPrefs;
import com.virtualcompanion.platform.persistence.RelationshipClearancePreview;
import com.virtualcompanion.platform.persistence.RelationshipRecord;
import com.virtualcompanion.platform.persistence.RelationshipService;
import com.virtualcompanion.runtime.web.ResourceNotFoundException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.ArrayList;
import java.util.LinkedHashSet;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * Relationship HTTP API (TASK-0178). Implements the OpenAPI relationship
 * endpoints backed by the V9 SECURITY DEFINER functions:
 * <ul>
 *   <li>{@code POST /api/v1/relationships} — create a Companion relationship
 *       (becomes the single active Companion; any prior active is deactivated);</li>
 *   <li>{@code GET /api/v1/relationships} — list the caller's relationships;</li>
 *   <li>{@code GET /api/v1/relationships/{relationshipId}} — fetch one;</li>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}} — activate one
 *       (deactivates the others);</li>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}/deactivate} —
 *       deactivate one (zero active Companions permitted);</li>
 *   <li>{@code PATCH /api/v1/relationships/{relationshipId}} — replace
 *       structured Companion preferences (COMP-CFG / FR-COMP-003);</li>
 *   <li>{@code GET /api/v1/relationships/{relationshipId}/clearance-preview} —
 *       factual counts of conversations, memories and reminders a reset or
 *       delete would clear (FR-COMP-004);</li>
 *   <li>{@code POST /api/v1/relationships/{relationshipId}/reset} — clear
 *       the relationship domain and keep the Companion row + prefs;</li>
 *   <li>{@code DELETE /api/v1/relationships/{relationshipId}} — remove the
 *       Companion and cascade its relationship-domain data.</li>
 * </ul>
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC is
 * bound upstream by the owner-injection filter so every V9 call runs in the
 * server-trusted tenant context. A foreign or absent relationship id maps to
 * 404 {@code NOT_FOUND_OR_FORBIDDEN} so existence is never disclosed.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class RelationshipController {

    private final RelationshipService relationshipService;

    public RelationshipController(RelationshipService relationshipService) {
        this.relationshipService = relationshipService;
    }

    @PostMapping("/relationships")
    public RelationshipResponse create(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody CreateRelationshipRequest request) {
        // PERSONA-WIRE: personaRef must be a persona-templates catalog id;
        // a free-form string would silently bind a relationship to no persona.
        if (!isKnownPersona(request.personaRef())) {
            throw new IllegalArgumentException(
                    "personaRef is not a known persona template: " + request.personaRef());
        }
        long id = relationshipService.create(ownerUserId, request.personaRef());
        RelationshipRecord record = relationshipService
                .get(ownerUserId, id)
                .orElseThrow(() -> new IllegalStateException(
                        "relationship " + id + " not found after create"));
        return toResponse(record);
    }

    @GetMapping("/relationships")
    public List<RelationshipResponse> list(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return relationshipService.list(ownerUserId).stream()
                .map(RelationshipController::toResponse)
                .toList();
    }

    @GetMapping("/relationships/{relationshipId}")
    public RelationshipResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.get(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PostMapping("/relationships/{relationshipId}")
    public RelationshipResponse activate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.activate(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PostMapping("/relationships/{relationshipId}/deactivate")
    public RelationshipResponse deactivate(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.deactivate(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PatchMapping("/relationships/{relationshipId}")
    public RelationshipResponse updatePrefs(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId,
            @Valid @RequestBody UpdatePrefsRequest request) {
        long id = parseId(relationshipId);
        CompanionPrefs prefs = toPrefs(request);
        return relationshipService.updatePrefs(ownerUserId, id, prefs)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @GetMapping("/relationships/{relationshipId}/clearance-preview")
    public ClearancePreviewResponse previewClearance(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.previewClearance(ownerUserId, id)
                .map(RelationshipController::toPreview)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @PostMapping("/relationships/{relationshipId}/reset")
    public RelationshipResponse reset(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        return relationshipService.reset(ownerUserId, id)
                .map(RelationshipController::toResponse)
                .orElseThrow(() -> new ResourceNotFoundException("relationship"));
    }

    @DeleteMapping("/relationships/{relationshipId}")
    public RelationshipDeletedResponse delete(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @PathVariable String relationshipId) {
        long id = parseId(relationshipId);
        if (!relationshipService.delete(ownerUserId, id)) {
            throw new ResourceNotFoundException("relationship");
        }
        return new RelationshipDeletedResponse(true);
    }

    private static long parseId(String raw) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("id is not valid: " + raw, e);
        }
    }

    /** PERSONA-WIRE: membership in the persona-templates catalog (generated enum). */
    private static boolean isKnownPersona(String personaRef) {
        for (PersonaTemplate template : PersonaTemplate.values()) {
            if (template.code().equals(personaRef)) {
                return true;
            }
        }
        return false;
    }

    private static CompanionPrefs toPrefs(UpdatePrefsRequest request) {
        CompanionPreferenceInstructions.requireKnown(
                "replyLength", request.replyLength(),
                catalogHas(CompanionReplyLength.values(), request.replyLength(), CompanionReplyLength::code));
        CompanionPreferenceInstructions.requireKnown(
                "initiative", request.initiative(),
                catalogHas(CompanionInitiative.values(), request.initiative(), CompanionInitiative::code));
        CompanionPreferenceInstructions.requireKnown(
                "humor", request.humor(),
                catalogHas(CompanionHumor.values(), request.humor(), CompanionHumor::code));
        CompanionPreferenceInstructions.requireKnown(
                "advicePref", request.advicePref(),
                catalogHas(CompanionAdvicePref.values(), request.advicePref(), CompanionAdvicePref::code));
        if (!"SESSION".equals(request.memoryShareScope())
                && !"RELATIONSHIP".equals(request.memoryShareScope())) {
            throw new IllegalArgumentException(
                    "memoryShareScope is not an Alpha-enabled memory scope: "
                            + request.memoryShareScope());
        }
        // COMP-PRES (FR-COMP-002): gender and avatarRef are approved catalog
        // codes; presentation never changes behavior, and avatars may only
        // reference platform-curated assets (no photo upload in v1).
        CompanionPreferenceInstructions.requireKnown(
                "gender", request.gender(),
                catalogHas(CompanionGender.values(), request.gender(), CompanionGender::code));
        CompanionPreferenceInstructions.requireKnown(
                "avatarRef", request.avatarRef(),
                catalogHas(CompanionAvatar.values(), request.avatarRef(), CompanionAvatar::code));
        String companionName = sanitizeOptionalLabel("companionName", request.companionName());
        String userAddressAs = sanitizeOptionalLabel("userAddressAs", request.userAddressAs());
        List<String> avoid = new ArrayList<>();
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        for (String code : request.avoidTopics() == null ? List.<String>of() : request.avoidTopics()) {
            if (!catalogHas(CompanionAvoidTopic.values(), code, CompanionAvoidTopic::code)) {
                throw new IllegalArgumentException("avoidTopics contains an unapproved code: " + code);
            }
            if (seen.add(code)) {
                avoid.add(code);
            }
        }
        return new CompanionPrefs(
                companionName,
                userAddressAs,
                request.replyLength(),
                request.initiative(),
                request.humor(),
                request.advicePref(),
                request.remindersAllowed(),
                request.memoryShareScope(),
                avoid,
                request.gender(),
                request.avatarRef());
    }

    private static String sanitizeOptionalLabel(String field, String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String sanitized = CompanionPreferenceInstructions.sanitizeLabel(raw);
        if (sanitized == null) {
            throw new IllegalArgumentException(field + " is not a valid display label");
        }
        return sanitized;
    }

    private static <E> boolean catalogHas(E[] values, String code, java.util.function.Function<E, String> codeOf) {
        if (code == null) {
            return false;
        }
        for (E value : values) {
            if (codeOf.apply(value).equals(code)) {
                return true;
            }
        }
        return false;
    }

    private static RelationshipResponse toResponse(RelationshipRecord record) {
        CompanionPrefs prefs = record.prefs();
        return new RelationshipResponse(
                record.id(),
                record.personaRef(),
                record.active(),
                record.createdAt() == null ? null : record.createdAt().toString(),
                prefs.companionName(),
                prefs.userAddressAs(),
                prefs.replyLength(),
                prefs.initiative(),
                prefs.humor(),
                prefs.advicePref(),
                prefs.remindersAllowed(),
                prefs.memoryShareScope(),
                prefs.avoidTopics(),
                prefs.gender(),
                prefs.avatarRef());
    }

    /** Request body (OpenAPI {@code RelationshipCreateRequest}). */
    public record CreateRelationshipRequest(
            @NotBlank @Size(max = 128) String personaRef) {
    }

    /** Request body (OpenAPI {@code RelationshipPrefsUpdate}). */
    public record UpdatePrefsRequest(
            @Size(max = 32) String companionName,
            @Size(max = 32) String userAddressAs,
            @NotBlank @Size(max = 32) String replyLength,
            @NotBlank @Size(max = 32) String initiative,
            @NotBlank @Size(max = 32) String humor,
            @NotBlank @Size(max = 32) String advicePref,
            @NotNull Boolean remindersAllowed,
            @NotBlank @Size(max = 32) String memoryShareScope,
            @NotNull List<String> avoidTopics,
            @NotBlank @Size(max = 32) String gender,
            @NotBlank @Size(max = 32) String avatarRef) {
    }

    /** Response body (OpenAPI {@code RelationshipClearancePreview}). */
    public record ClearancePreviewResponse(
            long relationshipId,
            long conversationCount,
            long memoryCount,
            long reminderCount) {
    }

    /** Response body (OpenAPI {@code RelationshipDeletedResponse}). */
    public record RelationshipDeletedResponse(boolean ok) {
    }

    private static ClearancePreviewResponse toPreview(RelationshipClearancePreview preview) {
        return new ClearancePreviewResponse(
                preview.relationshipId(),
                preview.conversationCount(),
                preview.memoryCount(),
                preview.reminderCount());
    }

    /** Response body (OpenAPI {@code Relationship}). */
    public record RelationshipResponse(
            long relationshipId,
            String personaRef,
            boolean active,
            String createdAt,
            String companionName,
            String userAddressAs,
            String replyLength,
            String initiative,
            String humor,
            String advicePref,
            boolean remindersAllowed,
            String memoryShareScope,
            List<String> avoidTopics,
            String gender,
            String avatarRef) {
    }
}
