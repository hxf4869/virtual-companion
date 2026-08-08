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
        SizeLimits.requireWithin(
                "messages",
                messages.size(),
                SizeLimits.MAX_MESSAGES
        );
        messages = List.copyOf(messages);
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("messages must not be empty");
        }
        messages.forEach(message -> ContractChecks.requireNonNull(message, "message"));
        responseMode = ContractChecks.requireNonNull(responseMode, "responseMode");
        if (responseMode instanceof ResponseMode.StructuredJson structured) {
            SizeLimits.requireWithin(
                    "jsonSchema bytes",
                    SizeLimits.utf8Bytes(structured.jsonSchema()),
                    SizeLimits.MAX_SCHEMA_BYTES
            );
        }
        timeoutBudget = ContractChecks.requireNonNull(timeoutBudget, "timeoutBudget");
    }
}
