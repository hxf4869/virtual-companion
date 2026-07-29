package com.virtualcompanion.modelfake;

import com.virtualcompanion.modelruntime.contract.ModelProtocolCapabilities;
import com.virtualcompanion.modelruntime.contract.StopReason;
import com.virtualcompanion.modelruntime.contract.TokenUsage;

import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Immutable deterministic output used by {@link FakeModelProtocolAdapter}.
 *
 * <p>Text requests use {@link #streamChunks()} individually when streaming and
 * their exact concatenation when non-streaming. A structured response is
 * supported only when {@link #structuredJson()} is present.</p>
 */
public record FakeResponseScript(
        List<String> streamChunks,
        TokenUsage usage,
        StopReason stopReason,
        Optional<String> structuredJson
) {

    public FakeResponseScript {
        Objects.requireNonNull(streamChunks, "streamChunks must not be null");
        streamChunks = List.copyOf(streamChunks);
        if (streamChunks.isEmpty()) {
            throw new IllegalArgumentException("streamChunks must not be empty");
        }
        for (String chunk : streamChunks) {
            Objects.requireNonNull(chunk, "streamChunks must not contain null");
            if (chunk.isEmpty()) {
                throw new IllegalArgumentException("streamChunks must not contain empty values");
            }
        }

        usage = Objects.requireNonNull(usage, "usage must not be null");
        stopReason = Objects.requireNonNull(stopReason, "stopReason must not be null");
        structuredJson = Objects.requireNonNull(
                structuredJson,
                "structuredJson must not be null"
        );
        structuredJson.ifPresent(json -> {
            if (json.isBlank()) {
                throw new IllegalArgumentException("structuredJson must not be blank");
            }
        });
    }

    public FakeResponseScript(
            List<String> streamChunks,
            TokenUsage usage,
            StopReason stopReason
    ) {
        this(streamChunks, usage, stopReason, Optional.empty());
    }

    public static FakeResponseScript text(
            List<String> streamChunks,
            TokenUsage usage,
            StopReason stopReason
    ) {
        return new FakeResponseScript(streamChunks, usage, stopReason);
    }

    public static FakeResponseScript structured(
            List<String> streamChunks,
            TokenUsage usage,
            StopReason stopReason,
            String structuredJson
    ) {
        Objects.requireNonNull(structuredJson, "structuredJson must not be null");
        return new FakeResponseScript(
                streamChunks,
                usage,
                stopReason,
                Optional.of(structuredJson)
        );
    }

    ModelProtocolCapabilities capabilities() {
        var values = EnumSet.of(ModelProtocolCapabilities.Capability.STREAMING);
        if (structuredJson.isPresent()) {
            values.add(ModelProtocolCapabilities.Capability.STRUCTURED_OUTPUT);
        }
        return new ModelProtocolCapabilities(values);
    }

    String completeText() {
        return String.join("", streamChunks);
    }
}
