package com.virtualcompanion.runtime.modelproviders;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.execution.LiveModelInvoker;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;

/**
 * With the master switch off (the default), the runtime wires no live model
 * provider beans: no approved providers, no invoker, no outbound surface —
 * every external attempt fails closed at routing.
 */
@SpringBootTest
class ApprovedModelProviderDisabledTest {

    @Autowired
    private ApplicationContext context;

    @Test
    void noLiveModelProviderBeansWhenDisabled() {
        assertTrue(context.getBeanProvider(ApprovedModelProviders.class).getIfAvailable() == null,
                "no approved provider set may exist when disabled");
        assertTrue(context.getBeanProvider(LiveModelInvoker.class).getIfAvailable() == null,
                "no live model invoker may exist when disabled");
        assertFalse(context.getBeanProvider(ModelProviderProperties.class).getIfAvailable() == null,
                "the configuration properties bean is always bound");
    }
}
