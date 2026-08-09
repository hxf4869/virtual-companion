package com.virtualcompanion.modelanthropic.contract;

import com.virtualcompanion.modelanthropic.AnthropicMessagesAdapter;
import com.virtualcompanion.modelanthropic.AnthropicMessagesConfig;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;

import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.API_KEY;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.ANTHROPIC_VERSION;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.MODEL;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.completion;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.drain;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.parseJson;
import static com.virtualcompanion.modelanthropic.contract.AnthropicContractTestSupport.textRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

class AnthropicMessagesMaxTokensContractTest {

    @Test
    void legalValuesAreSentAsTheOriginalNumericJsonValue() throws Exception {
        for (int maxTokens : List.of(1, 1024, 2048, 8192)) {
            try (var server = new MockAnthropicServer(MockAnthropicServer.fixed(
                    200,
                    "application/json",
                    completion("ok", "end_turn", 1, 1)
            ))) {
                var client = new CountingHttpClient();
                var adapter = new AnthropicMessagesAdapter(
                        client,
                        new AnthropicMessagesConfig(
                                server.endpoint(),
                                API_KEY,
                                ANTHROPIC_VERSION,
                                MODEL,
                                maxTokens
                        )
                );

                var events = assertTimeoutPreemptively(
                        Duration.ofSeconds(5),
                        () -> drain(adapter.open(textRequest(false, "max tokens")))
                );
                assertEquals(3, events.size());
                assertEquals(maxTokens,
                        parseJson(server.awaitRequest().body())
                                .get("max_tokens")
                                .intValue());
                assertEquals(1, server.requestCount());
                assertEquals(1, client.asynchronousCalls());
            }
        }
    }

    @Test
    void invalidValuesFailBeforeHttpDispatch() {
        var client = new CountingHttpClient();
        URI endpoint = URI.create("http://127.0.0.1:1/v1/messages");

        for (int maxTokens : new int[]{0, -1, 8193, Integer.MAX_VALUE}) {
            assertThrows(
                    IllegalArgumentException.class,
                    () -> new AnthropicMessagesAdapter(
                            client,
                            new AnthropicMessagesConfig(
                                    endpoint,
                                    API_KEY,
                                    ANTHROPIC_VERSION,
                                    MODEL,
                                    maxTokens
                            )
                    )
            );
        }

        assertEquals(0, client.asynchronousCalls());
    }
}
