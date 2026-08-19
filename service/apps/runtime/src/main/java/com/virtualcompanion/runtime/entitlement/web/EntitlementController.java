package com.virtualcompanion.runtime.entitlement.web;

import com.virtualcompanion.platform.persistence.TrialService;
import java.util.Optional;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * ENT-TRIAL (V61 / FR-ENT-005): the caller's live simulated-trial state.
 *
 * <p>A trial is an ADMIN-granted PREMIUM turn budget with an expiry; the mint
 * consumes one turn per NEW generation. When no trial is live the response
 * says so plainly — the account keeps its ADMIN-assigned class (or ECONOMY);
 * a spent or expired trial never removes chats, memories or relationships
 * (试用结束不删除).
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class EntitlementController {

    private final TrialService trialService;

    public EntitlementController(TrialService trialService) {
        this.trialService = trialService;
    }

    /** The caller's live trial (active=false when none is running). */
    @GetMapping("/trial-status")
    public TrialStatusResponse status(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        Optional<TrialService.TrialStatus> trial = trialService.status(ownerUserId);
        if (trial.isEmpty()) {
            return new TrialStatusResponse(false, null, null);
        }
        return new TrialStatusResponse(
                true,
                trial.get().remainingTurns(),
                trial.get().expiresAt().toString());
    }

    /** Trial status body. */
    public record TrialStatusResponse(
            boolean active, Integer remainingTurns, String expiresAt) {
    }
}
