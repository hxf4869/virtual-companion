package com.virtualcompanion.runtime.auth.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class AccountDeletionCoordinatorTest {

    @Test
    void commitsIntentBeforeSignallingAndAuditsSignalCount() {
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        ActiveInvocationRegistry registry = mock(ActiveInvocationRegistry.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<ActiveInvocationRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        when(intents.requestCurrent(7L)).thenReturn(true);
        when(registry.cancelOwner(7L)).thenReturn(2);
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));

        int signalled = new AccountDeletionCoordinator(owners, intents, provider).prepare(7L);

        assertEquals(2, signalled);
        var order = inOrder(owners, intents, registry);
        order.verify(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));
        order.verify(intents).requestCurrent(7L);
        order.verify(registry).cancelOwner(7L);
        order.verify(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));
        order.verify(intents).recordCancelSignalsCurrent(7L, 2);
    }
}
