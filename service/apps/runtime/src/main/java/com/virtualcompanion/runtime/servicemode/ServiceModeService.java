package com.virtualcompanion.runtime.servicemode;

import com.virtualcompanion.modelruntime.execution.BudgetGuard;
import com.virtualcompanion.modelruntime.execution.SupplierCircuitBreaker;
import com.virtualcompanion.platform.persistence.ReleaseGate;
import com.virtualcompanion.runtime.modelproviders.ApprovedModelProviders;
import com.virtualcompanion.runtime.modelproviders.ModelProviderProperties;
import java.time.Instant;
import java.util.Objects;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * S0-10C dynamic generation-service mode for the authenticated caller.
 *
 * <p>The result aggregates the same fail-closed sources that decide whether an
 * outbound can really happen: release/admission window, durable provider
 * eligibility, monthly budget and supplier circuit health. Missing authority
 * reads never produce FULL_AI. Copy stays operational and never role-plays an
 * outage (FR-RES-005).
 */
@Service
public class ServiceModeService {

    public static final String MODE_FULL_AI = "FULL_AI";
    public static final String MODE_ZERO_LLM = "ZERO_LLM";
    public static final String MODE_DEGRADED_AI = "DEGRADED_AI";
    public static final String MODE_MAINTENANCE = "MAINTENANCE";

    private final ModelProviderProperties properties;
    private final ObjectProvider<SupplierCircuitBreaker> circuitBreaker;
    private final ObjectProvider<ApprovedModelProviders> approvedProviders;
    private final ObjectProvider<BudgetGuard> budgetGuard;
    private final ObjectProvider<ReleaseGate> releaseGate;
    private final ObjectProvider<BetaServiceWindow> serviceWindow;
    private final boolean betaGenerationEnabled;
    private final boolean zeroLlmEnabled;

    public ServiceModeService(ModelProviderProperties properties) {
        this(properties, null);
    }

    public ServiceModeService(
            ModelProviderProperties properties,
            ObjectProvider<SupplierCircuitBreaker> circuitBreaker) {
        this(properties, circuitBreaker, null, null, null, null, true, true);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ServiceModeService(
            ModelProviderProperties properties,
            ObjectProvider<SupplierCircuitBreaker> circuitBreaker,
            ObjectProvider<ApprovedModelProviders> approvedProviders,
            ObjectProvider<BudgetGuard> budgetGuard,
            ObjectProvider<ReleaseGate> releaseGate,
            ObjectProvider<BetaServiceWindow> serviceWindow,
            @Value("${virtual-companion.beta.generation-enabled:false}")
            boolean betaGenerationEnabled,
            @Value("${virtual-companion.zero-llm.enabled:false}")
            boolean zeroLlmEnabled) {
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.circuitBreaker = circuitBreaker;
        this.approvedProviders = approvedProviders;
        this.budgetGuard = budgetGuard;
        this.releaseGate = releaseGate;
        this.serviceWindow = serviceWindow;
        this.betaGenerationEnabled = betaGenerationEnabled;
        this.zeroLlmEnabled = zeroLlmEnabled;
    }

    /** Compatibility/global view for non-controller callers without an owner. */
    public Status current() {
        return current(1L);
    }

    /** The owner-aware mode exposed by GET /service-mode. */
    public Status current(long ownerUserId) {
        BetaServiceWindow window = available(serviceWindow);
        if (window != null && window.enabled()) {
            if (window.paused()) {
                return maintenance("当前生成服务已由运营暂停；历史、记忆和数据权利仍可使用");
            }
            if (window.rejectReason(Instant.now(), 0, true)
                    .filter("outside-generation-window"::equals).isPresent()) {
                return maintenance("当前不在生成服务时段；历史、记忆和数据权利仍可使用");
            }
        }

        ReleaseGate gate = available(releaseGate);
        if (gate != null) {
            if (!betaGenerationEnabled) {
                return maintenance("当前未开放新的生成请求；历史、记忆和数据权利仍可使用");
            }
            try {
                if (!gate.allowsGenerationFor(ownerUserId)) {
                    return maintenance("当前账号未进入生成放行范围；历史、记忆和数据权利仍可使用");
                }
            } catch (RuntimeException authorityFailure) {
                return maintenance("生成门禁状态暂时不可读取；已按不可用处理");
            }
        }

        if (!properties.enabled()) {
            return noExternalAi("当前为无生成模型的受限服务：消息会保存为记录，可查看历史和记忆中心");
        }

        BudgetGuard budget = available(budgetGuard);
        try {
            if (budget != null && budget.exceeded()) {
                return noExternalAi("当前模型费用门禁已停止外发：消息会保存为记录，可查看历史和记忆中心");
            }
        } catch (RuntimeException budgetReadFailure) {
            return noExternalAi("当前费用状态不可读取，模型外发已按停止处理");
        }

        ApprovedModelProviders providers = available(approvedProviders);
        if (providers != null) {
            try {
                boolean admitted = providers.registry().deployments().stream()
                        .anyMatch(deployment -> deployment.isAdmitted());
                if (!admitted) {
                    return noExternalAi("当前没有已准入的模型部署：消息会保存为记录，可查看历史和记忆中心");
                }
            } catch (RuntimeException registryFailure) {
                return noExternalAi("当前模型准入状态不可读取，外发已按停止处理");
            }
        }

        SupplierCircuitBreaker breaker = available(circuitBreaker);
        if (breaker != null && breaker.allTrackedSuppliersBlocked()) {
            return noExternalAi("当前模型供应商均不可用：消息会保存为记录，可查看历史和记忆中心");
        }
        if (properties.degraded() || (breaker != null && breaker.anySupplierBlocked())) {
            return new Status(MODE_DEGRADED_AI,
                    "当前以较低服务等级运行（降级）：可以继续对话，质量可能低于正常水平");
        }
        return new Status(MODE_FULL_AI, "正常模型服务");
    }

    private Status noExternalAi(String zeroSummary) {
        return zeroLlmEnabled
                ? new Status(MODE_ZERO_LLM, zeroSummary)
                : maintenance("当前生成服务不可用；历史、记忆和数据权利仍可使用");
    }

    private static Status maintenance(String summary) {
        return new Status(MODE_MAINTENANCE, summary);
    }

    private static <T> T available(ObjectProvider<T> provider) {
        return provider == null ? null : provider.getIfAvailable();
    }

    /** Wire status (OpenAPI {@code ServiceModeStatus}). */
    public record Status(String mode, String summary) {
        public Status {
            Objects.requireNonNull(mode, "mode must not be null");
            if (mode.isBlank()) {
                throw new IllegalArgumentException("mode must not be blank");
            }
            Objects.requireNonNull(summary, "summary must not be null");
            if (summary.isBlank()) {
                throw new IllegalArgumentException("summary must not be blank");
            }
        }
    }
}
