package com.virtualcompanion.runtime.modelproviders;

import com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard;
import com.virtualcompanion.modelruntime.authorization.InMemoryAuthorizationSnapshotStore;
import com.virtualcompanion.modelruntime.execution.AdapterLocator;
import com.virtualcompanion.modelruntime.execution.InMemoryAdapterLocator;
import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import com.virtualcompanion.modelruntime.routing.DeterministicRouter;
import com.virtualcompanion.modelruntime.routing.GenerationRecovery;
import com.virtualcompanion.modelruntime.routing.QuotaLedger;
import com.virtualcompanion.modelruntime.registry.InMemoryProviderRegistry;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * ZERO_LLM-only wiring of the live model runtime (TASK-0176).
 *
 * <p>Active only when {@code virtual-companion.zero-llm.enabled=true} <em>and</em>
 * {@code virtual-companion.model-providers.enabled} is not {@code true}. This keeps
 * the arrangement mutually exclusive with {@link ApprovedModelProviderConfig}: when
 * real providers are enabled they own the {@code LiveModelInvoker} bean, and when
 * they are disabled but the ZERO_LLM path is opted in, this config wires a
 * {@code LiveModelInvoker} whose only reachable branch is the deterministic
 * ZERO_LLM completion. The router never enters the external-attempt branch
 * because the assembler binds {@code ServiceClass.zeroLlmOnly()} (external
 * attempts forbidden), so the empty registry, empty adapter locator and absent
 * authorization snapshots are never consulted.
 *
 * <p>The {@code modelruntime} module is a plain library with no Spring beans of
 * its own; every collaborator below is a public main-scope type instantiated with
 * an empty/no-op state. On the ZERO_LLM branch {@code LiveModelInvoker.invoke}
 * touches only {@code router.decide} + {@code recovery.completeZeroLlm}; it never
 * reads the adapter locator, authorization guard, snapshot store or supplier map,
 * so the empty wiring is sufficient and fail-closed (any external path would
 * throw because no adapter/snapshot exists).
 */
@Configuration
@ConditionalOnExpression(
        "'${virtual-companion.zero-llm.enabled:false}' == 'true' "
                + "and '${virtual-companion.model-providers.enabled:false}' != 'true'")
public class ZeroLlmModelRuntimeConfig {

    /**
     * A {@code LiveModelInvoker} whose only reachable terminal is the ZERO_LLM
     * deterministic completion. All external-attempt collaborators are empty so
     * the bean constructs without a real provider deployment, credential or
     * adapter; they are never reached because the ZERO_LLM request uses
     * {@code ServiceClass.zeroLlmOnly()}.
     */
    @Bean
    public LiveModelInvoker liveModelInvoker() {
        InMemoryProviderRegistry registry = new InMemoryProviderRegistry();
        QuotaLedger quotaLedger = new QuotaLedger();
        InMemoryAuthorizationSnapshotStore snapshotStore =
                new InMemoryAuthorizationSnapshotStore();
        ExecutionAuthorizationGuard authorizationGuard =
                new ExecutionAuthorizationGuard(snapshotStore, registry);
        DeterministicRouter router = new DeterministicRouter(registry, quotaLedger);
        GenerationRecovery recovery = new GenerationRecovery(quotaLedger);
        AdapterLocator adapterLocator = new InMemoryAdapterLocator(java.util.List.of());
        return new LiveModelInvoker(
                router,
                authorizationGuard,
                snapshotStore,
                adapterLocator,
                recovery,
                Map.of());
    }
}
