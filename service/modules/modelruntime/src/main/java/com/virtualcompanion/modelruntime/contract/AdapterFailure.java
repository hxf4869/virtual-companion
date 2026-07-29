package com.virtualcompanion.modelruntime.contract;

/**
 * Normalized failure boundary. No provider exception or response body crosses
 * this interface.
 */
public sealed interface AdapterFailure
        permits AdapterFailure.RateLimited,
        AdapterFailure.UpstreamUnavailable,
        AdapterFailure.Timeout,
        AdapterFailure.MalformedResponse,
        AdapterFailure.Disconnected,
        AdapterFailure.CancellationFailed,
        AdapterFailure.UnsupportedBinding,
        AdapterFailure.UnsupportedCapability {

    record RateLimited() implements AdapterFailure {
    }

    record UpstreamUnavailable() implements AdapterFailure {
    }

    record Timeout(TimeoutPhase phase) implements AdapterFailure {

        public Timeout {
            phase = ContractChecks.requireNonNull(phase, "phase");
        }
    }

    record MalformedResponse() implements AdapterFailure {
    }

    record Disconnected() implements AdapterFailure {
    }

    record CancellationFailed() implements AdapterFailure {
    }

    record UnsupportedBinding() implements AdapterFailure {
    }

    record UnsupportedCapability(ModelProtocolCapabilities.Capability capability)
            implements AdapterFailure {

        public UnsupportedCapability {
            capability = ContractChecks.requireNonNull(capability, "capability");
        }
    }

    enum TimeoutPhase {
        CONNECT,
        FIRST_TOKEN,
        TOTAL
    }
}
