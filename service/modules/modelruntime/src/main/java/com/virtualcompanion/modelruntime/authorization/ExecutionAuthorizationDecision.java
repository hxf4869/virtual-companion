package com.virtualcompanion.modelruntime.authorization;

import java.util.Objects;
import java.util.Optional;

/**
 * Fail-closed decision returned by {@link ExecutionAuthorizationGuard}.
 */
public record ExecutionAuthorizationDecision(
        boolean allowed,
        String denialReason,
        QuotaAction quotaAction,
        boolean externalDataTransferAllowed
) {

    public ExecutionAuthorizationDecision {
        Objects.requireNonNull(quotaAction, "quotaAction must not be null");
        if (allowed) {
            if (denialReason != null) {
                throw new IllegalArgumentException(
                        "allowed decision must not carry a denialReason");
            }
            if (quotaAction != QuotaAction.NONE) {
                throw new IllegalArgumentException(
                        "allowed decision must use QuotaAction.NONE");
            }
            if (!externalDataTransferAllowed) {
                throw new IllegalArgumentException(
                        "allowed decision must permit external data transfer");
            }
        } else {
            Objects.requireNonNull(denialReason, "denialReason must not be null");
            if (denialReason.isBlank()) {
                throw new IllegalArgumentException("denialReason must not be blank");
            }
            if (externalDataTransferAllowed) {
                throw new IllegalArgumentException(
                        "denied decision must forbid external data transfer");
            }
        }
    }

    public static ExecutionAuthorizationDecision allow() {
        return new ExecutionAuthorizationDecision(true, null, QuotaAction.NONE, true);
    }

    public static ExecutionAuthorizationDecision deny(String reason) {
        return new ExecutionAuthorizationDecision(
                false,
                reason,
                QuotaAction.RELEASE,
                false
        );
    }

    public Optional<String> denialReasonOptional() {
        return Optional.ofNullable(denialReason);
    }
}
