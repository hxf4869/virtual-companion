package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link DispatchingWorkItemHandler} (MEM-LOOP): routes a
 * claimed item to the handler registered for its kind; an unknown kind throws
 * so the worker's independent per-item fail terminalizes it instead of
 * looping on lease recovery.
 */
class DispatchingWorkItemHandlerTest {

    @Test
    void routesToTheHandlerRegisteredForTheKind() {
        WorkItemHandler generation = mock(WorkItemHandler.class);
        WorkItemHandler extract = mock(WorkItemHandler.class);
        DispatchingWorkItemHandler dispatcher = new DispatchingWorkItemHandler(Map.of(
                GenerationWorkItemHandler.KIND_GENERATION, generation,
                MemoryExtractWorkItemHandler.KIND_MEMORY_EXTRACT, extract));

        WorkItemClaim generationClaim =
                new WorkItemClaim(1L, 1L, "GENERATION", 10L, null, "t", "F");
        WorkItemClaim extractClaim =
                new WorkItemClaim(1L, 2L, "MEMORY_EXTRACT", 10L, null, "t", "F");

        dispatcher.handle(generationClaim);
        dispatcher.handle(extractClaim);

        verify(generation).handle(generationClaim);
        verify(extract).handle(extractClaim);
        verify(generation, never()).handle(extractClaim);
        verify(extract, never()).handle(generationClaim);
    }

    @Test
    void unknownKindThrowsForTheIndependentPerItemFail() {
        DispatchingWorkItemHandler dispatcher =
                new DispatchingWorkItemHandler(Map.of("GENERATION", mock(WorkItemHandler.class)));
        WorkItemClaim unknown =
                new WorkItemClaim(1L, 1L, "MYSTERY", 10L, null, "t", "F");

        assertThrows(IllegalStateException.class, () -> dispatcher.handle(unknown));
    }
}
