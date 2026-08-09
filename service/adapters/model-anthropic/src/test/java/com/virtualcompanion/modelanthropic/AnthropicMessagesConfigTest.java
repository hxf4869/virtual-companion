package com.virtualcompanion.modelanthropic;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AnthropicMessagesConfigTest {

    private static final URI ENDPOINT = URI.create(
            "http://127.0.0.1:1/v1/messages");

    @Test
    void acceptsThePrivateMaxTokensBoundaries() {
        assertEquals(1, config(1).maxTokens());
        assertEquals(AnthropicMessagesConfig.MAX_TOKENS,
                config(AnthropicMessagesConfig.MAX_TOKENS).maxTokens());
    }

    @Test
    void rejectsValuesOutsideThePrivateMaxTokensRange() {
        for (int value : new int[]{0, -1, 8193, Integer.MAX_VALUE}) {
            var exception = assertThrows(
                    IllegalArgumentException.class,
                    () -> config(value)
            );
            assertFalse(exception.getMessage().contains("synthetic-api-key"));
            assertFalse(exception.getMessage().contains("synthetic-prompt"));
            assertFalse(exception.getMessage().contains("synthetic-schema"));
        }
    }

    @Test
    void codecRevalidatesMaxTokensBeforeWritingRequest() {
        var codec = new AnthropicMessagesCodec();
        var request = request();

        for (int value : new int[]{0, -1, 8193, Integer.MAX_VALUE}) {
            assertThrows(
                    AnthropicCodecException.class,
                    () -> codec.encodeRequest(request, "synthetic-model", value)
            );
        }
    }

    private static AnthropicMessagesConfig config(int maxTokens) {
        return new AnthropicMessagesConfig(
                ENDPOINT,
                "synthetic-api-key",
                "2023-06-01",
                "synthetic-model",
                maxTokens
        );
    }

    private static ModelProtocolRequest request() {
        return new ModelProtocolRequest(
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple("owner", "relationship", "conversation", "generation"),
                        "provider-attempt",
                        1,
                        "requested-auth",
                        "execution-auth"
                ),
                List.of(new ProtocolMessage(ProtocolMessage.Role.USER, "synthetic-prompt")),
                new ResponseMode.Text(),
                false,
                new TimeoutBudget(
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(1),
                        Duration.ofSeconds(2)
                )
        );
    }
}
