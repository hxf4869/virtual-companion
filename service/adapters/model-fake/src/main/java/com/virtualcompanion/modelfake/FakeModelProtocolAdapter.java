package com.virtualcompanion.modelfake;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelPayload;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Network-free deterministic adapter for local contract and fault-boundary
 * tests.
 */
public final class FakeModelProtocolAdapter implements ModelProtocolAdapter {

    private final FakeResponseScript script;
    private final ModelProtocolCapabilities capabilities;

    public FakeModelProtocolAdapter(FakeResponseScript script) {
        this.script = Objects.requireNonNull(script, "script must not be null");
        this.capabilities = script.capabilities();
    }

    @Override
    public ModelProtocol protocol() {
        return ModelProtocol.FAKE;
    }

    @Override
    public ModelProtocolCapabilities capabilities() {
        return capabilities;
    }

    @Override
    public ModelProtocolSession open(ModelProtocolRequest request) {
        Objects.requireNonNull(request, "request must not be null");

        if (!(request.binding() instanceof InvocationBinding.DeterministicSourceBinding)) {
            return terminalFailure(request, new AdapterFailure.UnsupportedBinding());
        }

        if (request.responseMode() instanceof ResponseMode.StructuredJson
                && !capabilities.supports(
                        ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
                )) {
            return terminalFailure(
                    request,
                    new AdapterFailure.UnsupportedCapability(
                            ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT
                    )
            );
        }

        var events = new ArrayList<ModelProtocolEvent>();
        long sequence = 0;
        for (ModelPayload payload : payloadsFor(request)) {
            events.add(new ModelProtocolEvent.OutputDelta(
                    request.binding(),
                    sequence++,
                    payload
            ));
        }
        events.add(new ModelProtocolEvent.UsageReported(
                request.binding(),
                sequence++,
                script.usage()
        ));
        events.add(new ModelProtocolEvent.AttemptEos(
                request.binding(),
                sequence,
                script.stopReason()
        ));
        return new FakeModelProtocolSession(events);
    }

    private List<ModelPayload> payloadsFor(ModelProtocolRequest request) {
        if (request.responseMode() instanceof ResponseMode.StructuredJson) {
            return List.of(new ModelPayload.StructuredJson(
                    script.structuredJson().orElseThrow()
            ));
        }
        if (request.streaming()) {
            return script.streamChunks().stream()
                    .map(ModelPayload.TextChunk::new)
                    .map(ModelPayload.class::cast)
                    .toList();
        }
        return List.of(new ModelPayload.TextChunk(script.completeText()));
    }

    private static ModelProtocolSession terminalFailure(
            ModelProtocolRequest request,
            AdapterFailure failure
    ) {
        return new FakeModelProtocolSession(List.of(
                new ModelProtocolEvent.AttemptFailed(
                        request.binding(),
                        0,
                        failure
                )
        ));
    }
}
