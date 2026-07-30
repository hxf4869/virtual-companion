package com.virtualcompanion.modelopenai.contract;

import com.virtualcompanion.modelopenai.OpenAiChatCompletionsAdapter;
import com.virtualcompanion.modelopenai.OpenAiChatCompletionsConfig;
import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.ModelProtocolEvent;
import com.virtualcompanion.modelruntime.contract.ModelProtocolRequest;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.contract.ProtocolMessage;
import com.virtualcompanion.modelruntime.contract.ResponseMode;
import com.virtualcompanion.modelruntime.contract.TimeoutBudget;
import com.virtualcompanion.modelruntime.port.ModelProtocolSession;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

final class OpenAiContractTestSupport {

    static final String TOKEN = "offline-token-sentinel";
    static final String MODEL = "offline-model-sentinel";
    static final String REQUESTED_AUTH = "requested-auth-sentinel";
    static final String EXECUTION_AUTH = "execution-auth-sentinel";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private OpenAiContractTestSupport() {
    }

    static InvocationBinding.ExternalAttemptBinding binding() {
        return new InvocationBinding.ExternalAttemptBinding(
                new OwnershipTuple(
                        "owner-1",
                        "relationship-1",
                        "conversation-1",
                        "generation-1"
                ),
                "provider-attempt-1",
                7,
                REQUESTED_AUTH,
                EXECUTION_AUTH
        );
    }

    static InvocationBinding.DeterministicSourceBinding deterministicBinding() {
        return new InvocationBinding.DeterministicSourceBinding(
                binding().ownership(),
                "deterministic-source-1",
                7
        );
    }

    static ModelProtocolRequest textRequest(boolean streaming, String content) {
        return request(
                binding(),
                streaming,
                new ResponseMode.Text(),
                content,
                normalBudgets()
        );
    }

    static ModelProtocolRequest textRequest(
            InvocationBinding binding,
            boolean streaming,
            String content,
            TimeoutBudget budgets
    ) {
        return request(
                binding,
                streaming,
                new ResponseMode.Text(),
                content,
                budgets
        );
    }

    static ModelProtocolRequest structuredRequest(
            boolean streaming,
            String content
    ) {
        return request(
                binding(),
                streaming,
                new ResponseMode.StructuredJson(
                        "companion_response",
                        "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},"
                                + "\"required\":[\"answer\"],\"additionalProperties\":false}"
                ),
                content,
                normalBudgets()
        );
    }

    static ModelProtocolRequest invalidStructuredRequest() {
        return request(
                binding(),
                false,
                new ResponseMode.StructuredJson("invalid_schema", "{not-json"),
                "structured",
                normalBudgets()
        );
    }

    static ModelProtocolRequest request(
            InvocationBinding binding,
            boolean streaming,
            ResponseMode mode,
            String content,
            TimeoutBudget budgets
    ) {
        return new ModelProtocolRequest(
                binding,
                List.of(
                        new ProtocolMessage(
                                ProtocolMessage.Role.SYSTEM,
                                "synthetic-system"
                        ),
                        new ProtocolMessage(
                                ProtocolMessage.Role.USER,
                                content
                        ),
                        new ProtocolMessage(
                                ProtocolMessage.Role.ASSISTANT,
                                "synthetic-prior"
                        )
                ),
                mode,
                streaming,
                budgets
        );
    }

    static TimeoutBudget normalBudgets() {
        return new TimeoutBudget(
                Duration.ofSeconds(2),
                Duration.ofSeconds(2),
                Duration.ofSeconds(5)
        );
    }

    static OpenAiChatCompletionsAdapter adapter(
            HttpClient client,
            URI endpoint
    ) {
        return new OpenAiChatCompletionsAdapter(
                client,
                new OpenAiChatCompletionsConfig(endpoint, TOKEN, MODEL)
        );
    }

    static List<ModelProtocolEvent> drain(ModelProtocolSession session) {
        var events = new ArrayList<ModelProtocolEvent>();
        for (int index = 0; index < 100_000; index++) {
            var event = session.next();
            if (event.isEmpty()) {
                break;
            }
            events.add(event.orElseThrow());
        }
        assertTrue(events.size() < 100_000, "session did not terminate");
        assertEquals(1, events.stream().filter(ModelProtocolEvent::terminal).count());
        assertTrue(events.getLast().terminal(), "terminal event must be last");
        for (int index = 0; index < events.size(); index++) {
            assertEquals(index, events.get(index).sequence(), "sequence must be contiguous");
            assertEquals(binding(), events.get(index).binding(), "full binding must survive");
        }
        if (session.next().isPresent()) {
            fail("terminal session emitted a late event");
        }
        return List.copyOf(events);
    }

    static String completion(
            String content,
            String finishReason,
            long promptTokens,
            long completionTokens
    ) {
        var root = JSON.createObjectNode();
        root.put("id", "chatcmpl-offline");
        root.put("object", "chat.completion");
        root.put("model", MODEL);
        var choice = root.putArray("choices").addObject();
        choice.put("index", 0);
        choice.putObject("message")
                .put("role", "assistant")
                .put("content", content);
        choice.put("finish_reason", finishReason);
        addUsage(root, promptTokens, completionTokens);
        return JSON.writeValueAsString(root);
    }

    static String choiceChunk(String content, String finishReason) {
        var root = JSON.createObjectNode();
        root.put("id", "chatcmpl-offline");
        root.put("object", "chat.completion.chunk");
        root.put("model", MODEL);
        var choice = root.putArray("choices").addObject();
        choice.put("index", 0);
        var delta = choice.putObject("delta");
        if (content != null) {
            delta.put("content", content);
        }
        if (finishReason == null) {
            choice.putNull("finish_reason");
        } else {
            choice.put("finish_reason", finishReason);
        }
        return JSON.writeValueAsString(root);
    }

    static String usageChunk(long promptTokens, long completionTokens) {
        var root = JSON.createObjectNode();
        root.put("id", "chatcmpl-offline");
        root.put("object", "chat.completion.chunk");
        root.put("model", MODEL);
        root.putArray("choices");
        addUsage(root, promptTokens, completionTokens);
        return JSON.writeValueAsString(root);
    }

    static String sse(String data) {
        return "data: " + data + "\n\n";
    }

    static String sseCrLf(String data) {
        return "data: " + data + "\r\n\r\n";
    }

    static String done() {
        return "data: [DONE]\n\n";
    }

    static JsonNode parseJson(String value) {
        return JSON.readTree(value);
    }

    private static void addUsage(
            tools.jackson.databind.node.ObjectNode root,
            long promptTokens,
            long completionTokens
    ) {
        root.putObject("usage")
                .put("prompt_tokens", promptTokens)
                .put("completion_tokens", completionTokens)
                .put("total_tokens", promptTokens + completionTokens);
    }
}
