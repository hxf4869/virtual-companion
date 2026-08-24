package com.virtualcompanion.runtime.auth.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class AccountDeletionCancellationPollerTest {

    @Test
    void consumesDurableTargetsAndSignalsThisInstanceRegistry() {
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        ActiveInvocationRegistry registry = mock(ActiveInvocationRegistry.class);
        OwnerContext owners = mock(OwnerContext.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<ActiveInvocationRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        when(intents.cancellationTargets(64)).thenReturn(List.of(7L));
        when(registry.cancelOwner(7L)).thenReturn(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));

        new AccountDeletionCancellationPoller(intents, provider, owners).poll();

        verify(registry).cancelOwner(7L);
        verify(intents).recordCancelSignalsCurrent(7L, 1);
    }

    @Test
    void doesNotReadCrossOwnerTargetsWhenProviderRuntimeIsAbsent() {
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<ActiveInvocationRegistry> provider = mock(ObjectProvider.class);

        new AccountDeletionCancellationPoller(
                intents, provider, mock(OwnerContext.class)).poll();

        verify(intents, never()).cancellationTargets(64);
    }
}
