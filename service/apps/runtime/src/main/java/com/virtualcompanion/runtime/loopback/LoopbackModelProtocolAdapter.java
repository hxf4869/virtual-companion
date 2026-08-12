package com.virtualcompanion.runtime.loopback;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Network-free deterministic loopback adapter (TASK-0181).
 *
 * <p>Accepts exactly an {@link InvocationBinding.ExternalAttemptBinding} (the
 * binding the external completion path produces) and replays a fixed
 * {@code OutputDelta + UsageReported + AttemptEos} stream — the counterpart of
 * {@code FakeModelProtocolAdapter}, which only accepts a
 * {@code DeterministicSourceBinding}. {@code protocol()} is {@code FAKE}:
 * the catalog {@code ModelProtocol} enum has no LOOPBACK value and the
 * {@code specs/generated/**} surface is protected, so the loopback deployment
 * is configured with the already-approved FAKE protocol code.
 *
 * <p>The stream is deterministic and symmetric with the SQL fixture chain
 * (infra/db test 67/68): usage is 42 input / 58 output tokens, matching the
 * fixture assertions, and the response text is the same fixed fallback phrase.
 * Zero network, zero credentials, zero real data — this adapter only exists
 * for the operator-configured loopback deployment used to exercise the real
 * external runtime path in-process.
 */
public final class LoopbackModelProtocolAdapter implements ModelProtocolAdapter {

    static final String LOOPBACK_RESPONSE = "I hear you. Take a breath; there's no rush.";
    static final long INPUT_TOKENS = 42L;
    static final long OUTPUT_TOKENS = 58L;

    @Override
    public ModelProtocol protocol() {
        return ModelProtocol.FAKE;
    }

    @Override
    public ModelProtocolCapabilities capabilities() {
        return new ModelProtocolCapabilities(Set.of());
    }

    @Override
    public ModelProtocolSession open(ModelProtocolRequest request) {
        Objects.requireNonNull(request, "request must not be null");
        if (!(request.binding() instanceof InvocationBinding.ExternalAttemptBinding binding)) {
            // A deterministic-source request never belongs to the external
            // completion path; fail closed with the UnsupportedBinding terminal.
            return new LoopbackModelProtocolSession(
                    List.of(new ModelProtocolEvent.AttemptFailed(
                            request.binding(), 0L, new AdapterFailure.UnsupportedBinding())));
        }
        return new LoopbackModelProtocolSession(events(binding));
    }

    private static List<ModelProtocolEvent> events(InvocationBinding.ExternalAttemptBinding binding) {
        return List.of(
                new ModelProtocolEvent.OutputDelta(
                        binding, 0L, new ModelPayload.TextChunk(LOOPBACK_RESPONSE)),
                new ModelProtocolEvent.UsageReported(
                        binding, 1L, new TokenUsage(INPUT_TOKENS, OUTPUT_TOKENS, 0L)),
                new ModelProtocolEvent.AttemptEos(binding, 2L, StopReason.STOP));
    }
}
