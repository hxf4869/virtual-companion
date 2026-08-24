package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.ObjectProvider;

/** Commits the durable delete intent before signalling process-local providers. */
public final class AccountDeletionCoordinator {

    private final OwnerContext ownerContext;
    private final AccountDeletionIntentService intents;
    private final ObjectProvider<ActiveInvocationRegistry> activeInvocations;

    public AccountDeletionCoordinator(
            OwnerContext ownerContext,
            AccountDeletionIntentService intents,
            ObjectProvider<ActiveInvocationRegistry> activeInvocations) {
        this.ownerContext = Objects.requireNonNull(ownerContext, "ownerContext must not be null");
        this.intents = Objects.requireNonNull(intents, "intents must not be null");
        this.activeInvocations = Objects.requireNonNull(
                activeInvocations, "activeInvocations must not be null");
    }

    public int prepare(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        AtomicBoolean requested = new AtomicBoolean();
        ownerContext.asOwnerRequiresNew(
                ownerUserId,
                () -> requested.set(intents.requestCurrent(ownerUserId)));
        if (!requested.get()) {
            throw new IllegalStateException("account deletion intent was not accepted");
        }
        ActiveInvocationRegistry registry = activeInvocations.getIfAvailable();
        int signalled = registry == null ? 0 : registry.cancelOwner(ownerUserId);
        ownerContext.asOwnerRequiresNew(
                ownerUserId,
                () -> intents.recordCancelSignalsCurrent(ownerUserId, signalled));
        return signalled;
    }
}
