package com.virtualcompanion.runtime.memory;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ConsentRecord;
import com.virtualcompanion.platform.persistence.ConsentService;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class ExternalEmbeddingPortTest {

    @Test
    void adapterRequestsTheRegisteredDimensionAndCarriesImmutableSpaceLineage() {
        OpenAiCompatEmbedder client = mock(OpenAiCompatEmbedder.class);
        float[] vector = new float[64];
        when(client.embed("hello", 64)).thenReturn(vector);
        EmbeddingPort port = new OpenAiCompatEmbeddingPort(
                client, "embedding-model", "revision-1", 64, "embedding-model-r1-64");

        assertArrayEquals(vector, port.embed("hello"));
        assertEquals("revision-1", port.space().modelVersion());
        assertEquals("embedding-model-r1-64", port.space().spaceId());
        verify(client).embed("hello", 64);
    }

    @Test
    void adapterRejectsDimensionDriftAtConstruction() {
        assertThrows(IllegalArgumentException.class, () -> new OpenAiCompatEmbeddingPort(
                mock(OpenAiCompatEmbedder.class), "m", "r1", 1536, "m-r1"));
    }

    @Test
    void externalEmbeddingRequiresBothCurrentConsentsAndAnOwnerContext() {
        OpenAiCompatEmbedder client = mock(OpenAiCompatEmbedder.class);
        float[] vector = new float[64];
        when(client.embed("private text", 64)).thenReturn(vector);
        EmbeddingPort external = new OpenAiCompatEmbeddingPort(
                client, "m", "r1", 64, "m-r1-64");
        ConsentService consents = mock(ConsentService.class);
        AccountDeletionIntentService deletionIntents = mock(AccountDeletionIntentService.class);
        ConsentGatedEmbeddingPort gated = new ConsentGatedEmbeddingPort(
                external, consents, deletionIntents);

        assertThrows(IllegalStateException.class, () -> gated.embed("private text"));
        when(consents.findLatestByType(7L, "THIRD_PARTY_MODEL_PROCESSING"))
                .thenReturn(Optional.of(consent(1L, "THIRD_PARTY_MODEL_PROCESSING", true)));
        when(consents.findLatestByType(7L, "SENSITIVE_DATA_PROCESSING"))
                .thenReturn(Optional.of(consent(2L, "SENSITIVE_DATA_PROCESSING", false)));
        assertThrows(IllegalStateException.class, () -> gated.embed(7L, "private text"));
        verify(client, never()).embed("private text", 64);

        when(consents.findLatestByType(7L, "SENSITIVE_DATA_PROCESSING"))
                .thenReturn(Optional.of(consent(3L, "SENSITIVE_DATA_PROCESSING", true)));
        when(deletionIntents.activeCurrent(7L)).thenReturn(true);
        assertThrows(IllegalStateException.class, () -> gated.embed(7L, "private text"));
        verify(client, never()).embed("private text", 64);
        when(deletionIntents.activeCurrent(7L)).thenReturn(false);
        assertArrayEquals(vector, gated.embed(7L, "private text"));
        verify(client).embed("private text", 64);
    }

    private static ConsentRecord consent(long id, String type, boolean granted) {
        Instant now = Instant.parse("2026-08-24T00:00:00Z");
        return new ConsentRecord(id, type, "v1", granted, now, granted ? null : now);
    }
}
