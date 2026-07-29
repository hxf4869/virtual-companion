package com.virtualcompanion.modelprotocol.contract;

import com.virtualcompanion.modelruntime.contract.AdapterFailure;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.port.ModelProtocolAdapter;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.stream.Stream;

import static com.virtualcompanion.modelprotocol.contract.ModelProtocolTestSupport.ownership;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ModelProtocolBoundaryContractTest {

    @Test
    void public_port_does_not_expose_provider_specific_credentials_or_types() {
        var publicTypes = List.of(
                ModelProtocolAdapter.class,
                ModelProtocolSession.class,
                ModelProtocolRequest.class,
                InvocationBinding.class,
                ModelProtocolEvent.class,
                AdapterFailure.class
        );
        var exposedNames = publicTypes.stream()
                .flatMap(ModelProtocolBoundaryContractTest::exposedNames)
                .map(name -> name.toLowerCase(Locale.ROOT))
                .toList();

        for (String forbidden : List.of(
                "openai",
                "anthropic",
                "apikey",
                "modelname",
                "providersdk",
                "providersession"
        )) {
            assertTrue(
                    exposedNames.stream().noneMatch(name -> name.contains(forbidden)),
                    () -> "public port exposed forbidden provider detail: " + forbidden
            );
        }
    }

    @Test
    void external_attempt_requires_requested_and_execution_authorization_snapshots() {
        assertThrows(
                IllegalArgumentException.class,
                () -> new InvocationBinding.ExternalAttemptBinding(
                        ownership(),
                        "attempt-1",
                        1,
                        "",
                        "execution-auth-1"
                )
        );
        assertThrows(
                IllegalArgumentException.class,
                () -> new InvocationBinding.ExternalAttemptBinding(
                        ownership(),
                        "attempt-1",
                        1,
                        "requested-auth-1",
                        ""
                )
        );
    }

    @Test
    void eos_is_only_an_attempt_terminal_event() {
        var permittedEventNames = Arrays.stream(
                        ModelProtocolEvent.class.getPermittedSubclasses()
                )
                .map(Class::getSimpleName)
                .toList();

        assertEquals(
                Set.of(
                        "OutputDelta",
                        "UsageReported",
                        "AttemptEos",
                        "AttemptFailed",
                        "AttemptCancelled"
                ),
                Set.copyOf(permittedEventNames)
        );
        assertFalse(permittedEventNames.stream().anyMatch(
                name -> name.contains("Generation")
                        || name.contains("ChatCompleted")
                        || name.contains("FinalMessage")
        ));
    }

    private static Stream<String> exposedNames(Class<?> type) {
        var methodTypes = Arrays.stream(type.getMethods())
                .flatMap(method -> Stream.concat(
                        Stream.of(method.getReturnType().getName()),
                        Arrays.stream(method.getParameterTypes()).map(Class::getName)
                ));
        var recordComponents = type.isRecord()
                ? Arrays.stream(type.getRecordComponents())
                .flatMap(component -> Stream.of(
                        component.getName(),
                        component.getType().getName()
                ))
                : Stream.<String>empty();
        var permitted = type.isSealed()
                ? Arrays.stream(type.getPermittedSubclasses())
                .flatMap(permittedType -> Stream.concat(
                        Stream.of(permittedType.getName()),
                        permittedType.isRecord()
                                ? Arrays.stream(permittedType.getRecordComponents())
                                .flatMap(ModelProtocolBoundaryContractTest::componentNames)
                                : Stream.empty()
                ))
                : Stream.<String>empty();
        return Stream.concat(
                Stream.of(type.getName()),
                Stream.concat(methodTypes, Stream.concat(recordComponents, permitted))
        );
    }

    private static Stream<String> componentNames(RecordComponent component) {
        return Stream.of(component.getName(), component.getType().getName());
    }
}
