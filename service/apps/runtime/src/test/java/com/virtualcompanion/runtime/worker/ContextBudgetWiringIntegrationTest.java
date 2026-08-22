package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.virtualcompanion.conversation.contextplan.ContextBudget;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * S0-03 acceptance: after injecting {@code VC_CONTEXT_MAX_INPUT_TOKENS=4000}
 * the live {@link LiveInvocationAssembler} bean really carries a 4000-token
 * input budget (and the untouched output/turn defaults) — the exact wiring
 * that used to drift through the dead
 * {@code virtual-companion.generation.context-budget.*} path.
 *
 * <p>The assembler bean lives in {@code AuthDataSourceConfig}, which activates
 * only when auth AND its datasource are enabled; a lazy Hikari pool with a
 * fake local URL keeps the context database-free (same pattern as
 * ProductionProfileFailClosedTest).
 */
@SpringBootTest(properties = {
        "VC_CONTEXT_MAX_INPUT_TOKENS=4000",
        "virtual-companion.auth.enabled=true",
        "virtual-companion.auth.datasource-enabled=true",
        "virtual-companion.auth.jwt-secret=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "virtual-companion.auth.owner-binding-secret=0123456789abcdef0123456789abcdef0123456789abcdef",
        "virtual-companion.auth.datasource.url=jdbc:postgresql://127.0.0.1:5432/vc",
        "virtual-companion.auth.datasource.username=vc",
        "virtual-companion.auth.datasource.password=vc"
})
class ContextBudgetWiringIntegrationTest {

    @Autowired
    private ContextBudgetProperties properties;

    @Autowired
    private LiveInvocationAssembler assembler;

    @Test
    void deploymentVariableReachesThePropertiesBinding() {
        assertEquals(
                new ContextBudget(4_000, 2_048, 64),
                properties.toBudget());
    }

    @Test
    void wiredAssemblerCarriesTheDeploymentBudget() {
        // The assembler consumes exactly this budget when trimming history and
        // recall (consumption boundary tests: LiveInvocationAssemblerTest).
        assertEquals(
                new ContextBudget(4_000, 2_048, 64),
                assembler.budget());
    }
}
