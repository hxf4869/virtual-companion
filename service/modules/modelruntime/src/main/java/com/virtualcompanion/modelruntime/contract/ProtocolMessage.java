package com.virtualcompanion.modelruntime.contract;

/**
 * Provider-neutral prompt message.
 */
public record ProtocolMessage(Role role, String content) {

    public ProtocolMessage {
        role = ContractChecks.requireNonNull(role, "role");
        content = ContractChecks.requireNonBlank(content, "content");
        SizeLimits.requireWithin(
                "content bytes",
                SizeLimits.utf8Bytes(content),
                SizeLimits.MAX_MESSAGE_BYTES
        );
    }

    public enum Role {
        SYSTEM,
        USER,
        ASSISTANT
    }
}
