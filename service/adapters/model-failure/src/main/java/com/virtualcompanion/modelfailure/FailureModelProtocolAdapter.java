package com.virtualcompanion.modelfailure;

import com.virtualcompanion.catalog.ModelProtocol;
import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;

import java.util.Objects;
import java.util.Set;

/**
 * Local deterministic failure injection adapter.
 *
 * <p>The adapter performs no I/O and never represents an external provider
 * attempt. Unsupported bindings and capabilities are returned as normalized
 * terminal events by the session.</p>
 */
public final class FailureModelProtocolAdapter implements ModelProtocolAdapter {

    private static final ModelProtocolCapabilities CAPABILITIES =
            new ModelProtocolCapabilities(Set.of(
                    ModelProtocolCapabilities.Capability.STREAMING
            ));

    private final FailureScript script;

    public FailureModelProtocolAdapter(FailureScript script) {
        this.script = Objects.requireNonNull(script, "script must not be null");
    }

    public FailureModelProtocolAdapter(FailureScenario scenario) {
        this(FailureScript.of(scenario));
    }

    @Override
    public ModelProtocol protocol() {
        return ModelProtocol.FAILURE;
    }

    @Override
    public ModelProtocolCapabilities capabilities() {
        return CAPABILITIES;
    }

    @Override
    public ModelProtocolSession open(ModelProtocolRequest request) {
        return new FailureModelProtocolSession(
                Objects.requireNonNull(request, "request must not be null"),
                script
        );
    }
}
