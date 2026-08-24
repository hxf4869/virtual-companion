package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.SizeLimits;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.routing.RoutingRequest;
import com.virtualcompanion.safety.ClassifierReport;
import java.util.List;
import java.util.Objects;

/**
 * Immutable input to one {@link LiveModelInvoker} invocation.
 *
 * <p>{@code hardRuleViolations} and {@code classifierReport} are the safety
 * inputs evaluated by the fail-closed {@code SafetyGate} before any outbound
 * transfer; only an adequate ALLOW releases an external attempt. The safety
 * signal itself is owned by the caller (the safety pipeline), which the live
 * invocation path only consumes.</p>
 *
 * <p>S0-26: {@code payloadComposition} declares, per message, the
 * {@link com.virtualcompanion.modelruntime.authorization.DataCategory} that
 * message carries (see {@link PayloadComposition}) so
 * the invoker can intersect the actual outbound payload with the current
 * execution authorization before any transfer. It may be {@code null} only for
 * requests that can never reach an external attempt (the legacy 7-argument
 * convenience constructor); an external attempt with an undeclared composition
 * is denied fail-closed — an unclassified payload cannot be authorized
 * item-by-item.</p>
 */
public record LiveInvocationRequest(
        RoutingRequest routingRequest,
        List<ProtocolMessage> messages,
        ResponseMode responseMode,
        boolean streaming,
        TimeoutBudget timeoutBudget,
        List<String> hardRuleViolations,
        ClassifierReport classifierReport,
        PayloadComposition payloadComposition,
        String promptBundleVersion,
        String personaBundleVersion) {

    /** Legacy shape retained for deterministic and compatibility tests. */
    public LiveInvocationRequest(
            RoutingRequest routingRequest,
            List<ProtocolMessage> messages,
            ResponseMode responseMode,
            boolean streaming,
            TimeoutBudget timeoutBudget,
            List<String> hardRuleViolations,
            ClassifierReport classifierReport,
            PayloadComposition payloadComposition) {
        this(routingRequest, messages, responseMode, streaming, timeoutBudget,
                hardRuleViolations, classifierReport, payloadComposition, null, null);
    }

    /**
     * Legacy shape: no declared payload composition. Requests built through
     * this constructor are refused on the external path (S0-26 fail closed)
     * and remain valid only for deterministic-source invocations.
     */
    public LiveInvocationRequest(
            RoutingRequest routingRequest,
            List<ProtocolMessage> messages,
            ResponseMode responseMode,
            boolean streaming,
            TimeoutBudget timeoutBudget,
            List<String> hardRuleViolations,
            ClassifierReport classifierReport) {
        this(routingRequest, messages, responseMode, streaming, timeoutBudget,
                hardRuleViolations, classifierReport, null, null, null);
    }

    public LiveInvocationRequest {
        Objects.requireNonNull(routingRequest, "routingRequest must not be null");
        Objects.requireNonNull(messages, "messages must not be null");
        if (messages.isEmpty()) {
            throw new IllegalArgumentException("messages must not be empty");
        }
        SizeLimits.requireWithin(
                "messages",
                messages.size(),
                SizeLimits.MAX_MESSAGES
        );
        messages = List.copyOf(messages);
        messages.forEach(message -> Objects.requireNonNull(message, "messages must not contain null"));
        Objects.requireNonNull(responseMode, "responseMode must not be null");
        Objects.requireNonNull(timeoutBudget, "timeoutBudget must not be null");
        Objects.requireNonNull(hardRuleViolations, "hardRuleViolations must not be null");
        hardRuleViolations = List.copyOf(hardRuleViolations);
        hardRuleViolations.forEach(ruleId -> {
            Objects.requireNonNull(ruleId, "hardRuleViolations must not contain null");
            if (ruleId.isBlank()) {
                throw new IllegalArgumentException(
                        "hardRuleViolations must not contain blank ids");
            }
        });
        Objects.requireNonNull(classifierReport, "classifierReport must not be null");
        if (payloadComposition != null
                && payloadComposition.messageCategories().size() != messages.size()) {
            throw new IllegalArgumentException(
                    "payloadComposition must classify exactly one category per message ("
                            + payloadComposition.messageCategories().size()
                            + " categories for " + messages.size() + " messages)");
        }
    }
}
