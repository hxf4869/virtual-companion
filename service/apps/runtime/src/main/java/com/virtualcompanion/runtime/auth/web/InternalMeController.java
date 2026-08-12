package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * P1-04 owner-injection test harness (TASK-0168). A protected endpoint that
 * echoes the server-verified principal's accountId (= owner_user_id) so the
 * {@code JwtAuthenticationFilter -> OwnerInjectionFilter -> controller} wiring
 * is observable without a business controller. It sits under
 * {@code /api/internal/**} (like {@link BaselineController}) and is
 * intentionally NOT registered in the OpenAPI contract source (which
 * enumerates only {@code /api/v1/**}).
 *
 * <p>Active whenever auth is enabled; the {@code vc.owner_user_id} GUC itself
 * is bound upstream by {@link com.virtualcompanion.runtime.auth.tenant.OwnerInjectionFilter}
 * only when a DataSource is also wired. The identity always comes from the
 * server-verified principal, never from a request field.
 */
@RestController
@RequestMapping("/api/internal/me")
@ConditionalOnProperty(name = "virtual-companion.auth.enabled", havingValue = "true")
public class InternalMeController {

    @GetMapping
    public Map<String, Object> me(@AuthenticationPrincipal JwtTokenService.Principal principal) {
        return Map.of("ownerUserId", principal.accountId(), "role", principal.role());
    }
}
