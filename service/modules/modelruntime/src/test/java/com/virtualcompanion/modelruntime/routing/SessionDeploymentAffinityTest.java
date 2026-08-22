package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import com.virtualcompanion.modelruntime.routing.SessionDeploymentAffinity;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * §12.8 会话模型粘滞 store: last success wins, unknown conversations are
 * sticky-free, and a blank conversation id is rejected.
 */
class SessionDeploymentAffinityTest {

    @Test
    void lastSuccessfulDeploymentWins() {
        SessionDeploymentAffinity affinity = new SessionDeploymentAffinity();
        affinity.record("conv-1", new ProviderId("alpha"));
        affinity.record("conv-1", new ProviderId("bravo"));

        assertEquals(java.util.Optional.of(new ProviderId("bravo")), affinity.sticky("conv-1"));
    }

    @Test
    void conversationsAreIsolatedAndUnknownIsEmpty() {
        SessionDeploymentAffinity affinity = new SessionDeploymentAffinity();
        affinity.record("conv-1", new ProviderId("alpha"));

        assertEquals(java.util.Optional.of(new ProviderId("alpha")), affinity.sticky("conv-1"));
        assertTrue(affinity.sticky("conv-2").isEmpty());
        assertTrue(affinity.sticky(null).isEmpty());
    }

    @Test
    void blankConversationIdIsRejected() {
        SessionDeploymentAffinity affinity = new SessionDeploymentAffinity();
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalArgumentException.class,
                () -> affinity.record(" ", new ProviderId("alpha")));
    }
}
