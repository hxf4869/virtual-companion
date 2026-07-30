package com.virtualcompanion.generation.contract;

import com.virtualcompanion.conversation.generation.AttemptEventResult;
import com.virtualcompanion.conversation.generation.AttemptOutcome;
import com.virtualcompanion.conversation.generation.AttemptTermination;
import com.virtualcompanion.conversation.generation.CandidateContent;
import com.virtualcompanion.conversation.generation.CandidateContentAddress;
import com.virtualcompanion.conversation.generation.FrozenGenerationCandidate;
import com.virtualcompanion.conversation.generation.GenerationAttemptReducer;
import com.virtualcompanion.conversation.generation.GenerationCandidateSet;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GenerationPublicBoundaryContractTest {

    @Test
    void public_generation_types_expose_no_final_message_or_infrastructure_types() {
        var publicTypes = List.of(
                AttemptEventResult.class,
                AttemptOutcome.class,
                AttemptTermination.class,
                CandidateContent.class,
                CandidateContentAddress.class,
                FrozenGenerationCandidate.class,
                GenerationAttemptReducer.class,
                GenerationCandidateSet.class
        );
        var exposedNames = publicTypes.stream()
                .flatMap(GenerationPublicBoundaryContractTest::exposedNames)
                .map(name -> name.toLowerCase(Locale.ROOT))
                .toList();

        for (String forbidden : List.of(
                "assistantmessage",
                "chatcompleted",
                "finalmessage",
                "realtimeevent",
                "outbox",
                "springframework",
                "jakarta.persistence",
                "javax.persistence",
                "jdbc",
                "openai",
                "anthropic",
                "apikey",
                "modelname",
                "providersdk",
                "providerexception"
        )) {
            assertTrue(
                    exposedNames.stream().noneMatch(name -> name.contains(forbidden)),
                    () -> "conversation public API exposed forbidden boundary: " + forbidden
            );
        }
    }

    @Test
    void frozen_candidate_can_only_be_created_by_the_conversation_package() {
        assertEquals(0, FrozenGenerationCandidate.class.getConstructors().length);
    }

    @Test
    void reducer_has_no_finalize_complete_publish_or_select_operation() {
        var methodNames = Arrays.stream(GenerationAttemptReducer.class.getMethods())
                .map(method -> method.getName().toLowerCase(Locale.ROOT))
                .toList();

        for (String forbidden : List.of(
                "finalizegeneration",
                "completegeneration",
                "publishchatcompleted",
                "createassistantmessage",
                "selectcandidate"
        )) {
            assertFalse(methodNames.contains(forbidden));
        }
    }

    private static Stream<String> exposedNames(Class<?> type) {
        var methods = Arrays.stream(type.getMethods())
                .flatMap(method -> Stream.concat(
                        Stream.of(method.getName(), method.getReturnType().getName()),
                        Arrays.stream(method.getParameterTypes()).map(Class::getName)
                ));
        var recordComponents = type.isRecord()
                ? Arrays.stream(type.getRecordComponents())
                .flatMap(GenerationPublicBoundaryContractTest::componentNames)
                : Stream.<String>empty();
        var permitted = type.isSealed()
                ? Arrays.stream(type.getPermittedSubclasses())
                .flatMap(permittedType -> Stream.concat(
                        Stream.of(permittedType.getName()),
                        permittedType.isRecord()
                                ? Arrays.stream(permittedType.getRecordComponents())
                                .flatMap(GenerationPublicBoundaryContractTest::componentNames)
                                : Stream.empty()
                ))
                : Stream.<String>empty();
        return Stream.concat(
                Stream.of(type.getName()),
                Stream.concat(methods, Stream.concat(recordComponents, permitted))
        );
    }

    private static Stream<String> componentNames(RecordComponent component) {
        return Stream.of(component.getName(), component.getType().getName());
    }
}
