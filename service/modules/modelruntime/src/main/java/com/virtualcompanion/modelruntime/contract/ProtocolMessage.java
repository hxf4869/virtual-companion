package com.virtualcompanion.modelruntime.contract;

/**
 * Provider-neutral prompt message.
 */
public record ProtocolMessage(Role role, String content) {

    public ProtocolMessage {
        role = ContractChecks.requireNonNull(role, "role");
        content = ContractChecks.requireNonBlank(content, "content");
    }

    public enum Role {
        SYSTEM,
        USER,
        ASSISTANT
    }
}
