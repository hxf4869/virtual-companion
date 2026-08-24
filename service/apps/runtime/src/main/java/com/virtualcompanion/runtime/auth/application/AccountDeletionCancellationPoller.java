package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;

/** Cross-instance cooperative cancellation consumer for durable delete intents. */
public final class AccountDeletionCancellationPoller {

    private static final Logger log = LoggerFactory.getLogger(
            AccountDeletionCancellationPoller.class);

    private final AccountDeletionIntentService intents;
    private final ObjectProvider<ActiveInvocationRegistry> activeInvocations;
    private final OwnerContext ownerContext;

    public AccountDeletionCancellationPoller(
            AccountDeletionIntentService intents,
            ObjectProvider<ActiveInvocationRegistry> activeInvocations,
            OwnerContext ownerContext) {
        this.intents = intents;
        this.activeInvocations = activeInvocations;
        this.ownerContext = ownerContext;
    }

    @Scheduled(fixedDelayString = "${virtual-companion.auth.deletion-cancel-poll-ms:250}")
    public void poll() {
        ActiveInvocationRegistry registry = activeInvocations.getIfAvailable();
        if (registry == null) {
            return;
        }
        try {
            for (long ownerUserId : intents.cancellationTargets(64)) {
                int signalled = registry.cancelOwner(ownerUserId);
                if (signalled > 0) {
                    ownerContext.asOwnerRequiresNew(
                            ownerUserId,
                            () -> intents.recordCancelSignalsCurrent(ownerUserId, signalled));
                }
            }
        } catch (RuntimeException failure) {
            log.warn("account deletion cancellation poll failed");
        }
    }
}
