package com.virtualcompanion.modelopenai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * SAMPLE-CFG: codec-level sampling tests. Verifies the deployment-level
 * max_tokens / temperature defaults reach the OpenAI request body verbatim and
 * that out-of-band values fail closed before any wire bytes are produced.
 */
class OpenAiChatCompletionsCodecSamplingTest {

    private static ModelProtocolRequest request() {
        return new ModelProtocolRequest(
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple("owner", "relationship", "conversation", "generation"),
                        "provider-attempt",
                        1L,
                        "req-snap",
                        "exec-snap"),
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "hi")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(Duration.ofSeconds(1), Duration.ofSeconds(1), Duration.ofSeconds(1)));
    }

    @Test
    void writesTheDeploymentSamplingDefaultsIntoTheRequestBody() throws Exception {
        var codec = new OpenAiChatCompletionsCodec();

        String body = codec.encodeRequest(request(), "synthetic-model", 1024, 0.8);

        assertTrue(body.contains("\"max_tokens\":1024"), body);
        assertTrue(body.contains("\"temperature\":0.8"), body);
    }

    @Test
    void rejectsOutOfBandSamplingValuesBeforeProducingWireBytes() {
        var codec = new OpenAiChatCompletionsCodec();

        assertThrows(
                OpenAiCodecException.class,
                () -> codec.encodeRequest(request(), "synthetic-model", 0, 1.0));
        assertThrows(
                OpenAiCodecException.class,
                () -> codec.encodeRequest(request(), "synthetic-model", 8193, 1.0));
        assertThrows(
                OpenAiCodecException.class,
                () -> codec.encodeRequest(request(), "synthetic-model", 1024, -0.1));
        assertThrows(
                OpenAiCodecException.class,
                () -> codec.encodeRequest(request(), "synthetic-model", 1024, 2.1));
    }

    @Test
    void configDefaultTemperatureIsOneAndMaxTokensIsTheOpenAiCeiling() {
        var config = new OpenAiChatCompletionsConfig(
                java.net.URI.create("https://api.openai.com/v1/chat/completions"),
                "synthetic-token",
                "synthetic-model");

        assertEquals(1.0, config.temperature());
        assertEquals(
                com.virtualcompanion.modelruntime.contract.SizeLimits.MAX_OPENAI_OUTPUT_TOKENS,
                config.maxTokens());
    }
}
