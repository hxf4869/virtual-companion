package com.virtualcompanion.modelfailure;

import com.virtualcompanion.modelruntime.contract.ModelPayload;

import java.util.List;
import java.util.Objects;

/**
 * Immutable instructions for one deterministic failure session.
 *
 * <p>Prefix deltas are permitted only for scenarios that deliberately fail
 * after output. A late-delta script carries exactly one payload, which the
 * session emits with a stale deterministic binding before the normalized
 * terminal failure.</p>
 */
public record FailureScript(
        FailureScenario scenario,
        List<ModelPayload> prefixDeltas
) {

    public FailureScript {
        scenario = Objects.requireNonNull(scenario, "scenario must not be null");
        Objects.requireNonNull(prefixDeltas, "prefixDeltas must not be null");
        prefixDeltas = List.copyOf(prefixDeltas);
        prefixDeltas.forEach(payload -> {
            Objects.requireNonNull(payload, "prefixDeltas must not contain null");
            if (!(payload instanceof ModelPayload.TextChunk)) {
                throw new IllegalArgumentException(
                        "failure prefix deltas must be text payloads"
                );
            }
        });

        if (!allowsPrefix(scenario) && !prefixDeltas.isEmpty()) {
            throw new IllegalArgumentException(
                    scenario + " must fail before emitting output"
            );
        }
        if (scenario == FailureScenario.LATE_DELTA && prefixDeltas.size() != 1) {
            throw new IllegalArgumentException(
                    "LATE_DELTA requires exactly one stale delta payload"
            );
        }
    }

    /**
     * Creates the scenario with its deterministic default prefix, when one is
     * semantically required.
     */
    public FailureScript(FailureScenario scenario) {
        this(scenario, defaultPrefix(scenario));
    }

    public static FailureScript of(FailureScenario scenario) {
        return new FailureScript(scenario);
    }

    public static FailureScript withTextPrefix(
            FailureScenario scenario,
            List<String> prefixDeltas
    ) {
        Objects.requireNonNull(prefixDeltas, "prefixDeltas must not be null");
        return new FailureScript(
                scenario,
                prefixDeltas.stream()
                        .map(ModelPayload.TextChunk::new)
                        .map(ModelPayload.class::cast)
                        .toList()
        );
    }

    private static boolean allowsPrefix(FailureScenario scenario) {
        return scenario == FailureScenario.TOTAL_TIMEOUT
                || scenario == FailureScenario.DISCONNECT
                || scenario == FailureScenario.LATE_DELTA;
    }

    private static List<ModelPayload> defaultPrefix(FailureScenario scenario) {
        Objects.requireNonNull(scenario, "scenario must not be null");
        return switch (scenario) {
            case TOTAL_TIMEOUT ->
                    List.of(new ModelPayload.TextChunk("partial-before-total-timeout"));
            case DISCONNECT ->
                    List.of(new ModelPayload.TextChunk("partial-before-disconnect"));
            case LATE_DELTA ->
                    List.of(new ModelPayload.TextChunk("late-delta"));
            default -> List.of();
        };
    }
}
