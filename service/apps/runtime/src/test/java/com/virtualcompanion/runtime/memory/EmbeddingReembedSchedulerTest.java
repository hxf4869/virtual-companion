package com.virtualcompanion.runtime.memory;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.EmbeddingReembedService;
import com.virtualcompanion.platform.persistence.RestFieldCipher;
import java.util.List;
import org.junit.jupiter.api.Test;

class EmbeddingReembedSchedulerTest {

    @Test
    void batchContinuesAfterOneItemFailureAndCheckpointsBothOutcomes() {
        EmbeddingReembedService service = mock(EmbeddingReembedService.class);
        EmbeddingPort port = mock(EmbeddingPort.class);
        RestFieldCipher cipher = mock(RestFieldCipher.class);
        EmbeddingPort.EmbeddingSpace target = new EmbeddingPort.EmbeddingSpace(
                "provider-model", "revision-1", 64, "provider-model-r1-64");
        when(port.space()).thenReturn(target);
        when(service.claim("provider-model-r1-64", 16)).thenReturn(List.of(
                new EmbeddingReembedService.Claimed(1L, 10L, "enc-good"),
                new EmbeddingReembedService.Claimed(2L, 11L, "enc-fail")));
        when(cipher.decrypt("enc-good")).thenReturn("good summary");
        when(cipher.decrypt("enc-fail")).thenReturn("bad summary");
        when(port.embed(1L, "good summary")).thenReturn(new float[64]);
        when(port.embed(2L, "bad summary")).thenThrow(new IllegalStateException("provider down"));
        when(service.completeSuccess(
                "provider-model-r1-64", 1L, 10L,
                DeterministicEmbedder.toVectorLiteral(new float[64])))
                .thenReturn(true);
        EmbeddingReembedScheduler scheduler = new EmbeddingReembedScheduler(
                service, port, cipher, "alpha-hash-64", 16);

        scheduler.drain();

        verify(service).ensure(
                "provider-model-r1-64", "alpha-hash-64", "provider-model", "revision-1", 64, true);
        verify(service).completeSuccess(
                "provider-model-r1-64", 1L, 10L,
                DeterministicEmbedder.toVectorLiteral(new float[64]));
        verify(service).completeFailure("provider-model-r1-64", 2L, 11L);
    }
}
