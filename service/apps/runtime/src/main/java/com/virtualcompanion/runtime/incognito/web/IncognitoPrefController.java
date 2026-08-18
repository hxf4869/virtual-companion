package com.virtualcompanion.runtime.incognito.web;

import com.virtualcompanion.platform.persistence.IncognitoPrefService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * INC-PREF (FR-CHAT-005): account default for the next new conversation's
 * incognito flag. The flag on an existing conversation stays frozen.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class IncognitoPrefController {

    private final IncognitoPrefService incognitoPrefService;

    public IncognitoPrefController(IncognitoPrefService incognitoPrefService) {
        this.incognitoPrefService = incognitoPrefService;
    }

    @GetMapping("/incognito-pref")
    public IncognitoPrefResponse get(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return new IncognitoPrefResponse(incognitoPrefService.get(ownerUserId));
    }

    @PutMapping("/incognito-pref")
    public IncognitoPrefResponse update(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @Valid @RequestBody IncognitoPrefUpdateRequest request) {
        return new IncognitoPrefResponse(
                incognitoPrefService.update(ownerUserId, request.defaultIncognito()));
    }

    public record IncognitoPrefUpdateRequest(@NotNull Boolean defaultIncognito) {
    }

    public record IncognitoPrefResponse(boolean defaultIncognito) {
    }
}
