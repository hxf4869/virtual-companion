package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.observability.ProviderPlanMonitor;
import com.virtualcompanion.runtime.observability.ProviderPlanStatus;
import java.util.Objects;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * DOGFOOD-05 (ADR-0006 §3.3): ADMIN-only provider-plan status endpoint.
 *
 * <p>Returns the derived plan state (VALID / UNKNOWN / DISABLED) plus the
 * operator-supplied plan facts carried verbatim — a cap that the private
 * configuration does not state stays {@code null} and is never reported as
 * zero, and {@code monthCostUsd} carries the real settled month-to-date spend
 * (or {@code null} when no usage source is available) — nothing is fabricated
 * on top. The UNKNOWN alerting side effect (once per day) rides on the same
 * read.</p>
 */
@RestController
@RequestMapping("/api/v1/auth/admin")
@ConditionalOnProperty(name = "virtual-companion.auth.datasource-enabled", havingValue = "true")
public class AdminProviderPlanController {

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String MONTH_SPEND_SQL = "SELECT vc.month_cost_spend()";

    private final ProviderPlanMonitor planMonitor;
    private final ObjectProvider<JdbcTemplate> jdbcTemplate;

    public AdminProviderPlanController(
            ProviderPlanMonitor planMonitor,
            ObjectProvider<JdbcTemplate> jdbcTemplate) {
        this.planMonitor = Objects.requireNonNull(planMonitor, "planMonitor must not be null");
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate, "jdbcTemplate must not be null");
    }

    @GetMapping("/provider-plan")
    public ProviderPlanResponse providerPlan(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        if (principal == null || !ROLE_ADMIN.equals(principal.role())) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "ADMIN role is required");
        }
        ProviderPlanStatus status = planMonitor.evaluateAndAlert();
        return new ProviderPlanResponse(
                status.state().name(),
                status.reason().name(),
                status.planName(),
                status.validFrom() == null ? null : status.validFrom().toString(),
                status.validUntil() == null ? null : status.validUntil().toString(),
                status.tokenCap(),
                status.requestCap(),
                monthCostUsd());
    }

    /**
     * Real settled month-to-date spend, or {@code null} when no usage source
     * is wired or the query fails — never a fabricated substitute value.
     */
    private Double monthCostUsd() {
        JdbcTemplate template = jdbcTemplate.getIfAvailable();
        if (template == null) {
            return null;
        }
        try {
            Double spend = template.queryForObject(MONTH_SPEND_SQL, Double.class);
            return spend == null ? null : spend;
        } catch (DataAccessException failure) {
            return null;
        }
    }

    /**
     * @param status      VALID | UNKNOWN | DISABLED
     * @param reason      fixed machine reason code for the state
     * @param planName    operator-supplied plan label (nullable)
     * @param validFrom   ISO-8601 date or null when unstated
     * @param validUntil  ISO-8601 date or null when unstated
     * @param tokenCap    stated token cap or null (never zero-substituted)
     * @param requestCap  stated request cap or null (never zero-substituted)
     * @param monthCostUsd real settled month-to-date USD spend, or null when
     *                    no usage data is available (never fabricated)
     */
    public record ProviderPlanResponse(
            String status,
            String reason,
            String planName,
            String validFrom,
            String validUntil,
            Long tokenCap,
            Long requestCap,
            Double monthCostUsd) {
    }
}
