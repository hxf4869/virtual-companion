package com.virtualcompanion.modelruntime.contract;

import java.util.List;

/**
 * Immutable, provider-neutral input to one adapter session.
 */
public record ModelProtocolRequest(
        InvocationBinding binding,
        List<ProtocolMessage> messages,
        ResponseMode responseMode,
        boolean streaming,
        TimeoutBudget timeoutBudget
) {

    public ModelProtocolRequest {
        binding = ContractChecks.requireNonNull(binding, "binding");
        ContractChecks.requireNonNull(messages, "messages");
        messages = List.copyOf(messages);
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("messages must not be empty");
        }
        messages.forEach(message -> ContractChecks.requireNonNull(message, "message"));
        responseMode = ContractChecks.requireNonNull(responseMode, "responseMode");
        timeoutBudget = ContractChecks.requireNonNull(timeoutBudget, "timeoutBudget");
    }
}
